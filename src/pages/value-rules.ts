// ---------------------------------------------------------------------------
// src/pages/value-rules.ts
// ---------------------------------------------------------------------------
// Pure, side-effect-free helpers extracted out of ValueFinance.tsx so their
// branch order / math can be unit-tested in isolation from React rendering.
// No React, no formatting — callers own presentation (fmtGBPc/fmtMoney2/etc).
// ---------------------------------------------------------------------------
import type { ProcessAgg } from "../filters-context";
import type { TargetsRef } from "../reference/reference-store";

// --- review candidate classification ----------------------------------------

/**
 * Classifies WHY a loss-making process (net < 0) belongs on ValueFinance's
 * "Review candidates" table, matching that table's "Why" column tooltip copy
 * exactly. Branch order is significant — evaluated top to bottom, FIRST match
 * wins:
 *   1. Low volume: fewer than 30 completions this period — too few to
 *      amortise fixed cost.
 *   2. High exception cost: exception cost is more than 30% of this
 *      process's runtime (automation) cost.
 *   3. High unit cost: cost per completed item is more than 1.5x the
 *      estate's configured cost-per-case TARGET (reference.targets.costPerCase
 *      — not the window's own observed average, which moves with the data).
 *   4. Otherwise: generic "cost exceeds benefit at current volume/rate mix".
 */
export function classifyReviewCandidate(
  p: Pick<ProcessAgg, "completed" | "runtimeCost" | "exceptionCostGBP">,
  targets: Pick<TargetsRef, "costPerCase">,
): string {
  const unit = p.completed ? p.runtimeCost / p.completed : p.runtimeCost;
  if (p.completed < 30) {
    return `Low volume: only ${p.completed} completions this period — too few to amortise fixed cost.`;
  }
  if (p.exceptionCostGBP > p.runtimeCost * 0.3) {
    return "High exception cost: rework is costing more than 30% of this process's automation spend.";
  }
  if (p.runtimeCost / Math.max(1, p.completed) > targets.costPerCase * 1.5) {
    return `High unit cost: costs £${unit.toFixed(2)}/case, over 1.5× the target cost per case (£${targets.costPerCase.toFixed(2)}).`;
  }
  return "Cost exceeds benefit at the current volume and rate mix.";
}

// --- fiscal-year net-benefit target attainment -------------------------------

export interface FyAttainmentInput {
  /** Net benefit accrued so far this fiscal year, through the current window's last day. */
  fyToDateNet: number;
  /** Current run-rate of net benefit per day (e.g. window net / window days). */
  runRateNetPerDay: number;
  /** Days remaining in the fiscal year AFTER the window's last day (see
   *  ValueFinance.tsx's daysRemainingInFY — deliberately excludes that last
   *  day itself, since it's already counted inside fyToDateNet). */
  daysRemaining: number;
  /** The annual net benefit target being measured against (ESTATE or one spoke). */
  target: number;
}

export interface FyAttainmentResult {
  /** Projected fiscal-year-end net benefit at the current run-rate:
   *  fyToDateNet + runRateNetPerDay * daysRemaining. */
  projected: number;
  /** projected / target (0 if target is 0, to avoid Infinity/NaN — target is
   *  expected to always be a positive number per the admin UI's validation,
   *  this is purely a defensive fallback). */
  pct: number;
  /** true when the projected FY-end net benefit meets or exceeds the target. */
  onTrack: boolean;
}

/**
 * FY-to-date net benefit attainment against an annual target, projected
 * forward at the current run-rate to fiscal-year-end. Pure function — see
 * ValueFinance.tsx for how the inputs are derived from the live model.
 */
export function fyAttainment({ fyToDateNet, runRateNetPerDay, daysRemaining, target }: FyAttainmentInput): FyAttainmentResult {
  const projected = fyToDateNet + runRateNetPerDay * daysRemaining;
  const pct = target !== 0 ? projected / target : 0;
  return { projected, pct, onTrack: projected >= target };
}
