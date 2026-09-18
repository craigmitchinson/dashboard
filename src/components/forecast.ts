// ---------------------------------------------------------------------------
// components/forecast.ts
// ---------------------------------------------------------------------------
// Pure (no React, no DOM) seasonal-naive forecasting for a daily time series.
// Replaces the old fixed-±12%-band linear regression previously baked
// directly into LineChart (components/viz.tsx) — that projection ignored the
// weekly seasonality plainly visible in the daily series (e.g. weekday vs
// weekend volume) and used an arbitrary fixed band width regardless of how
// noisy the underlying data actually was.
//
// Model: for each future calendar day D beyond the series' last date, the
// point forecast is the mean of whichever of D−7/D−14/D−21/D−28 actually
// exist in history (real DATE arithmetic, not an index offset — see below),
// falling back to the mean of the last 7 AVAILABLE days when fewer than 2 of
// those 4 same-weekday observations exist. The band is ± one standard
// deviation of whichever sample the point forecast was computed from,
// floored at 5% of the mean so a near-zero-variance sample (e.g. a brand new,
// perfectly flat series) still shows a visible, honest band rather than
// collapsing to a hairline.
//
// Why date arithmetic, not index offsets: the input is a REPORT day series
// (e.g. src/filters-context.tsx's Model.daily), which only contains an entry
// for a calendar date that actually had rows — a date with zero activity
// produces no entry at all, not a zero-value one. Indexing "7 back" through
// such a series walks 7 ENTRIES, not 7 DAYS, so a single gap anywhere in
// history permanently shifts every weekday lookup after it onto the wrong
// weekday. Keying lookups by the actual ISO date instead keeps "same
// weekday" correct regardless of how many gaps came before it.
// ---------------------------------------------------------------------------

export interface ForecastPoint {
  dateISO: string; // "YYYY-MM-DD"
  value: number;
}

export interface SeasonalForecast {
  point: number[];
  lo: number[];
  hi: number[];
}

const DAY_MS = 86400000;

function addDaysISO(dateISO: string, days: number): string {
  const ts = Date.parse(dateISO + "T00:00:00Z") + days * DAY_MS;
  return new Date(ts).toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[], m: number): number {
  if (xs.length <= 1) return 0;
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * Forecasts `periods` calendar days beyond the last date in `points` (a
 * daily series, oldest first, POSSIBLY with gaps — a missing calendar date
 * simply has no entry). Returns parallel arrays of length `periods`: `point`
 * (the forecast), `lo`/`hi` (the ± band, floored at 0 — these are
 * non-negative quantities like cost/case or cumulative benefit, so a lower
 * bound below zero is never meaningful here).
 */
export function seasonalNaiveForecast(points: ForecastPoint[], periods: number): SeasonalForecast {
  const point: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];

  if (points.length === 0) {
    for (let k = 0; k < periods; k++) {
      point.push(0);
      lo.push(0);
      hi.push(0);
    }
    return { point, lo, hi };
  }

  const byDate = new Map(points.map((p) => [p.dateISO, p.value]));
  const lastDate = points[points.length - 1].dateISO;
  const last7Available = points.slice(Math.max(0, points.length - 7)).map((p) => p.value);

  for (let k = 0; k < periods; k++) {
    const targetDate = addDaysISO(lastDate, k + 1);

    // Same weekday, last 4 weeks — real calendar dates (D-7, D-14, D-21,
    // D-28), each included only if that exact date exists in `points`.
    const sameWeekday: number[] = [];
    for (let w = 1; w <= 4; w++) {
      const v = byDate.get(addDaysISO(targetDate, -7 * w));
      if (v !== undefined) sameWeekday.push(v);
    }

    // Fewer than 2 same-weekday observations -> fall back to the mean of the
    // last 7 AVAILABLE days (not necessarily the last 7 calendar days, if
    // the series has gaps) instead.
    const sample = sameWeekday.length >= 2 ? sameWeekday : last7Available;

    if (sample.length === 0) {
      point.push(0);
      lo.push(0);
      hi.push(0);
      continue;
    }

    const m = mean(sample);
    const sd = stdDev(sample, m);
    const band = Math.max(sd, Math.abs(m) * 0.05);

    point.push(m);
    lo.push(Math.max(0, m - band));
    hi.push(m + band);
  }

  return { point, lo, hi };
}
