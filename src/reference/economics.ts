// ---------------------------------------------------------------------------
// economics.ts
// ---------------------------------------------------------------------------
// Pure, memoization-friendly client-side economics engine. No React imports.
// Reproduces (byte-for-byte, per the D3 VDI coverage-window algorithm) the
// same hub & spoke cost engine as tools/build-dashboard-data.mjs, but driven
// by a reference object that can change at runtime (edited in the browser)
// instead of being baked in at build time.
//
// Economics rules (ARCHITECTURE.md "Hub & spoke economics"):
//   Benefit = SMV x grade rate in force on the item's OUTCOME DATE.
//   Cost    = worktime x (hub £/bot-second + spoke infra £/bot-second)
//     hub pool/day    = CoE team run-rate (peopleCostHistory, ownerId='HUB')
//                        + hub-owned (spokeId=null) VDIs' daily cost,
//                        apportioned by worktime across ALL work that day.
//     spoke infra/day = that spoke's own VDIs' daily cost, apportioned by
//                        worktime WITHIN the spoke that day.
//   Idle time is never a denominator (idle cost rides on the work that ran).
// ---------------------------------------------------------------------------
import { PROCESS_BY_ID } from "../rpaData";
import type { DayRow, ExcRow, ProcessDim, ResRow, VdiDim } from "../rpaData";
import type { ReferenceJson, ResourceRef } from "./reference-store";

const DAY_MS = 86400000;

const parseISO = (dateISO: string): number => Date.parse(dateISO + "T00:00:00Z");
const dateOnly = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

// --- generic date-effective lookup -------------------------------------------
// Same semantics as build-dashboard-data.mjs's inForce: the row with the
// latest effectiveFrom <= date wins.
export function inForce<T extends { effectiveFrom: string }>(history: T[], dateISO: string): T | undefined {
  let best: T | undefined;
  for (const h of history) if (h.effectiveFrom <= dateISO && (!best || h.effectiveFrom > best.effectiveFrom)) best = h;
  return best;
}

export function vdiClassRate(reference: ReferenceJson, costClass: string, dateISO: string): number {
  return inForce(reference.vdiCostHistory.filter((v) => v.costClass === costClass), dateISO)?.annualCostPerVDIGBP ?? 0;
}

export function gradeRateOn(reference: ReferenceJson, grade: string, dateISO: string): number {
  return inForce(reference.gradeRates.filter((g) => g.grade === grade), dateISO)?.hourlyCostGBP ?? 0;
}

/** 0 if no record found (don't throw) — e.g. an unseeded spoke ownerId. */
export function peopleCostOn(reference: ReferenceJson, ownerId: string, dateISO: string): number {
  return inForce(reference.peopleCostHistory.filter((p) => p.ownerId === ownerId), dateISO)?.annualCostGBP ?? 0;
}

// --- D3: VDI renewal / coverage-window algorithm -----------------------------
// This must stay byte-for-byte identical in src/reference/economics.ts,
// tools/build-dashboard-data.mjs and tools/verify-economics.mjs.
//
// Renewal cycles tile every 365 days from the renewalDate anchor, both
// forward and backward (a VDI that's been renewing annually since 2023 is
// still covered by cycles computed from a single "most recent renewal"
// anchor date — the anchor just fixes the cycle's phase).

/** The shape vdiDailyCost/vdiAvailableOn need — satisfied by both ResourceRef and the extended VdiDim. */
export interface VdiCoverageInput {
  activeFrom: string;
  activeTo: string | null;
  costClass: string;
  renewalDate: string;
  annualCostGBP: number | null;
  licenseExpiryDate: string | null;
  status: "active" | "retired";
}

function cycleStart(renewalDateISO: string, dateISO: string): number {
  const renewalTs = parseISO(renewalDateISO);
  const dateTs = parseISO(dateISO);
  const cycleIndex = Math.floor((dateTs - renewalTs) / (365 * DAY_MS));
  return renewalTs + cycleIndex * 365 * DAY_MS;
}

