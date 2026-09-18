// ---------------------------------------------------------------------------
// target-rules.ts
// ---------------------------------------------------------------------------
// Pure (no React) helpers for "is this KPI value meeting its target" logic,
// extracted out of the individual page components so the target-chip /
// watchlist / league-table colouring logic can be unit tested without
// rendering React.
//
// `resolvedTarget` is the one source of truth every owned page should use to
// read a target/threshold value: it reads reference.targets (the editable
// store — see src/reference/reference-store.ts) and, when a single spoke is
// selected, resolves that spoke's override via resolveThreshold(). This is
// what makes an edit in Administration -> Targets & thresholds move both the
// alerts (src/alerts/engine.ts, unchanged) AND the KPI target chips / chart
// reference lines on these pages (previously the pages read the baked
// build-time constant instead, which never reflected edits).
//
// `rateBand` mirrors alerts/engine.ts's classify() warn-band convention
// (WARN_MARGIN) for a "max is good" rate metric (exceptionRate, systemRate,
// costPerCase): "bad" strictly above target, "warn" within warnMargin's
// fraction of the target below it, "ok" otherwise. Pass
// alerts/engine.ts's own WARN_MARGIN as `warnMargin` so every consumer of
// this band means exactly the same thing the alerting system does.
// ---------------------------------------------------------------------------
import type { ReferenceJson, TargetsRef } from "../reference/reference-store";
import { resolveThreshold } from "../reference/reference-store";

/** "min" target: met when value >= target (e.g. completion rate). */
export function targetMetAtLeast(value: number, target: number): boolean {
  return value >= target;
}

/** "max" target: met when value <= target (e.g. cost per case, exception rate). */
export function targetMetAtMost(value: number, target: number): boolean {
  return value <= target;
}

/** Band target: met when value sits within [min, max] (e.g. utilisation). */
export function utilWithinBand(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export type RateBand = "bad" | "warn" | "ok";

/** See file header — same convention as alerts/engine.ts's classify() for a
 *  "max is good" rate metric. */
export function rateBand(value: number, target: number, warnMargin: number): RateBand {
  if (value > target) return "bad";
  if (value > target * (1 - warnMargin)) return "warn";
  return "ok";
}

/**
 * The effective value of one global target metric for the current filter
 * selection: the process-independent spoke override (if one exists and a
 * single spoke is selected) wins over reference.targets[metric] — exactly
 * resolveThreshold's scope="spoke" precedence, just defaulting to the global
 * value when `spoke` is the "All" sentinel (no single spoke selected, so
 * there's nothing to look up an override for).
 */
export function resolvedTarget(reference: ReferenceJson, metric: keyof TargetsRef, spoke: string): number {
  if (spoke !== "All") return resolveThreshold(reference, metric, "spoke", spoke);
  return reference.targets[metric] as number;
}
