// ---------------------------------------------------------------------------
// tests/viz-formatters.test.ts
// ---------------------------------------------------------------------------
// Pure number-formatting rules from src/components/viz.tsx. Importing viz.tsx
// under plain node works fine (probed directly): its module-level exports
// have no DOM dependency at import time -- the React-hook/DOM-touching parts
// (useViz, chart components) are simply never invoked here, only the
// formatter functions declared above them in the file. Every assertion below
// is against the ACTUAL current source behaviour (verified by reading
// viz.tsx and, for NaN/Infinity, by checking Node's own Number.prototype
// toFixed/toLocaleString semantics) -- not the informally-phrased rule in the
// task brief, which in a couple of spots (fmtDuration's "45s"/"0s" short
// forms, fmtMoney's "£1M" without a forced decimal) does not match what the
// code actually does. A test here fails the moment the real rule changes.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { fmtMoney, fmtNum, fmtDuration, fmtHours, fmtPct } from "../src/components/viz";

// ===========================================================================
// fmtMoney(n, { compact })
// ===========================================================================
describe("fmtMoney: compact mode", () => {
  it("k-magnitude: one forced decimal, thousands not grouped (£382.7k)", () => {
    expect(fmtMoney(382700, { compact: true })).toBe("£382.7k");
  });

  it("M-magnitude: one forced decimal, .0 is NOT dropped (£1.0M, not £1M)", () => {
    expect(fmtMoney(1000000, { compact: true })).toBe("£1.0M");
  });

  it("below 1k: no forced decimal, just a rounded, comma-grouped integer (£950)", () => {
    expect(fmtMoney(950, { compact: true })).toBe("£950");
  });

  it("rounds below 1k rather than truncating", () => {
    expect(fmtMoney(950.6, { compact: true })).toBe("£951");
  });

  it("negative k-magnitude keeps the sign inside, before the digits (£-382.7k, not -£382.7k)", () => {
    expect(fmtMoney(-382700, { compact: true })).toBe("£-382.7k");
  });
});

describe("fmtMoney: full (non-compact) mode", () => {
  it("|n| >= 100: thousands-grouped, no decimals (£53,320)", () => {
    expect(fmtMoney(53320)).toBe("£53,320");
  });

  it("|n| < 100: shows pence (£10.24)", () => {
    expect(fmtMoney(10.24)).toBe("£10.24");
  });

  it("exactly 100 takes the grouped-integer branch, not the pence branch", () => {
    expect(fmtMoney(100)).toBe("£100");
  });

  it("0 takes the pence branch (£0.00)", () => {
    expect(fmtMoney(0)).toBe("£0.00");
  });

  it("negative, |n| < 100: pence branch keeps the sign inside (£-10.24)", () => {
    expect(fmtMoney(-10.24)).toBe("£-10.24");
  });

  it("negative, |n| >= 100: grouped-integer branch keeps the sign inside (£-53,320)", () => {
    expect(fmtMoney(-53320)).toBe("£-53,320");
  });

  it("NaN: no guard in the source -- renders through as £NaN", () => {
    expect(fmtMoney(NaN)).toBe("£NaN");
  });

  it("+Infinity: no guard in the source -- Number.toLocaleString renders the ∞ glyph", () => {
    expect(fmtMoney(Infinity)).toBe("£∞");
  });

  it("-Infinity: sign is kept inside, before the glyph", () => {
    expect(fmtMoney(-Infinity)).toBe("£-∞");
  });
});

// ===========================================================================
// fmtNum(n, { compact }) -- same magnitude cutoffs as fmtMoney, no currency
// symbol. NOTE: unlike fmtMoney, fmtNum's FULL mode has no <100 decimal
// branch at all -- it always rounds to a plain grouped integer regardless of
// magnitude, despite the doc comment above it in viz.tsx claiming "same
// compact/full rule as fmtMoney".
// ===========================================================================
describe("fmtNum: compact mode mirrors fmtMoney's magnitude cutoffs, no currency symbol", () => {
  it("k-magnitude", () => {
    expect(fmtNum(382700, { compact: true })).toBe("382.7k");
  });
  it("M-magnitude, .0 kept", () => {
    expect(fmtNum(1000000, { compact: true })).toBe("1.0M");
  });
  it("below 1k: rounded grouped integer", () => {
    expect(fmtNum(950, { compact: true })).toBe("950");
  });
});