function coverageWindow(vdi: VdiCoverageInput, cycleStartTs: number): { start: number; end: number } {
  // half-open [start, end) in ms
  let end = cycleStartTs + 365 * DAY_MS;
  if (vdi.licenseExpiryDate) end = Math.min(end, parseISO(vdi.licenseExpiryDate) + DAY_MS); // expiry date is the last covered day
  if (vdi.status === "retired" && vdi.activeTo) end = Math.min(end, parseISO(vdi.activeTo) + DAY_MS);
  const start = Math.max(cycleStartTs, parseISO(vdi.activeFrom));
  return { start, end };
}

/**
 * Daily cost of one VDI, or 0 outside its coverage window — which ALSO means
 * zero available capacity that day for capacity/utilisation purposes (not
 * just zero active hours).
 */
export function vdiDailyCost(vdi: VdiCoverageInput, dateISO: string, reference: ReferenceJson): number {
  const dateTs = parseISO(dateISO);
  const cs = cycleStart(vdi.renewalDate, dateISO);
  const { start, end } = coverageWindow(vdi, cs);
  if (dateTs < start || dateTs >= end) return 0;
  const windowDays = Math.round((end - start) / DAY_MS);
  const annual = vdi.annualCostGBP ?? vdiClassRate(reference, vdi.costClass, dateOnly(cs));
  return windowDays > 0 ? annual / windowDays : 0;
}

/** True iff the VDI's coverage window includes the day (cost > 0 that day). */
export function vdiAvailableOn(vdi: VdiCoverageInput, dateISO: string, reference: ReferenceJson): boolean {
  return vdiDailyCost(vdi, dateISO, reference) > 0;
}

/**
 * Count of days in [lo, hi] (inclusive, day granularity, ms timestamps aligned
 * to UTC midnight) where the VDI is available — replaces the old activeFrom/
 * activeTo-only `liveDays` capacity calculation so Capacity-page figures
 * follow reference edits (renewal/expiry/override) too.
 */
export function availableDaysInWindow(vdi: VdiCoverageInput, reference: ReferenceJson, loTs: number, hiTs: number): number {
  let count = 0;
  for (let ts = loTs; ts <= hiTs; ts += DAY_MS) {
    if (vdiAvailableOn(vdi, dateOnly(ts), reference)) count++;
  }
  return count;
}

// --- rate tables --------------------------------------------------------------

export interface RateTables {
  gradeRateOn(grade: string, dateISO: string): number;
  hubPoolPerDay(dateISO: string): number;
  spokeInfraPerDay(spokeName: string, dateISO: string): number;
  vdiDailyCostOn(resourceName: string, dateISO: string): number;
  // precomputed once from rows — they don't change across filter windows
  dayTotalWorktimeSec: Map<string, number>; // isoDate -> total bot-seconds, whole estate
  daySpokeWorktimeSec: Map<string, number>; // `${spokeName}|${isoDate}` -> bot-seconds
  // D4: pool cost on days with zero worktime across the whole estate (would
  // otherwise be silently dropped — hubCPS/spokeCPS collapse to 0 when their
  // worktime denominator is 0). Purely a transparency figure: NOT folded into
  // automationCost/netBenefit/costPerCase, which keep meaning "cost
  // attributable to work that ran". automationCost + unattributedCostGBP =
  // total estate spend, for P&L reconciliation.
  zeroWorktimePoolCostByDate: Map<string, number>;
}

/**
 * Builds the full rate-table structure by walking every calendar day from
 * dateMinISO to dateMaxISO once. Rebuild only when `reference` changes — the
 * caller (filters-context.tsx) memoizes this on [reference].
 */
