// ---------------------------------------------------------------------------
// tests/exec-rules.test.ts
// ---------------------------------------------------------------------------
// src/pages/exec-rules.ts — periodWindow's four period boundaries (incl. a
// fiscal year starting in April with a data-through date in February, which
// exercises the fiscal-year-rollover branch), buildBriefing's wording with
// and without a target, and topMovers/bottomLossMakers ordering.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { periodWindow, buildBriefing, topMovers, bottomLossMakers } from "../src/pages/exec-rules";

const DAY = 86400000;
const iso = (y: number, m: number, d: number) => Date.UTC(y, m, d);

describe("periodWindow", () => {
  // Data-through date: 15 Feb 2026. Fiscal year starts in April, so the
  // fiscal year containing 15 Feb 2026 is 1 Apr 2025 -> 31 Mar 2026 — the
  // rollover case where the FY start year is the PRIOR calendar year.
  const dateMax = iso(2026, 1, 15); // month is 0-based: 1 = February

  it('"month": from the 1st of the calendar month containing dateMax, through dateMax', () => {
    const w = periodWindow("month", dateMax, 4);
    expect(w.lo).toBe(iso(2026, 1, 1));
    expect(w.hi).toBe(dateMax);
    expect(w.label).toBe("This month");
  });

  it('"lastMonth": the full preceding calendar month, NOT clipped to dateMax', () => {
    const w = periodWindow("lastMonth", dateMax, 4);
    expect(w.lo).toBe(iso(2026, 0, 1)); // 1 Jan 2026
    expect(w.hi).toBe(iso(2026, 0, 31)); // 31 Jan 2026 — full month, not dateMax
    expect(w.label).toBe("Last month");
  });

  it('"lastMonth" across a calendar year boundary (dateMax in January)', () => {
    const w = periodWindow("lastMonth", iso(2026, 0, 10), 4);
    expect(w.lo).toBe(iso(2025, 11, 1)); // 1 Dec 2025
    expect(w.hi).toBe(iso(2025, 11, 31)); // 31 Dec 2025
  });

  it('"fytd": fiscal year start rolls back into the PRIOR calendar year when dateMax falls before the fiscal start month', () => {
    const w = periodWindow("fytd", dateMax, 4);
    expect(w.lo).toBe(iso(2025, 3, 1)); // 1 Apr 2025 — prior calendar year
    expect(w.hi).toBe(dateMax);
    expect(w.label).toBe("FY to date");
  });

  it('"fytd" when dateMax falls in the same calendar year as the fiscal start month', () => {
    const w = periodWindow("fytd", iso(2026, 6, 10), 4); // 10 Jul 2026
    expect(w.lo).toBe(iso(2026, 3, 1)); // 1 Apr 2026 — same calendar year
  });

  it('"qtd": resolves the fiscal quarter (Apr-Jun/Jul-Sep/Oct-Dec/Jan-Mar for an April FY start) containing dateMax', () => {
    // 15 Feb 2026 falls in the Jan-Mar fiscal quarter (4th fiscal quarter),
    // which starts 1 Jan 2026 — note this ROLLS FORWARD into the calendar
    // year AFTER the fiscal year's own start year (2025 -> 2026).
    const w = periodWindow("qtd", dateMax, 4);
    expect(w.lo).toBe(iso(2026, 0, 1));
    expect(w.hi).toBe(dateMax);
    expect(w.label).toBe("Quarter to date");
  });

  it('"qtd" for a date in the first fiscal quarter (Apr-Jun)', () => {
    const w = periodWindow("qtd", iso(2026, 4, 20), 4); // 20 May 2026
    expect(w.lo).toBe(iso(2026, 3, 1)); // 1 Apr 2026
  });

  it("a non-April fiscal start month (calendar year, January) makes qtd match ordinary calendar quarters", () => {
    const w = periodWindow("qtd", iso(2026, 7, 5), 1); // 5 Aug 2026, FY start = January
    expect(w.lo).toBe(iso(2026, 6, 1)); // Jul-Sep calendar quarter
  });
});