describe("fmtNum: full mode always rounds to a grouped integer (no pence branch, unlike fmtMoney)", () => {
  it("large number: thousands-grouped", () => {
    expect(fmtNum(53320)).toBe("53,320");
  });
  it("small fractional number: rounds away the decimal instead of showing it", () => {
    expect(fmtNum(10.24)).toBe("10");
  });
  it("0", () => {
    expect(fmtNum(0)).toBe("0");
  });
  it("negative", () => {
    expect(fmtNum(-53320)).toBe("-53,320");
  });
});

// ===========================================================================
// fmtDuration(sec)
// ===========================================================================
describe("fmtDuration: no-hours form is always `${m}m ${ss}s` (seconds zero-padded, minutes not)", () => {
  it("10m 21s", () => {
    expect(fmtDuration(10 * 60 + 21)).toBe("10m 21s");
  });
  it("0 seconds -> 0m 00s (there is no bare-seconds short form in the source)", () => {
    expect(fmtDuration(0)).toBe("0m 00s");
  });
  it("45 seconds -> 0m 45s (there is no bare-seconds short form in the source)", () => {
    expect(fmtDuration(45)).toBe("0m 45s");
  });
  it("negative input is clamped to 0 -> 0m 00s", () => {
    expect(fmtDuration(-30)).toBe("0m 00s");
  });
  it("non-integer seconds are rounded first", () => {
    expect(fmtDuration(45.6)).toBe("0m 46s");
  });
});

describe("fmtDuration: hours form is `${h}h ${mm}m` and drops seconds entirely", () => {
  it("1h 04m", () => {
    expect(fmtDuration(3600 + 4 * 60)).toBe("1h 04m");
  });
  it("seconds are dropped once there is at least one whole hour", () => {
    expect(fmtDuration(3600 + 4 * 60 + 59)).toBe("1h 04m");
  });
  it("minutes are zero-padded to two digits in the hours form", () => {
    expect(fmtDuration(2 * 3600 + 5 * 60)).toBe("2h 05m");
  });
});

describe("fmtDuration: non-finite input has no guard -- it renders through, it does not become em dash", () => {
  it("NaN", () => {
    expect(fmtDuration(NaN)).toBe("NaNm NaNs");
  });
  it("+Infinity", () => {
    expect(fmtDuration(Infinity)).toBe("Infinityh NaNm");
  });
});

// ===========================================================================
// fmtHours(n) = fmtCompact(n) + " h"
// ===========================================================================
describe("fmtHours: delegates to fmtCompact, which has its own (different from fmtMoney) magnitude rule", () => {
  it("below 1k: bare rounded integer, no decimal", () => {
    expect(fmtHours(500)).toBe("500 h");
  });
  it("k-magnitude under 10k: one decimal kept", () => {
    expect(fmtHours(1000)).toBe("1.0k h");
  });
  it("k-magnitude at/above 10k: decimal dropped", () => {
    expect(fmtHours(15000)).toBe("15k h");
  });
  it("M-magnitude under 10M: one decimal kept", () => {
    expect(fmtHours(1000000)).toBe("1.0M h");
  });
  it("M-magnitude at/above 10M: decimal dropped", () => {
    expect(fmtHours(10000000)).toBe("10M h");
  });
});

// ===========================================================================
// fmtPct(x, dp = 1)
// ===========================================================================
describe("fmtPct: (x*100).toFixed(dp) + '%', default dp = 1", () => {
  it("default dp formats a fraction as a percentage string", () => {
    expect(fmtPct(0.956)).toBe("95.6%");
  });
  it("explicit dp = 0 rounds to a whole percent", () => {
    expect(fmtPct(0.956, 0)).toBe("96%");
  });
  it("explicit dp = 2 keeps two decimals", () => {
    expect(fmtPct(0.9564, 2)).toBe("95.64%");
  });
  it("0", () => {
    expect(fmtPct(0)).toBe("0.0%");
  });
  it("negative fraction keeps the sign", () => {
    expect(fmtPct(-0.05)).toBe("-5.0%");
  });
});
