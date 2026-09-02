// ---------------------------------------------------------------------------
// tests/fiscal-year-bounds.test.ts
// ---------------------------------------------------------------------------
// fiscalYearBounds(dateTs, startMonth) — src/filters-context.tsx — returns
// the [start, end) UTC-ms bounds of the fiscal year containing dateTs.
// Default startMonth is FISCAL_YEAR_START_MONTH_DEFAULT (April, UK FY).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { fiscalYearBounds, FISCAL_YEAR_START_MONTH_DEFAULT } from "../src/filters-context";
import { makeReference } from "./fixtures";

const ts = (y: number, m1: number, d: number) => Date.UTC(y, m1 - 1, d); // m1 = 1-based month

describe("fiscalYearBounds (default start month = April)", () => {
  it("a date in March 2026 falls in FY 2025-04-01..2026-03-31 (end exclusive at 2026-04-01)", () => {
    const { start, end } = fiscalYearBounds(ts(2026, 3, 15));
    expect(start).toBe(ts(2025, 4, 1));
    expect(end).toBe(ts(2026, 4, 1));
  });

  it("a date in April 2026 falls in FY 2026-04-01..2027-03-31", () => {
    const { start, end } = fiscalYearBounds(ts(2026, 4, 15));
    expect(start).toBe(ts(2026, 4, 1));
    expect(end).toBe(ts(2027, 4, 1));
  });

  it("1 April itself starts the new fiscal year (boundary belongs to the year beginning that day)", () => {
    const boundary = ts(2026, 4, 1);
    const { start, end } = fiscalYearBounds(boundary);
    expect(start).toBe(boundary);
    expect(end).toBe(ts(2027, 4, 1));
  });

  it("31 March 23:59:59.999Z (one ms before the boundary) is still the OLD fiscal year", () => {
    const oneMsBefore = ts(2026, 4, 1) - 1;
    const { start, end } = fiscalYearBounds(oneMsBefore);
    expect(start).toBe(ts(2025, 4, 1));
    expect(end).toBe(ts(2026, 4, 1));
  });
});

describe("fiscalYearBounds (non-April start month behaves as a calendar year)", () => {
  it("startMonth=1 (January): any date in the year maps to Jan 1 .. Jan 1 next year", () => {
    const { start, end } = fiscalYearBounds(ts(2026, 6, 15), 1);
    expect(start).toBe(ts(2026, 1, 1));
    expect(end).toBe(ts(2027, 1, 1));
  });

  it("startMonth=1: 31 December is still the same calendar year", () => {
    const { start, end } = fiscalYearBounds(ts(2026, 12, 31), 1);
    expect(start).toBe(ts(2026, 1, 1));
    expect(end).toBe(ts(2027, 1, 1));
  });
});

describe("fiscalYearBounds: prior-FY-equivalent span (filters-context.tsx's fyToDatePriorNet pattern)", () => {
  it("a window ending N days into the current FY maps to the same N-day offset into the prior FY", () => {
    const DAY = 86400000;
    const hi = ts(2026, 4, 10); // 9 days into the FY beginning 2026-04-01
    const { start: fyStart } = fiscalYearBounds(hi);
    expect(fyStart).toBe(ts(2026, 4, 1));

    const priorStart = fiscalYearBounds(fyStart - DAY).start;
    const priorHi = priorStart + (hi - fyStart);

    expect(priorStart).toBe(ts(2025, 4, 1));
    expect(priorHi).toBe(ts(2025, 4, 10));
    expect(priorHi - priorStart).toBe(hi - fyStart); // exact same day-offset span
  });

  it("holds across a leap-year FY boundary (2027-04-01 window vs 2026-04-01 prior FY)", () => {
    const DAY = 86400000;
    const hi = ts(2027, 5, 1); // 30 days into the FY beginning 2027-04-01
    const { start: fyStart } = fiscalYearBounds(hi);
    const priorStart = fiscalYearBounds(fyStart - DAY).start;
    const priorHi = priorStart + (hi - fyStart);

    expect(fyStart).toBe(ts(2027, 4, 1));
    expect(priorStart).toBe(ts(2026, 4, 1));
    expect(priorHi).toBe(ts(2026, 5, 1));
    expect(priorHi - priorStart).toBe(hi - fyStart);
  });
});

describe("reference.targets.fiscalYearStartMonth flows through fiscalYearBounds (Finance settings)", () => {
  it("a reference with no fiscalYearStartMonth set falls back to FISCAL_YEAR_START_MONTH_DEFAULT (April) and behaves exactly like calling fiscalYearBounds with no startMonth arg", () => {
    const reference = makeReference(); // targets.fiscalYearStartMonth left unset
    const month = reference.targets.fiscalYearStartMonth ?? FISCAL_YEAR_START_MONTH_DEFAULT;
    expect(month).toBe(4);
    const withReference = fiscalYearBounds(ts(2026, 3, 15), month);
    const withDefaultArg = fiscalYearBounds(ts(2026, 3, 15));
    expect(withReference).toEqual(withDefaultArg);
    expect(withReference).toEqual({ start: ts(2025, 4, 1), end: ts(2026, 4, 1) });
  });

  it("a reference with fiscalYearStartMonth: 1 behaves as a calendar year", () => {
    const reference = makeReference({
      targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14, fiscalYearStartMonth: 1 },
    });
    const month = reference.targets.fiscalYearStartMonth ?? FISCAL_YEAR_START_MONTH_DEFAULT;
    expect(month).toBe(1);
    const { start, end } = fiscalYearBounds(ts(2026, 6, 15), month);
    expect(start).toBe(ts(2026, 1, 1));
    expect(end).toBe(ts(2027, 1, 1));
  });

  it("a reference with fiscalYearStartMonth: 7 (July) shifts the FY boundary accordingly", () => {
    const reference = makeReference({
      targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14, fiscalYearStartMonth: 7 },
    });
    const month = reference.targets.fiscalYearStartMonth ?? FISCAL_YEAR_START_MONTH_DEFAULT;
    const { start, end } = fiscalYearBounds(ts(2026, 3, 1), month); // March 2026 is still in the FY that started July 2025
    expect(start).toBe(ts(2025, 7, 1));
    expect(end).toBe(ts(2026, 7, 1));
  });
});
