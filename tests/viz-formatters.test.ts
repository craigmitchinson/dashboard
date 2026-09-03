// ---------------------------------------------------------------------------
// tests/viz-formatters.test.ts
// ---------------------------------------------------------------------------
// Pure number-formatting rules from src/components/viz.tsx. Importing viz.tsx
// under plain node works fine (probed directly): its module-level exports
// have no DOM dependency at import time -- the React-hook/DOM-touching parts
// (useViz, chart components) are simply never invoked here, only the
// formatter functions declared above them in the file.
//
// Corrected rules pinned here (this hardening pass changed the source):
//   - one shared non-finite guard: NaN/+Infinity/-Infinity all render as "—"
//     across every formatter in this file.
//   - every money formatter keeps a negative sign BEFORE the £ symbol
//     (-£382.7k, -£53,320, -£10.24), never £-...
//   - fmtNum's full (non-compact) mode now mirrors fmtMoney's rule exactly,
//     minus the £ symbol: thousands-grouped, no decimals, EXCEPT |n| < 100
//     shows two decimals -- it no longer always collapses to a bare integer.
//   - fmtDuration gained a <60s bare-seconds short form (45s, 0s at zero).
// ===========================================================================
import { describe, it, expect } from "vitest";
import { fmtInt, fmtCompact, fmtPct, fmtGBP, fmtGBPc, fmtMoney2, fmtMoney, fmtNum, fmtHours, fmtDuration } from "../src/components/viz";

// ===========================================================================
// Shared non-finite guard -- every formatter in this file returns "—" for
// NaN/+Infinity/-Infinity, never a leaked "£NaN"/"£∞"/garbled string.
// ===========================================================================
describe("shared non-finite guard: every formatter returns — for NaN/±Infinity", () => {
  const formatters: [string, (n: number) => string][] = [
    ["fmtInt", fmtInt],
    ["fmtCompact", fmtCompact],
    ["fmtPct", (n) => fmtPct(n)],
    ["fmtGBP", fmtGBP],
    ["fmtGBPc", fmtGBPc],
    ["fmtMoney2", fmtMoney2],
    ["fmtMoney", (n) => fmtMoney(n)],
    ["fmtMoney (compact)", (n) => fmtMoney(n, { compact: true })],
    ["fmtNum", (n) => fmtNum(n)],
    ["fmtNum (compact)", (n) => fmtNum(n, { compact: true })],
    ["fmtHours", fmtHours],
    ["fmtDuration", fmtDuration],
  ];
  for (const [name, fn] of formatters) {
    it(`${name}(NaN) -> "—"`, () => expect(fn(NaN)).toBe("—"));
    it(`${name}(Infinity) -> "—"`, () => expect(fn(Infinity)).toBe("—"));
    it(`${name}(-Infinity) -> "—"`, () => expect(fn(-Infinity)).toBe("—"));
  }
});

// ===========================================================================
// fmtGBP(n) -- "£" + rounded, thousands-grouped integer; negative sign
// BEFORE the £.
// ===========================================================================
describe("fmtGBP: rounded, thousands-grouped, sign before the £", () => {
  it("positive", () => expect(fmtGBP(53320)).toBe("£53,320"));
  it("rounds", () => expect(fmtGBP(53320.6)).toBe("£53,321"));
  it("negative keeps the sign before the £, not after", () => expect(fmtGBP(-53320)).toBe("-£53,320"));
  it("zero", () => expect(fmtGBP(0)).toBe("£0"));
});

// ===========================================================================
// fmtGBPc(n) -- compact: M keeps 2dp, k keeps 1dp, below 1k keeps 2dp; sign
// before the £.
// ===========================================================================
describe("fmtGBPc: compact money, sign before the £", () => {
  it("M-magnitude keeps 2 decimals", () => expect(fmtGBPc(1234567)).toBe("£1.23M"));
  it("k-magnitude keeps 1 decimal", () => expect(fmtGBPc(382700)).toBe("£382.7k"));
  it("below 1k keeps 2 decimals (pence)", () => expect(fmtGBPc(950.4)).toBe("£950.40"));
  it("negative M-magnitude", () => expect(fmtGBPc(-1234567)).toBe("-£1.23M"));
  it("negative k-magnitude", () => expect(fmtGBPc(-382700)).toBe("-£382.7k"));
  it("negative below 1k", () => expect(fmtGBPc(-10.24)).toBe("-£10.24"));
});

