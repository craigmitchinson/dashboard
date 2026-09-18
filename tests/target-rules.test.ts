// ---------------------------------------------------------------------------
// tests/target-rules.test.ts
// ---------------------------------------------------------------------------
// src/pages/target-rules.ts — the pure "target met" / rate-band helpers
// extracted from Overview.tsx's KPI target chips and watchlist colouring
// (and shared by InputOutcome/Capacity/ValueFinance/ProcessAnalysis), plus
// resolvedTarget's spoke-override precedence. Exercises the underlying
// logic directly rather than rendering the React pages, per this task's
// verification note.
//
// The specific scenario this task asked to prove: changing
// reference.targets.completionPct changes what the Overview target chip
// considers "met" — i.e. resolvedTarget() reads the live reference.targets
// value, not a baked constant.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { resolvedTarget, targetMetAtLeast, targetMetAtMost, utilWithinBand, rateBand } from "../src/pages/target-rules";
import { makeReference } from "./fixtures";

describe("resolvedTarget: reads the live reference.targets, not a baked constant", () => {
  it("a changed reference.targets.completionPct changes the resolved target (and so the KPI chip's met/unmet outcome)", () => {
    const reference = makeReference({ targets: { ...makeReference().targets, completionPct: 0.95 } });
    expect(resolvedTarget(reference, "completionPct", "All")).toBe(0.95);
    expect(targetMetAtLeast(0.94, resolvedTarget(reference, "completionPct", "All"))).toBe(false);

    const edited = makeReference({ targets: { ...reference.targets, completionPct: 0.9 } });
    expect(resolvedTarget(edited, "completionPct", "All")).toBe(0.9);
    // The exact same observed value (0.94) now meets the target purely
    // because the reference edit lowered it — proving the chip logic reads
    // reference.targets live rather than a baked/frozen value.
    expect(targetMetAtLeast(0.94, resolvedTarget(edited, "completionPct", "All"))).toBe(true);
  });

  it("resolves a spoke-scoped override when a single spoke is selected", () => {
    const reference = makeReference({
      targets: { ...makeReference().targets, completionPct: 0.95 },
      thresholdOverrides: [{ scope: "spoke", scopeId: "Risk", metric: "completionPct", value: 0.8 }],
    });
    expect(resolvedTarget(reference, "completionPct", "Risk")).toBe(0.8);
    expect(resolvedTarget(reference, "completionPct", "All")).toBe(0.95);
    // A different spoke with no override falls back to the global target.
    expect(resolvedTarget(reference, "completionPct", "Commercial")).toBe(0.95);
  });
});

describe("targetMetAtLeast / targetMetAtMost / utilWithinBand", () => {
  it("targetMetAtLeast is met at and above the target (floor)", () => {
    expect(targetMetAtLeast(0.95, 0.95)).toBe(true);
    expect(targetMetAtLeast(0.96, 0.95)).toBe(true);
    expect(targetMetAtLeast(0.94, 0.95)).toBe(false);
  });

  it("targetMetAtMost is met at and below the target (ceiling)", () => {
    expect(targetMetAtMost(9, 9)).toBe(true);
    expect(targetMetAtMost(8, 9)).toBe(true);
    expect(targetMetAtMost(10, 9)).toBe(false);
  });

  it("utilWithinBand is met inside [min, max] inclusive", () => {
    expect(utilWithinBand(0.15, 0.15, 0.6)).toBe(true);
    expect(utilWithinBand(0.6, 0.15, 0.6)).toBe(true);
    expect(utilWithinBand(0.14, 0.15, 0.6)).toBe(false);
    expect(utilWithinBand(0.61, 0.15, 0.6)).toBe(false);
  });
});

describe("rateBand: same WARN_MARGIN convention as alerts/engine.ts's classify()", () => {
  const WARN_MARGIN = 0.1;

  it("bad strictly above target", () => {
    expect(rateBand(0.07, 0.06, WARN_MARGIN)).toBe("bad");
  });

  it("warn within the warn margin below target", () => {
    // 0.06 * (1 - 0.1) = 0.054 — just above that is "warn"
    expect(rateBand(0.058, 0.06, WARN_MARGIN)).toBe("warn");
  });

  it("ok at or below the warn band's lower edge", () => {
    expect(rateBand(0.05, 0.06, WARN_MARGIN)).toBe("ok");
  });

  it("boundary: exactly at target is bad only when strictly greater — at target itself is warn, not bad", () => {
    expect(rateBand(0.06, 0.06, WARN_MARGIN)).toBe("warn");
  });
});
