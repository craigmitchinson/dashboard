// ---------------------------------------------------------------------------
// alerts/engine.ts
// ---------------------------------------------------------------------------
// Pure (no React) threshold/alerting evaluation engine. Walks the trailing
// WINDOW_DAYS window of the loaded dataset at four scopes (estate, spoke,
// process, vdi) and flags any metric that has breached or is nearing its
// resolved threshold (global target, optionally overridden per spoke/process
// via reference.thresholdOverrides — see reference-store.ts). No ordering is
// applied here — the caller (UI layer) sorts the flat Alert[] for display.
// ---------------------------------------------------------------------------
import { ROWS, RES_ROWS, DATE_MAX, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS, SPOKES, PROCESSES, PROCESS_BY_ID, VDIS, VDI_OPERATING_HOURS } from "../rpaData";
import type { DayRow } from "../rpaData";
import { buildRateTables, costForRow, availableDaysInWindow } from "../reference/economics";
import type { ReferenceJson, TargetsRef } from "../reference/reference-store";
import { resolveThreshold } from "../reference/reference-store";

const DAY_MS = 86400000;
export const WINDOW_DAYS = 7;
/** Below this many completed+exception items in the trailing window, a
 *  per-process rate (e.g. a 1-item process hitting 100% exceptions) is noise,
 *  not a signal — skip per-process evaluation entirely for that process. */
export const MIN_ALERT_VOLUME = 30;
/** A value within this fraction of its threshold (but not yet past it) is a
 *  "warn"; past it is a "breach". Named so the 10% isn't a magic number
 *  scattered through the evaluation logic. */
export const WARN_MARGIN = 0.10;

export type AlertMetric = "completionPct" | "exceptionRate" | "systemRate" | "costPerCase" | "utilisation";
export type AlertScope = "estate" | "spoke" | "process" | "vdi";

export interface Alert {
  id: string; // `${metric}|${scope}|${scopeId}|${dataThroughISO}` — stable per data build
  severity: "warn" | "breach";
  metric: AlertMetric;
  scope: AlertScope;
  scopeLabel: string; // human-readable, e.g. "Estate-wide", a spoke name, a process name, a VDI name
  value: number;
  threshold: number;
  direction: "min" | "max"; // "min" = threshold is a floor (render "≥"), "max" = ceiling (render "≤") — set explicitly at construction, never re-derived from value/threshold (see classify()'s warn-band, which can put value on either side of threshold)
  windowLabel: string; // e.g. "7 days to 16 Jul 2026"
  pageId: string; // where "View" should navigate
  spokeFilter?: string; // set on filters.spoke by "View", when scoped to a spoke or a spoke's process
  processFilter?: string; // set on filters.processId by "View", when scoped to a process
}

type RateMetric = "completionPct" | "exceptionRate" | "systemRate" | "costPerCase";

const RATE_METRICS: RateMetric[] = ["completionPct", "exceptionRate", "systemRate", "costPerCase"];

const RATE_METRIC_DIRECTION: Record<RateMetric, "min" | "max"> = {
  completionPct: "min",
  exceptionRate: "max",
  systemRate: "max",
  costPerCase: "max",
};

const RATE_METRIC_PAGE: Record<RateMetric, string> = {
  completionPct: "overview",
  exceptionRate: "exceptions",
  systemRate: "exceptions",
  costPerCase: "commercial",
};

const PROCESS_METRIC_PAGE: Record<RateMetric, string> = {
  completionPct: "process-detail",
  exceptionRate: "exceptions",
  systemRate: "exceptions",
  costPerCase: "process-detail",
};

function classify(value: number, threshold: number, direction: "min" | "max"): "breach" | "warn" | null {
  if (direction === "min") {
    if (value < threshold) return "breach";
    // Warn band's upper edge is WARN_MARGIN of the remaining headroom above
    // the threshold up to the natural ceiling (1.0), NOT threshold*(1+WARN_MARGIN) —
    // that multiplicative form collapses to "always warn, never clear" once
    // threshold >= ~0.909 (a 91%+ floor target, which completion-rate targets
    // commonly are), since threshold*(1+WARN_MARGIN) would exceed 1.0 and the
    // value can never clear it. This form stays well-defined at any threshold.
    const warnCeiling = threshold + (1 - threshold) * WARN_MARGIN;
    if (value < warnCeiling) return "warn";
    return null;
  }
  if (value > threshold) return "breach";
  if (value > threshold * (1 - WARN_MARGIN)) return "warn";
  return null;
}

