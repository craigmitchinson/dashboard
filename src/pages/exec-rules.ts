// ---------------------------------------------------------------------------
// src/pages/exec-rules.ts
// ---------------------------------------------------------------------------
// Pure, side-effect-free helpers for the Executive Summary page — period
// window math and the three-sentence briefing builder. No React, kept
// deliberately independent of ExecutiveSummary.tsx's rendering so the
// period-boundary and wording logic can be unit-tested in isolation (see
// tests/exec-rules.test.ts). Money formatting is duplicated locally in a
// small helper (rather than importing components/viz.tsx's fmtGBPc) so this
// module stays a plain data/string module, matching value-rules.ts's
// "no React, no formatting owned elsewhere" convention as closely as
// possible while still needing to hand back full sentences.
//
// fiscalYearBounds is DELIBERATELY reimplemented here (byte-for-byte
// identical to filters-context.tsx's own copy) rather than imported from
// there — filters-context.tsx transitively pulls in the whole app (auth,
// reference, data client), which makes this module's unit tests fragile to
// unrelated churn elsewhere. ExecutiveSummary.tsx (which already depends on
// the real provider tree at render time) imports the canonical copy from
// filters-context.tsx directly; this local copy exists ONLY for this pure,
// dependency-free module and must be kept in sync if that logic ever changes.
// ---------------------------------------------------------------------------

const DAY = 86400000;

