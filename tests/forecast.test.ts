// ---------------------------------------------------------------------------
// tests/forecast.test.ts
// ---------------------------------------------------------------------------
// src/components/forecast.ts's seasonalNaiveForecast — a pure function, no
// React/DOM involved.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { seasonalNaiveForecast } from "../src/components/forecast";
import type { ForecastPoint } from "../src/components/forecast";

const DAY_MS = 86400000;

function addDaysISO(dateISO: string, days: number): string {
  const ts = Date.parse(dateISO + "T00:00:00Z") + days * DAY_MS;
  return new Date(ts).toISOString().slice(0, 10);
}

// Builds a contiguous, no-gaps series starting at `startISO`, length `n`,
// value = valueFor(dayIndex).
function series(startISO: string, n: number, valueFor: (i: number) => number): ForecastPoint[] {
  return Array.from({ length: n }, (_, i) => ({ dateISO: addDaysISO(startISO, i), value: valueFor(i) }));
}

describe("seasonalNaiveForecast", () => {
  it("with >= 4 full weeks of history, forecasts each future day as the mean of the same weekday over the last 4 weeks", () => {
    // 28 days, weekday i (0-indexed) always has value 10*(i%7) — so every
    // 7th day repeats, all 4 weeks identical.
    const pts = series("2026-01-01", 28, (i) => 10 * (i % 7));
    const { point, lo, hi } = seasonalNaiveForecast(pts, 7);
    for (let k = 0; k < 7; k++) {
      expect(point[k]).toBeCloseTo(10 * (k % 7), 6);
    }
    // Identical same-weekday values every week -> zero variance -> band
    // floors at 5% of the mean (or exactly 0 when the mean itself is 0).
    for (let k = 0; k < 7; k++) {
      const band = Math.max(0, point[k] * 0.05);
      expect(hi[k] - point[k]).toBeCloseTo(band, 6);
      expect(point[k] - lo[k]).toBeCloseTo(band, 6);
    }
  });

  it("looks back by REAL calendar dates, not by array index, so a gap earlier in the series does not shift which weekday is matched", () => {
    // 5 weeks of data (35 days), weekday i (0-indexed from day 0) always has
    // value 10*(i%7) — but DROP one entry from the middle (day 10, a
    // Saturday-equivalent slot) to simulate a zero-activity day producing no
    // row at all. If the implementation walked array INDEX offsets instead
    // of real dates, every same-weekday lookup for days after the gap would
    // be off by one entry (i.e. off by one weekday) from that point on.
    const full = series("2026-01-01", 35, (i) => 10 * (i % 7));
    const withGap = full.filter((p) => p.dateISO !== addDaysISO("2026-01-01", 10));
    expect(withGap).toHaveLength(34);

    const { point } = seasonalNaiveForecast(withGap, 7);
    // Forecast day k (0-indexed) is calendar day 35+k from 2026-01-01, i.e.
    // weekday (35+k) % 7 — identical to the pre-gap pattern, since the gap
    // only removed one HISTORICAL observation, not a real calendar shift.
    for (let k = 0; k < 7; k++) {
      expect(point[k]).toBeCloseTo(10 * ((35 + k) % 7), 6);
    }
  });

  it("falls back to the mean of the last 7 AVAILABLE days when fewer than 2 same-weekday observations exist", () => {
    // Only 10 days of history — not enough for 2 same-weekday observations
    // for any future day (at most 1 same-weekday day exists that far back).
    const pts = series("2026-01-01", 10, (i) => i + 1); // values 1..10
    const { point } = seasonalNaiveForecast(pts, 3);
    const last7Mean = (4 + 5 + 6 + 7 + 8 + 9 + 10) / 7;
    expect(point[0]).toBeCloseTo(last7Mean, 6);
    expect(point[1]).toBeCloseTo(last7Mean, 6);
    expect(point[2]).toBeCloseTo(last7Mean, 6);
  });

  it("the last-7-available fallback counts by ENTRY, not by calendar span, when the series has gaps", () => {
    // 10 calendar days but day 5 is missing -> 9 available entries; "last 7
    // available" should be the last 7 ENTRIES (days 4,6,7,8,9,10 plus... — in
    // practice just verify it's the mean of the 7 most recent VALUES present,
    // not thrown off by the gap).
    const full = series("2026-01-01", 10, (i) => i + 1); // values 1..10
    const withGap = full.filter((p) => p.dateISO !== addDaysISO("2026-01-01", 4)); // drop value 5
    const { point } = seasonalNaiveForecast(withGap, 1);
    const remainingValues = withGap.map((p) => p.value); // 1,2,3,4,6,7,8,9,10
    const last7 = remainingValues.slice(-7);
    expect(point[0]).toBeCloseTo(last7.reduce((a, b) => a + b, 0) / last7.length, 6);
  });

  it("band reflects the standard deviation of the same-weekday sample, floored at 5% of the mean", () => {
    // 4 weeks, one weekday varies: 10, 20, 30, 40 -> mean 25, population
    // stddev = sqrt(((15^2+5^2+5^2+15^2))/4) = sqrt(125) ≈ 11.18, which
    // exceeds 5% of the mean (1.25), so the band should equal the stddev.
    const base = series("2026-01-01", 28, () => 0).map((p, i) => ({ ...p, value: i === 0 ? 10 : i === 7 ? 20 : i === 14 ? 30 : i === 21 ? 40 : 0 }));
    const { point, lo, hi } = seasonalNaiveForecast(base, 1);
    expect(point[0]).toBeCloseTo(25, 6);
    const expectedSd = Math.sqrt(((10 - 25) ** 2 + (20 - 25) ** 2 + (30 - 25) ** 2 + (40 - 25) ** 2) / 4);
    expect(hi[0] - point[0]).toBeCloseTo(expectedSd, 6);
    expect(point[0] - lo[0]).toBeCloseTo(expectedSd, 6);
  });

  it("the band floors at 5% of the mean for a low-variance same-weekday sample", () => {
    // Same weekday values barely vary (100, 101, 99, 100) -> stddev is tiny,
    // well under 5% of the ~100 mean (5.0), so the floor should win.
    const base = series("2026-01-01", 28, () => 0).map((p, i) => ({ ...p, value: i === 0 ? 100 : i === 7 ? 101 : i === 14 ? 99 : i === 21 ? 100 : 0 }));
    const { point, hi } = seasonalNaiveForecast(base, 1);
    const meanVal = (100 + 101 + 99 + 100) / 4;
    expect(point[0]).toBeCloseTo(meanVal, 6);
    expect(hi[0] - point[0]).toBeCloseTo(meanVal * 0.05, 6);
  });

  it("lo is floored at 0 even when mean - band would go negative", () => {
    const base = series("2026-01-01", 28, () => 0).map((p, i) => ({ ...p, value: i === 0 ? 1 : 0 }));
    const { lo } = seasonalNaiveForecast(base, 1);
    expect(lo[0]).toBeGreaterThanOrEqual(0);
  });

  it("returns arrays of the requested length, and empty input yields all zeros", () => {
    const { point, lo, hi } = seasonalNaiveForecast([], 5);
    expect(point).toHaveLength(5);
    expect(lo).toHaveLength(5);
    expect(hi).toHaveLength(5);
    expect(point.every((v) => v === 0)).toBe(true);
  });
});