// ===========================================================================
// fmtMoney2(n) -- "£" + thousands-grouped with exactly 2 decimals always;
// sign before the £.
// ===========================================================================
describe("fmtMoney2: always 2 decimals, thousands-grouped, sign before the £", () => {
  it("large value", () => expect(fmtMoney2(53320)).toBe("£53,320.00"));
  it("small value", () => expect(fmtMoney2(10.2)).toBe("£10.20"));
  it("negative", () => expect(fmtMoney2(-10.24)).toBe("-£10.24"));
  it("zero", () => expect(fmtMoney2(0)).toBe("£0.00"));
});

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

  it("negative k-magnitude keeps the sign before the £ (-£382.7k, not £-382.7k)", () => {
    expect(fmtMoney(-382700, { compact: true })).toBe("-£382.7k");
  });

  it("negative M-magnitude keeps the sign before the £", () => {
    expect(fmtMoney(-1000000, { compact: true })).toBe("-£1.0M");
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

  it("negative, |n| < 100: pence branch keeps the sign before the £ (-£10.24)", () => {
    expect(fmtMoney(-10.24)).toBe("-£10.24");
  });

  it("negative, |n| >= 100: grouped-integer branch keeps the sign before the £ (-£53,320)", () => {
    expect(fmtMoney(-53320)).toBe("-£53,320");
  });
});

// ===========================================================================
// fmtNum(n, { compact }) -- same magnitude cutoffs as fmtMoney, no currency
// symbol. Full mode now mirrors fmtMoney's rule exactly (decimals only for
// |n| < 100) -- this pass fixed the doc/behaviour mismatch that used to leave
// fmtNum always rounding to a bare integer in full mode.
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
  it("negative k-magnitude keeps the sign before the digits", () => {
    expect(fmtNum(-382700, { compact: true })).toBe("-382.7k");
  });
});

describe("fmtNum: full mode mirrors fmtMoney minus the symbol -- decimals only for |n| < 100", () => {
  it("|n| >= 100: thousands-grouped, no decimals", () => {
    expect(fmtNum(53320)).toBe("53,320");
  });
  it("|n| < 100: shows two decimals, matching fmtMoney's pence branch", () => {
    expect(fmtNum(10.24)).toBe("10.24");
  });
  it("exactly 100 takes the grouped-integer branch", () => {
    expect(fmtNum(100)).toBe("100");
  });
  it("0 takes the decimal branch", () => {
    expect(fmtNum(0)).toBe("0.00");
  });
  it("negative, |n| < 100 keeps the sign before the digits", () => {
    expect(fmtNum(-10.24)).toBe("-10.24");
  });
  it("negative, |n| >= 100", () => {
    expect(fmtNum(-53320)).toBe("-53,320");
  });
});

// ===========================================================================
// fmtDuration(sec)
// ===========================================================================
describe("fmtDuration: <60s is a bare-seconds short form", () => {
  it("45 seconds -> 45s", () => {
    expect(fmtDuration(45)).toBe("45s");
  });
  it("0 seconds -> 0s", () => {
    expect(fmtDuration(0)).toBe("0s");
  });
  it("59 seconds -> 59s (just under the 1-minute boundary)", () => {
    expect(fmtDuration(59)).toBe("59s");
  });
  it("negative input is clamped to 0 -> 0s", () => {
    expect(fmtDuration(-30)).toBe("0s");
  });
  it("non-integer seconds are rounded first", () => {
    expect(fmtDuration(45.6)).toBe("46s");
  });
});

describe("fmtDuration: no-hours form (>=60s, <1h) is `${m}m ${ss}s` (seconds zero-padded, minutes not)", () => {
  it("10m 21s", () => {
    expect(fmtDuration(10 * 60 + 21)).toBe("10m 21s");
  });
  it("exactly 60 seconds -> 1m 00s (the 1-minute boundary itself leaves the bare-seconds form)", () => {
    expect(fmtDuration(60)).toBe("1m 00s");
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

// ===========================================================================
// fmtInt(n) / fmtCompact(n) -- no currency symbol, so the sign was already
// "before" the digits pre-hardening; only the non-finite guard is new here
// (covered above).
// ===========================================================================
describe("fmtInt: rounded, thousands-grouped, no symbol", () => {
  it("positive", () => expect(fmtInt(53320.4)).toBe("53,320"));
  it("negative", () => expect(fmtInt(-53320)).toBe("-53,320"));
});

describe("fmtCompact: magnitude-scaled, no symbol", () => {
  it("k-magnitude under 10k keeps one decimal", () => expect(fmtCompact(1500)).toBe("1.5k"));
  it("k-magnitude at/above 10k drops the decimal", () => expect(fmtCompact(15000)).toBe("15k"));
  it("M-magnitude under 10M keeps one decimal", () => expect(fmtCompact(1500000)).toBe("1.5M"));
  it("negative keeps the sign before the digits", () => expect(fmtCompact(-1500)).toBe("-1.5k"));
});