// [start, end) UTC ms bounds of the fiscal year containing dateTs — mirrors
// filters-context.tsx's fiscalYearBounds exactly (see the note above).
function fiscalYearBounds(dateTs: number, startMonth: number): { start: number; end: number } {
  const d = new Date(dateTs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const startMonthIdx = startMonth - 1;
  const fyStartYear = m >= startMonthIdx ? y : y - 1;
  return { start: Date.UTC(fyStartYear, startMonthIdx, 1), end: Date.UTC(fyStartYear + 1, startMonthIdx, 1) };
}

// --- fiscal-year-to-date window ---------------------------------------------
// The page shows FY-to-date only — no period picker. This resolves the
// fixed [fyStart, dateMaxTs] window plus the display strings for it, always
// anchored on `dateMaxTs` (the data-through date — NEVER today's real-world
// date). `fyStartMonth` is 1-based (1 = January), matching TargetsRef
// .fiscalYearStartMonth / FISCAL_YEAR_START_MONTH_DEFAULT.

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Jul 2026" — a compact, locale-independent day/month/year string. */
export function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTH_NAMES_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface FyToDateWindow {
  lo: number; // UTC ms, inclusive — the fiscal year's start
  hi: number; // UTC ms, inclusive — always dateMaxTs itself (never today)
  days: number; // inclusive day count from lo to hi
  fyLabel: string; // "FY 2026/27", or "FY 2026" when the fiscal year starts in January
  label: string; // "FY 2026/27 · 1 Apr 2026 to 14 Jul 2026 (105 days)"
}

/**
 * The fiscal year containing `dateMaxTs`, from its start through `dateMaxTs`
 * itself. A fiscal year that starts in a month other than January spans two
 * calendar years, so `fyLabel` shows both ("FY 2026/27" for a year starting
 * April 2026); a January start shows a single year ("FY 2026").
 */
export function fyToDateWindow(dateMaxTs: number, fyStartMonth: number): FyToDateWindow {
  const { start } = fiscalYearBounds(dateMaxTs, fyStartMonth);
  const startYear = new Date(start).getUTCFullYear();
  const fyLabel = fyStartMonth === 1 ? `FY ${startYear}` : `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
  const days = Math.round((dateMaxTs - start) / DAY) + 1;
  const label = `${fyLabel} · ${fmtDateShort(start)} to ${fmtDateShort(dateMaxTs)} (${days} day${days === 1 ? "" : "s"})`;
  return { lo: start, hi: dateMaxTs, days, fyLabel, label };
}

// --- hub scope --------------------------------------------------------------
// Each hub gets its own Executive Summary — this is NOT a hub-comparison
// page, so the scope control below reads as "which hub am I looking at",
// with "Estate" meaning the whole estate rather than any one hub.

export const ESTATE_SCOPE = "Estate";

export interface ScopeOption {
  value: string; // "Estate" or a spoke name (matches Filters.spoke / SPOKE_INFO keys)
  label: string;
}

export interface ScopeDerivation {
  options: ScopeOption[];
  defaultScope: string;
}

/**
 * Which hubs a signed-in user may pick on the Executive Summary page, and
 * which one is selected by default.
 *
 *  - A user scoped to one or more hubs (User.spokeIds non-empty — hub leads
 *    and spoke-scoped business users) sees ONLY their own hub(s), no
 *    "Estate" option at all, and defaults to the first one.
 *  - Anyone else (admin, or a CoE-wide hub_member/business_user with no
 *    spoke affiliation) sees "Estate" plus every hub, and defaults to
 *    "Estate".
 *
 * `allSpokes` is every spoke name in the estate (e.g. Object.keys(SPOKE_INFO)),
 * in display order — the caller owns that ordering, this function doesn't
 * re-sort it.
 */
export function deriveScopeOptions(userSpokeIds: string[], allSpokes: string[]): ScopeDerivation {
  if (userSpokeIds.length > 0) {
    return {
      options: userSpokeIds.map((s) => ({ value: s, label: s })),
      defaultScope: userSpokeIds[0],
    };
  }
  return {
    options: [{ value: ESTATE_SCOPE, label: ESTATE_SCOPE }, ...allSpokes.map((s) => ({ value: s, label: s }))],
    defaultScope: ESTATE_SCOPE,
  };
}

/**
 * Validates a scope value read back from localStorage (`bp-exec-scope-v1::
 * {userId}`, see ExecutiveSummary.tsx) against the CURRENT option set for
 * this user — a value that no longer applies (e.g. a stale "Estate" for a
 * user who has since been scoped to a hub, or a hub the user no longer
 * belongs to) falls back to `defaultScope` rather than being trusted as-is.
 */
export function resolveStoredScope(stored: string | null | undefined, options: ScopeOption[], defaultScope: string): string {
  if (stored && options.some((o) => o.value === stored)) return stored;
  return defaultScope;
}

// --- by-proposition aggregation ---------------------------------------------
// Powers the "By proposition" table shown once a hub is selected (replacing
// "By hub", which only makes sense for the Estate view). Deliberately a
// lightweight aggregation over an already-computed Model.byProcess array
// (each ProcessAgg already carries its own `.proposition`) rather than N
// extra computeModel() calls (one per proposition) — see the ExecutiveSummary
// task note on this choice. Net = benefit - runtimeCost per process, summed;
// cost per case = summed runtimeCost / summed completed.

export interface PropositionSourceRow {
  proposition: string;
  completed: number;
  exceptions: number;
  attempts: number;
  benefit: number;
  runtimeCost: number;
}

export interface PropositionAgg {
  proposition: string;
  net: number;
  completed: number;
  exceptions: number;
  attempts: number;
  cost: number;
  costPerCase: number;
}

/** One row per distinct proposition found in `rows`, net-benefit descending. */
export function aggregateByProposition(rows: PropositionSourceRow[]): PropositionAgg[] {
  const map = new Map<string, PropositionAgg>();
  for (const r of rows) {
    let a = map.get(r.proposition);
    if (!a) {
      a = { proposition: r.proposition, net: 0, completed: 0, exceptions: 0, attempts: 0, cost: 0, costPerCase: 0 };
      map.set(r.proposition, a);
    }
    a.net += r.benefit - r.runtimeCost;
    a.completed += r.completed;
    a.exceptions += r.exceptions;
    a.attempts += r.attempts;
    a.cost += r.runtimeCost;
  }
  return [...map.values()].map((a) => ({ ...a, costPerCase: a.completed ? a.cost / a.completed : 0 })).sort((a, b) => b.net - a.net);
}

// --- movers --------------------------------------------------------------

export interface MoverLike {
  id: string;
  name: string;
  net: number;
}

/** Top `n` processes by net benefit, highest first. */
export function topMovers<T extends MoverLike>(rows: T[], n = 3): T[] {
  return [...rows].sort((a, b) => b.net - a.net).slice(0, n);
}

/** Loss-making processes (net < 0), worst (most negative) first. */
export function bottomLossMakers<T extends MoverLike>(rows: T[], n = 3): T[] {
  return [...rows]
    .filter((r) => r.net < 0)
    .sort((a, b) => a.net - b.net)
    .slice(0, n);
}

// --- period-over-period comparison -----------------------------------------
// Shared by the Briefing headline (fiscal-year-to-date vs prior FYTD) and the
// Executive Summary page's own Net benefit KPI sub-line (this period vs the
// prior period) — a plain "up/down X%" reads as nonsense once either side of
// the comparison is negative or zero (e.g. "-£236.18, up 92.3%"), so both
// callers need the same three-way branch: a clean percentage only when BOTH
// values are strictly positive; otherwise say whether it improved, worsened
// or stayed the same, in cash terms, against the prior figure; and when
// there is no usable prior figure at all (zero, or non-finite), say so
// rather than compute anything.

export type PeriodComparison = { kind: "pct"; pct: number } | { kind: "improved" | "worsened" | "unchanged"; prior: number } | { kind: "none" };

export function comparePeriods(current: number, prior: number): PeriodComparison {
  if (!Number.isFinite(prior) || prior === 0) return { kind: "none" };
  if (current > 0 && prior > 0) {
    return { kind: "pct", pct: (current - prior) / Math.abs(prior) };
  }
  if (current > prior) return { kind: "improved", prior };
  if (current < prior) return { kind: "worsened", prior };
  return { kind: "unchanged", prior };
}

/**
 * Turns a PeriodComparison into a labelled trend string — direction,
 * magnitude AND (unless `withBasis: false`) basis, never a bare arrow.
 * `withBasis: false` drops the trailing "vs same point last FY"/"last FY"
 * wording for table cells and inline figures where the column header or
 * surrounding text already states the comparison point once, rather than
 * repeating it on every row (e.g. the By hub/By proposition "Trend (vs last
 * FY)" column, and Value league's muted secondary figure "£99.9k · ▲ 18%").
 */
export function trendLabel(cmp: PeriodComparison, opts?: { withBasis?: boolean }): string {
  const withBasis = opts?.withBasis ?? true;
  if (cmp.kind === "none") return withBasis ? "no comparable figure last FY" : "no comparable figure";
  if (cmp.kind === "pct") {
    const arrow = cmp.pct >= 0 ? "▲" : "▼";
    return `${arrow} ${(Math.abs(cmp.pct) * 100).toFixed(1)}%${withBasis ? " vs same point last FY" : ""}`;
  }
  return `${cmp.kind} from ${fmtGBPLocal(cmp.prior)}${withBasis ? " last FY" : ""}`;
}

// --- hub-scoped alert ordering ----------------------------------------------

export interface HubScopedAlertLike {
  scope: string;
  spokeFilter?: string;
}

/**
 * Reorders an already-severity-sorted alert list (sortAlerts, alerts/format.ts)
 * so a hub's OWN alerts (spoke/process/vdi-scope alerts whose spokeFilter is
 * this hub) come before estate-scope alerts — a hub lead looking at their own
 * Executive Summary should see their own problems first, with estate-wide
 * alerts only filling remaining slots, not crowding them out. A stable
 * partition (Array#filter preserves relative order), so severity order is
 * preserved WITHIN each group. Only meaningful for a hub view — the Estate
 * view shows every alert in `sortAlerts`' own order, unchanged, and should
 * not call this.
 */
export function orderHubAlerts<T extends HubScopedAlertLike>(alerts: T[], hub: string): T[] {
  const own = alerts.filter((a) => a.spokeFilter === hub);
  const estate = alerts.filter((a) => a.scope === "estate");
  return [...own, ...estate];
}

// --- briefing --------------------------------------------------------------

export interface BriefingInput {
  fyToDateNet: number;
  fyToDatePriorNet: number;
  /** The estate's annual net benefit target (financeTargets, spokeId
   *  "ESTATE"), or undefined when none is configured. */
  estateTarget?: number;
  /** fyAttainment(...).onTrack against estateTarget — only meaningful when
   *  estateTarget is set. */
  onTrack?: boolean;
  /** Plain-English headline (alerts/format.ts's headlineFor) of the single
   *  worst breach-severity alert, if any exist. */
  worstBreachHeadline?: string;
  /** Fallback when there is no breach: the process with the highest
   *  exception rate that is currently above the estate's exceptionRate
   *  target. */
  worstExceptionProcess?: { name: string; rate: number };
  /** The top loss-making process (by most negative net) and the reason it
   *  was flagged (classifyReviewCandidate, value-rules.ts). */
  topReviewCandidate?: { name: string; reason: string };
}

export interface Briefing {
  headline: string;
  risk: string;
  action: string;
}

// Small local money formatter — mirrors components/viz.tsx's fmtGBPc exactly
// (compact £k/£M, sign before the symbol, "—" for non-finite) but kept local
// so this module has no dependency on the React-facing viz toolkit.
function fmtGBPLocal(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return sign + "£" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return sign + "£" + (a / 1e3).toFixed(1) + "k";
  return sign + "£" + a.toFixed(2);
}

/**
 * Builds the three Briefing sentences shown on the Executive Summary page.
 * Pure — every input is a plain value already derived from the live model,
 * alerts and reference data by ExecutiveSummary.tsx.
 */
export function buildBriefing(input: BriefingInput): Briefing {
  const { fyToDateNet, fyToDatePriorNet, estateTarget, onTrack, worstBreachHeadline, worstExceptionProcess, topReviewCandidate } = input;

  const cmp = comparePeriods(fyToDateNet, fyToDatePriorNet);
  const changePhrase =
    cmp.kind === "none"
      ? ", with no comparable figure last fiscal year"
      : cmp.kind === "pct"
        ? `, ${cmp.pct >= 0 ? "up" : "down"} ${(Math.abs(cmp.pct) * 100).toFixed(1)}% vs the same point last fiscal year`
        : `, ${cmp.kind} from ${fmtGBPLocal(cmp.prior)} at the same point last fiscal year`;
  const targetPhrase = estateTarget === undefined ? "" : onTrack ? " — on track to meet the annual target" : " — behind the annual target";
  const headline = `Fiscal-year-to-date net benefit is ${fmtGBPLocal(fyToDateNet)}${changePhrase}${targetPhrase}.`;

  const risk = worstBreachHeadline
    ? `Highest-priority risk: ${worstBreachHeadline}.`
    : worstExceptionProcess
      ? `Highest-priority risk: ${worstExceptionProcess.name} is running an exception rate of ${(worstExceptionProcess.rate * 100).toFixed(1)}%, above target.`
      : "No thresholds breached.";

  const action = topReviewCandidate ? `Recommended action: review ${topReviewCandidate.name} — ${topReviewCandidate.reason}` : "No processes running at a loss.";

  return { headline, risk, action };
}
