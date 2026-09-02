// ---------------------------------------------------------------------------
// tests/value-rules.test.ts
// ---------------------------------------------------------------------------
// src/pages/value-rules.ts — classifyReviewCandidate's branch order (extracted
// from ValueFinance.tsx's "Review candidates" table) and fyAttainment's
// projection math (Finance settings target-attainment element).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { classifyReviewCandidate, fyAttainment } from "../src/pages/value-rules";

describe("classifyReviewCandidate: branch order (first match wins)", () => {
  const targets = { costPerCase: 9 };

  it("low volume (completed < 30) wins even when other conditions would also match", () => {
    const p = { completed: 10, runtimeCost: 1000, exceptionCostGBP: 900 }; // exception cost is 90% of runtime cost too
    expect(classifyReviewCandidate(p, targets)).toMatch(/^Low volume/);
  });

  it("high exception cost (>30% of runtime cost) wins over high unit cost when volume is fine", () => {
    const p = { completed: 50, runtimeCost: 1000, exceptionCostGBP: 400 }; // 40% > 30%; unit cost 20/case > 1.5x9=13.5 too
    expect(classifyReviewCandidate(p, targets)).toMatch(/^High exception cost/);
  });

  it("high unit cost (> 1.5x target cost per case) fires when volume and exception cost are both fine", () => {
    const p = { completed: 50, runtimeCost: 1000, exceptionCostGBP: 100 }; // 10% of runtime cost; unit cost 20/case > 13.5
    expect(classifyReviewCandidate(p, targets)).toMatch(/^High unit cost/);
  });

  it("falls through to the generic reason when none of the specific rules match", () => {
    const p = { completed: 100, runtimeCost: 500, exceptionCostGBP: 50 }; // unit cost 5/case, well under 13.5
    expect(classifyReviewCandidate(p, targets)).toBe("Cost exceeds benefit at the current volume and rate mix.");
  });

  it("boundary: exactly 30% exception cost does NOT trigger the high-exception-cost rule (strictly greater than)", () => {
    const p = { completed: 100, runtimeCost: 1000, exceptionCostGBP: 300 }; // exactly 30%
    expect(classifyReviewCandidate(p, targets)).not.toMatch(/^High exception cost/);
  });

  it("boundary: exactly 1.5x target cost per case does NOT trigger the high-unit-cost rule (strictly greater than)", () => {
    const p = { completed: 100, runtimeCost: 1350, exceptionCostGBP: 0 }; // unit cost exactly 13.5 = 1.5 * 9
    expect(classifyReviewCandidate(p, targets)).toBe("Cost exceeds benefit at the current volume and rate mix.");
  });

  it("boundary: completed === 30 does NOT trigger the low-volume rule (strictly less than)", () => {
    const p = { completed: 30, runtimeCost: 100, exceptionCostGBP: 0 };
    expect(classifyReviewCandidate(p, targets)).not.toMatch(/^Low volume/);
  });
});

describe("fyAttainment", () => {
  it("projects fyToDateNet forward by runRateNetPerDay * daysRemaining", () => {
    const result = fyAttainment({ fyToDateNet: 10000, runRateNetPerDay: 100, daysRemaining: 50, target: 20000 });
    expect(result.projected).toBe(15000); // 10000 + 100*50
  });

  it("pct is projected / target", () => {
    const result = fyAttainment({ fyToDateNet: 10000, runRateNetPerDay: 100, daysRemaining: 50, target: 20000 });
    expect(result.pct).toBeCloseTo(0.75, 10); // 15000/20000
  });

  it("onTrack is true when the projection meets or exceeds the target", () => {
    expect(fyAttainment({ fyToDateNet: 10000, runRateNetPerDay: 100, daysRemaining: 100, target: 20000 }).onTrack).toBe(true); // projected 20000, exactly meets
    expect(fyAttainment({ fyToDateNet: 10000, runRateNetPerDay: 100, daysRemaining: 99, target: 20000 }).onTrack).toBe(false); // projected 19900
  });

  it("handles a negative run-rate (declining net benefit) — projected can fall below fyToDateNet", () => {
    const result = fyAttainment({ fyToDateNet: 10000, runRateNetPerDay: -50, daysRemaining: 40, target: 5000 });
    expect(result.projected).toBe(8000); // 10000 - 50*40
    expect(result.onTrack).toBe(true); // still >= 5000 target
  });

  it("target of 0 does not throw or produce Infinity/NaN in pct (defensive fallback)", () => {
    const result = fyAttainment({ fyToDateNet: 100, runRateNetPerDay: 0, daysRemaining: 10, target: 0 });
    expect(result.pct).toBe(0);
    expect(Number.isFinite(result.pct)).toBe(true);
  });
});