export function buildRateTables(
  reference: ReferenceJson,
  rows: DayRow[],
  dateMinISO: string,
  dateMaxISO: string,
  dayWorktimeTotals?: Map<string, number>,
  spokeDayWorktimeTotals?: Map<string, number>,
): RateTables {
  // per-day worktime totals: whole estate, and per spoke (by NAME, since
  // ProcessDim.spoke / VdiDim.spoke are names, not ids). Prefer the true
  // totals baked by build-dashboard-data.mjs (computed from ALL items,
  // including unmapped-queue rows that model.dayRows/ROWS excludes) — only
  // recompute from `rows` for backward compat with an older model.json that
  // predates these fields, in which case unmapped-queue worktime (if any)
  // remains invisible to this engine, same as before this fix.
  let dayTotalWorktimeSec: Map<string, number>;
  let daySpokeWorktimeSec: Map<string, number>;
  if (dayWorktimeTotals && spokeDayWorktimeTotals) {
    dayTotalWorktimeSec = dayWorktimeTotals;
    daySpokeWorktimeSec = spokeDayWorktimeTotals;
  } else {
    dayTotalWorktimeSec = new Map<string, number>();
    daySpokeWorktimeSec = new Map<string, number>();
    for (const r of rows) {
      dayTotalWorktimeSec.set(r.date, (dayTotalWorktimeSec.get(r.date) ?? 0) + r.worktimeSec);
      const p = PROCESS_BY_ID.get(r.processId);
      if (p) {
        const k = `${p.spoke}|${r.date}`;
        daySpokeWorktimeSec.set(k, (daySpokeWorktimeSec.get(k) ?? 0) + r.worktimeSec);
      }
    }
  }

  const resourceByName = new Map<string, ResourceRef>(reference.resources.map((r) => [r.resourceName, r]));
  const spokeNameById = new Map<number, string>(reference.spokes.map((s) => [s.spokeId, s.spokeName]));

  const hubPerDayMap = new Map<string, number>();
  const spokeInfraPerDayMap = new Map<string, number>(); // `${spokeName}|${isoDate}` -> £/day
  const zeroWorktimePoolCostByDate = new Map<string, number>();

  const minTs = parseISO(dateMinISO);
  const maxTs = parseISO(dateMaxISO);
  for (let ts = minTs; ts <= maxTs; ts += DAY_MS) {
    const date = dateOnly(ts);

    let hubInfra = 0;
    const spokeInfra = new Map<number, number>();
    for (const s of reference.spokes) spokeInfra.set(s.spokeId, 0);
    for (const r of reference.resources) {
      const cost = vdiDailyCost(r, date, reference);
      if (r.spokeId == null) hubInfra += cost;
      else spokeInfra.set(r.spokeId, (spokeInfra.get(r.spokeId) ?? 0) + cost);
    }

    const hubPeoplePerDay = peopleCostOn(reference, "HUB", date) / 365.25;
    const hubPerDay = hubPeoplePerDay + hubInfra;
    hubPerDayMap.set(date, hubPerDay);

    let totalSpokeInfra = 0;
    for (const [sid, infra] of spokeInfra) {
      const name = spokeNameById.get(sid);
      if (name) spokeInfraPerDayMap.set(`${name}|${date}`, infra);
      totalSpokeInfra += infra;
    }

    const totalWt = dayTotalWorktimeSec.get(date) ?? 0;
    if (totalWt === 0) {
      zeroWorktimePoolCostByDate.set(date, hubPerDay + totalSpokeInfra);
    }
  }

  return {
    gradeRateOn: (grade, dateISO) => gradeRateOn(reference, grade, dateISO),
    hubPoolPerDay: (dateISO) => hubPerDayMap.get(dateISO) ?? 0,
    spokeInfraPerDay: (spokeName, dateISO) => spokeInfraPerDayMap.get(`${spokeName}|${dateISO}`) ?? 0,
    vdiDailyCostOn: (resourceName, dateISO) => {
      const r = resourceByName.get(resourceName);
      return r ? vdiDailyCost(r, dateISO, reference) : 0;
    },
    dayTotalWorktimeSec,
    daySpokeWorktimeSec,
    zeroWorktimePoolCostByDate,
  };
}