describe("topMovers / bottomLossMakers ordering", () => {
  const rows = [
    { id: "a", name: "A", net: 100 },
    { id: "b", name: "B", net: 500 },
    { id: "c", name: "C", net: -50 },
    { id: "d", name: "D", net: 300 },
    { id: "e", name: "E", net: -900 },
    { id: "f", name: "F", net: -10 },
  ];

  it("topMovers returns the top N by net, descending", () => {
    expect(topMovers(rows, 3).map((r) => r.id)).toEqual(["b", "d", "a"]);
  });

  it("topMovers defaults to 3", () => {
    expect(topMovers(rows)).toHaveLength(3);
  });

  it("bottomLossMakers returns only net < 0 rows, most negative first", () => {
    expect(bottomLossMakers(rows, 3).map((r) => r.id)).toEqual(["e", "c", "f"]);
  });

  it("bottomLossMakers excludes non-negative rows entirely, even if fewer than n remain", () => {
    const allPositive = [{ id: "x", name: "X", net: 10 }];
    expect(bottomLossMakers(allPositive)).toEqual([]);
  });
});

describe("buildBriefing", () => {
  it("headline includes the up/down % change vs prior FYTD when prior is non-zero", () => {
    const b = buildBriefing({ fyToDateNet: 110000, fyToDatePriorNet: 100000 });
    expect(b.headline).toMatch(/up 10\.0% vs the same point last fiscal year/);
    expect(b.headline).not.toMatch(/target/);
  });

  it("headline reports a decrease when net has fallen", () => {
    const b = buildBriefing({ fyToDateNet: 90000, fyToDatePriorNet: 100000 });
    expect(b.headline).toMatch(/down 10\.0% vs the same point last fiscal year/);
  });

  it("headline omits the target clause entirely when no target is configured", () => {
    const b = buildBriefing({ fyToDateNet: 50000, fyToDatePriorNet: 40000 });
    expect(b.headline).not.toMatch(/on track|behind/);
  });

  it("headline says 'on track' when a target is set and onTrack is true", () => {
    const b = buildBriefing({ fyToDateNet: 50000, fyToDatePriorNet: 40000, estateTarget: 200000, onTrack: true });
    expect(b.headline).toMatch(/on track to meet the annual target/);
  });

  it("headline says 'behind' when a target is set and onTrack is false", () => {
    const b = buildBriefing({ fyToDateNet: 50000, fyToDatePriorNet: 40000, estateTarget: 200000, onTrack: false });
    expect(b.headline).toMatch(/behind the annual target/);
  });

  it("headline omits the change clause when prior FYTD is exactly zero (would divide by zero)", () => {
    const b = buildBriefing({ fyToDateNet: 50000, fyToDatePriorNet: 0 });
    expect(b.headline).not.toMatch(/vs the same point/);
  });

  it("risk prefers the worst breach headline when one exists, even alongside an exception-rate candidate", () => {
    const b = buildBriefing({
      fyToDateNet: 1,
      fyToDatePriorNet: 1,
      worstBreachHeadline: "Estate — Completion rate 91.2%, below the 95.0% floor",
      worstExceptionProcess: { name: "Process X", rate: 0.2 },
    });
    expect(b.risk).toBe("Highest-priority risk: Estate — Completion rate 91.2%, below the 95.0% floor.");
  });

  it("risk falls back to the worst exception-rate process when there is no breach", () => {
    const b = buildBriefing({ fyToDateNet: 1, fyToDatePriorNet: 1, worstExceptionProcess: { name: "Process X", rate: 0.123 } });
    expect(b.risk).toBe("Highest-priority risk: Process X is running an exception rate of 12.3%, above target.");
  });

  it('risk is "No thresholds breached." when neither a breach nor an exception candidate exists', () => {
    const b = buildBriefing({ fyToDateNet: 1, fyToDatePriorNet: 1 });
    expect(b.risk).toBe("No thresholds breached.");
  });

  it("action names the top review candidate and its reason when one exists", () => {
    const b = buildBriefing({ fyToDateNet: 1, fyToDatePriorNet: 1, topReviewCandidate: { name: "Process Y", reason: "Low volume: only 5 completions this period." } });
    expect(b.action).toBe("Recommended action: review Process Y — Low volume: only 5 completions this period.");
  });

  it('action is "No processes running at a loss." when there is no review candidate', () => {
    const b = buildBriefing({ fyToDateNet: 1, fyToDatePriorNet: 1 });
    expect(b.action).toBe("No processes running at a loss.");
  });
});
