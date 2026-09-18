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

// --- period window -----------------------------------------------------------

export type PeriodKind = "month" | "lastMonth" | "qtd" | "fytd";

export interface PeriodWindow {
  lo: number; // UTC ms, inclusive
  hi: number; // UTC ms, inclusive — always dateMaxTs itself (never today)
  label: string;
}

/**
 * Resolves one of the Executive Summary's four period options into an
 * inclusive [lo, hi] UTC-ms window, anchored on `dateMaxTs` (the data-through
 * date — NEVER today's real-world date). `fyStartMonth` is 1-based (1 =
 * January), matching TargetsRef.fiscalYearStartMonth /
 * FISCAL_YEAR_START_MONTH_DEFAULT.
 *
 *  - "month": from the 1st of the calendar month containing dateMaxTs,
 *    through dateMaxTs.
 *  - "lastMonth": the FULL preceding calendar month (1st through last day) —
 *    hi is NOT dateMaxTs when dateMaxTs isn't the last day of its month.
 *  - "qtd": from the 1st of the fiscal quarter containing dateMaxTs (fiscal
 *    quarters are 3-month blocks starting at fyStartMonth, fyStartMonth+3,
 *    …), through dateMaxTs.
 *  - "fytd": from the fiscal year start (fiscalYearBounds) through
 *    dateMaxTs.
 */
export function periodWindow(kind: PeriodKind, dateMaxTs: number, fyStartMonth: number): PeriodWindow {
  const d = new Date(dateMaxTs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();

  if (kind === "month") {
    return { lo: Date.UTC(y, m, 1), hi: dateMaxTs, label: "This month" };
  }
  if (kind === "lastMonth") {
    const lo = Date.UTC(y, m - 1, 1);
    const hi = Date.UTC(y, m, 1) - DAY;
    return { lo, hi, label: "Last month" };
  }

  const { start: fyStart } = fiscalYearBounds(dateMaxTs, fyStartMonth);
  if (kind === "fytd") {
    return { lo: fyStart, hi: dateMaxTs, label: "FY to date" };
  }

  // "qtd" — fiscal quarter containing dateMaxTs, aligned to fyStart.
  const fyStartDate = new Date(fyStart);
  const fyStartY = fyStartDate.getUTCFullYear();
  const fyStartM = fyStartDate.getUTCMonth();
  const monthsElapsed = (y - fyStartY) * 12 + (m - fyStartM);
  const quarterIdx = Math.floor(monthsElapsed / 3);
  const qStart = Date.UTC(fyStartY, fyStartM + quarterIdx * 3, 1);
  return { lo: qStart, hi: dateMaxTs, label: "Quarter to date" };
}

export const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "qtd", label: "Quarter to date" },
  { value: "fytd", label: "FY to date" },
];

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

  const pctChange = fyToDatePriorNet !== 0 ? (fyToDateNet - fyToDatePriorNet) / Math.abs(fyToDatePriorNet) : undefined;
  const changePhrase =
    pctChange === undefined ? "" : `, ${pctChange >= 0 ? "up" : "down"} ${(Math.abs(pctChange) * 100).toFixed(1)}% vs the same point last fiscal year`;
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