// --- per-row benefit / cost ----------------------------------------------------

/**
 * rateOverridePerHour: the "what-if" flat £/h slider (RATE_AUTO=0 meaning "use
 * each process's own grade rate"). Replaces ONLY the benefit calculation and
 * NEVER touches estate cost — that behavior must not change.
 */
export function benefitForRow(row: DayRow, process: ProcessDim, tables: RateTables, rateOverridePerHour: number): number {
  const hours = (row.completed * process.smvMinutes) / 60;
  return rateOverridePerHour ? hours * rateOverridePerHour : hours * tables.gradeRateOn(process.grade, row.date);
}

/**
 * Same day x spoke pool-share formula the pipeline collapses to when it sums
 * per-item worktime x (hubCPS + spokeCPS) for a fixed day/process — hubCPS
 * and spokeCPS are constant across items on the same day, so this is
 * mathematically identical to that sum, just computed directly on the row.
 */
export function costForRow(row: DayRow, process: ProcessDim, tables: RateTables): number {
  const totalWt = tables.dayTotalWorktimeSec.get(row.date) ?? 0;
  const spokeWt = tables.daySpokeWorktimeSec.get(`${process.spoke}|${row.date}`) ?? 0;
  const hubShare = totalWt ? tables.hubPoolPerDay(row.date) / totalWt : 0;
  const spokeShare = spokeWt ? tables.spokeInfraPerDay(process.spoke, row.date) / spokeWt : 0;
  return row.worktimeSec * (hubShare + spokeShare);
}

/**
 * Same cost formula as costForRow — this is a common point of confusion, so
 * to be explicit: the per-VDI apportionment IS the day/spoke worktime-share
 * formula above; a VDI's own coverage window only gates whether that VDI's
 * annual cost feeds hubPoolPerDay/spokeInfraPerDay that day (already baked in
 * by buildRateTables), it is NOT a separate per-VDI charge layered on top.
 * `vdi` is accepted for call-site symmetry with the resource-row aggregation
 * loop and is intentionally not read here.
 */
export function costForResRow(row: ResRow, vdi: VdiDim, process: ProcessDim, tables: RateTables): number {
  void vdi;
  const totalWt = tables.dayTotalWorktimeSec.get(row.date) ?? 0;
  const spokeWt = tables.daySpokeWorktimeSec.get(`${process.spoke}|${row.date}`) ?? 0;
  const hubShare = totalWt ? tables.hubPoolPerDay(row.date) / totalWt : 0;
  const spokeShare = spokeWt ? tables.spokeInfraPerDay(process.spoke, row.date) / spokeWt : 0;
  return row.worktimeSec * (hubShare + spokeShare);
}

/**
 * Exception "rework" cost — SMV x grade rate in force on the exception's OWN
 * date (row.date), valuing the manual redo effort a failed item would take a
 * colleague. Same shape as benefitForRow's formula, applied to exception
 * counts instead of completions. Mirrors bp-sql-layer/scripts/08_report_views.sql's
 * report.vw_ExceptionCost.ReworkCostGBP EXACTLY (SUM of per-item
 * SMVMinutes x grade-hourly-rate-in-force) — an explicit UPPER BOUND per that
 * view's own comment: some retried items later completed, so no human
 * actually reworked them. This is NOT worktime x estate £/bot-second (that's
 * costForRow/automation cost) — vw_ExceptionCost never aggregates
 * EstateCostGBP for exceptions, only ReworkGBP, so this does the same.
 *
 * Because ExcRow already carries its own date + processId (grain: date x
 * process x reason), this is EXACT at every grain — no worktime-share
 * apportionment needed (unlike costForRow, grade rate doesn't depend on a
 * day's total worktime denominator).
 */
export function reworkCostForRow(row: ExcRow, process: ProcessDim, tables: RateTables): number {
  const hours = (row.count * process.smvMinutes) / 60;
  return hours * tables.gradeRateOn(process.grade, row.date);
}