interface RateAggregate {
  completionPct: number;
  exceptionRate: number;
  systemRate: number;
  costPerCase: number;
  attempts: number;
}

function aggregateRates(rows: DayRow[], tables: ReturnType<typeof buildRateTables>): RateAggregate {
  let completed = 0;
  let business = 0;
  let system = 0;
  let estateCost = 0;
  for (const r of rows) {
    completed += r.completed;
    business += r.business;
    system += r.system;
    const process = PROCESS_BY_ID.get(r.processId);
    if (process) estateCost += costForRow(r, process, tables);
  }
  const exceptions = business + system;
  const attempts = completed + exceptions;
  return {
    completionPct: attempts ? completed / attempts : 0,
    exceptionRate: attempts ? exceptions / attempts : 0,
    systemRate: attempts ? system / attempts : 0,
    costPerCase: completed ? estateCost / completed : 0,
    attempts,
  };
}

export function evaluateAlerts(reference: ReferenceJson): Alert[] {
  const hi = DATE_MAX;
  const lo = DATE_MAX - (WINDOW_DAYS - 1) * DAY_MS;
  const windowLabel = `${WINDOW_DAYS} days to ${new Date(hi).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  const dataThroughISO = DATA_MAX_ISO;

  const tables = buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS);

  const rows = ROWS.filter((r) => r.ts >= lo && r.ts <= hi);
  const resRows = RES_ROWS.filter((r) => r.ts >= lo && r.ts <= hi);

  const alerts: Alert[] = [];

  const makeId = (metric: AlertMetric, scope: AlertScope, scopeId: string) => `${metric}|${scope}|${scopeId}|${dataThroughISO}`;

  function pushRateAlerts(
    scope: AlertScope,
    scopeId: string,
    scopeLabel: string,
    agg: RateAggregate,
    thresholdFor: (metric: RateMetric) => number,
    pageFor: (metric: RateMetric) => string,
    spokeFilter: string | undefined,
    processFilter: string | undefined,
  ) {
    for (const metric of RATE_METRICS) {
      const value = agg[metric];
      const threshold = thresholdFor(metric);
      const direction = RATE_METRIC_DIRECTION[metric];
      const severity = classify(value, threshold, direction);
      if (!severity) continue;
      alerts.push({
        id: makeId(metric, scope, scopeId),
        severity,
        metric,
        scope,
        scopeLabel,
        value,
        threshold,
        direction,
        windowLabel,
        pageId: pageFor(metric),
        spokeFilter,
        processFilter,
      });
    }
  }

  // --- estate scope ---
  const estateAgg = aggregateRates(rows, tables);
  pushRateAlerts(
    "estate",
    "estate",
    "Estate-wide",
    estateAgg,
    (metric) => reference.targets[metric],
    (metric) => RATE_METRIC_PAGE[metric],
    undefined,
    undefined,
  );

  // --- spoke scope ---
  for (const spokeName of SPOKES) {
    const spokeRows = rows.filter((r) => PROCESS_BY_ID.get(r.processId)?.spoke === spokeName);
    const agg = aggregateRates(spokeRows, tables);
    if (agg.attempts === 0) continue;
    pushRateAlerts(
      "spoke",
      spokeName,
      spokeName,
      agg,
      (metric) => resolveThreshold(reference, metric as keyof TargetsRef, "spoke", spokeName),
      (metric) => RATE_METRIC_PAGE[metric],
      spokeName,
      undefined,
    );
  }

  // --- process scope ---
  for (const process of PROCESSES) {
    const processRows = rows.filter((r) => r.processId === process.id);
    const completed = processRows.reduce((sum, r) => sum + r.completed, 0);
    const exceptions = processRows.reduce((sum, r) => sum + r.business + r.system, 0);
    if (completed + exceptions < MIN_ALERT_VOLUME) continue;
    const agg = aggregateRates(processRows, tables);
    pushRateAlerts(
      "process",
      process.id,
      process.name,
      agg,
      (metric) => resolveThreshold(reference, metric as keyof TargetsRef, "process", process.id),
      (metric) => PROCESS_METRIC_PAGE[metric],
      process.spoke,
      process.id,
    );
  }

  // --- vdi scope ---
  for (const vdi of VDIS) {
    const vdiResRows = resRows.filter((r) => r.resource === vdi.id);
    const activeHours = vdiResRows.reduce((sum, r) => sum + r.worktimeSec, 0) / 3600;
    const availableHours = availableDaysInWindow(vdi, reference, lo, hi) * VDI_OPERATING_HOURS;
    if (availableHours === 0) continue;
    const utilPct = availableHours ? Math.min(1, activeHours / availableHours) : 0;
    const utilMin = resolveThreshold(reference, "utilMin", "spoke", vdi.spoke);
    const utilMax = resolveThreshold(reference, "utilMax", "spoke", vdi.spoke);

    let severity = classify(utilPct, utilMin, "min");
    let threshold = utilMin;
    let direction: "min" | "max" = "min";
    if (!severity) {
      severity = classify(utilPct, utilMax, "max");
      threshold = utilMax;
      direction = "max";
    }
    if (!severity) continue;

    alerts.push({
      id: makeId("utilisation", "vdi", vdi.id),
      severity,
      metric: "utilisation",
      scope: "vdi",
      scopeLabel: vdi.name,
      value: utilPct,
      threshold,
      direction,
      windowLabel,
      pageId: "capacity",
      spokeFilter: vdi.spoke === "Hub" ? undefined : vdi.spoke,
      processFilter: undefined,
    });
  }

  return alerts;
}

/**
 * Per-alert trailing daily series (oldest first, WINDOW_DAYS entries) in the
 * same units as Alert.value, for the Alerts page's inline trend sparkline.
 * Recomputes the SAME aggregate evaluateAlerts() uses for that alert's scope,
 * narrowed to one day at a time, over the identical trailing window ending at
 * DATE_MAX.
 *
 * Day-bucketing choice: ROWS/RES_ROWS are built by rpaData.ts's initData() via
 * `ts: tsOf(r.d)`, where tsOf parses each row's date string as exact UTC
 * midnight (`Date.parse(d + "T00:00:00Z")`). Every row is one-per-(date,
 * process/resource) at that exact boundary — there is no sub-day timestamp
 * drift and no local-timezone/DST involved (parsing is always against the
 * UTC "Z" suffix), so exact `ts === dayTs` equality is a safe, simplest
 * bucket key here. A bucket-index form (`Math.floor((r.ts - lo)/DAY_MS)`)
 * would be needed only if rows could carry intra-day timestamps or a
 * non-UTC calendar — neither is true of this dataset.
 */
export function dailySeriesFor(alert: Alert, reference: ReferenceJson, tables?: ReturnType<typeof buildRateTables>): number[] {
  const hi = DATE_MAX;
  tables ??= buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS);

  const out: number[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const dayTs = hi - i * DAY_MS;

    if (alert.metric === "utilisation") {
      // Correlate back to the VDI via scopeLabel (== vdi.name, set at
      // construction above) — VDI names are effectively unique in this fixed
      // dataset (one row per VdiDim, sourced 1:1 from resources.json), so
      // this lookup is safe as a correlating key.
      const vdi = VDIS.find((v) => v.name === alert.scopeLabel);
      if (!vdi) {
        out.push(0);
        continue;
      }
      const dayResRows = RES_ROWS.filter((r) => r.ts === dayTs && r.resource === vdi.id);
      const activeHours = dayResRows.reduce((sum, r) => sum + r.worktimeSec, 0) / 3600;
      const availableHours = availableDaysInWindow(vdi, reference, dayTs, dayTs) * VDI_OPERATING_HOURS;
      out.push(availableHours ? Math.min(1, activeHours / availableHours) : 0);
      continue;
    }

    let dayRows = ROWS.filter((r) => r.ts === dayTs);
    if (alert.scope === "spoke") {
      dayRows = dayRows.filter((r) => PROCESS_BY_ID.get(r.processId)?.spoke === alert.spokeFilter);
    } else if (alert.scope === "process") {
      dayRows = dayRows.filter((r) => r.processId === alert.processFilter);
    }
    // estate scope: no additional filter beyond the day itself.
    const agg = aggregateRates(dayRows, tables);
    out.push(agg[alert.metric as RateMetric]);
  }
  return out;
}
