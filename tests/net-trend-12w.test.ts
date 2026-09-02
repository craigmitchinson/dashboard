// ---------------------------------------------------------------------------
// tests/net-trend-12w.test.ts
// ---------------------------------------------------------------------------
// SpokeAgg.netTrend12w (src/filters-context.tsx's aggregate()): 12 weekly
// (benefit - cost) buckets, oldest -> newest, over the trailing 84 days
// ending at the active window's `hi` — computed from the FULL unwindowed
// ROWS (not range-preset-clamped), per-spoke, entity-filtered.
//
//   spanStart = hi - 12*7*DAY + DAY   (84 days back from hi, inclusive)
//   idx = floor((row.ts - spanStart) / (7*DAY)), clamped to [0, 11]
//
// So a row exactly 84 days before hi has ts < spanStart -> excluded; a row
// exactly 83 days before hi lands exactly on spanStart -> bucket 0; the row
// on `hi` itself -> bucket 11 (83 days / 7 = 11.86 -> floor 11).
//
// aggregate() isn't exported, so this builds a synthetic ModelJson (via
// fixtures.ts's makeModel) with all resources/people-cost history empty —
// which pins estate cost at exactly 0 for every row (see buildRateTables:
// no resources + no peopleCostHistory => hubPoolPerDay/spokeInfraPerDay are
// both 0 every day => costForRow is always 0 regardless of worktime) — so
// each bucket's value collapses to pure benefit = completed * smvMinutes/60
// * gradeRate, letting every assertion below be an exact equality rather
// than an approximation. Rendered through the real FiltersProvider tree via
// tests/model-harness.ts's renderModel() (see its header for why/how).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { renderModel } from "./model-harness";
import { makeModel, makeReference } from "./fixtures";
import type { ModelJson } from "../src/rpaData";

const DAY = 86400000;
const DATE_MAX = "2026-06-30";
const DATE_MIN = "2026-03-23"; // 99 days before DATE_MAX -> 100-day span inclusive
const GRADE_RATE = 10; // £/hour
const SMV_MINUTES = 60; // 1 hour/item -> benefit per completed item = GRADE_RATE

function day(offsetFromMax: number): string {
  const ts = Date.parse(DATE_MAX + "T00:00:00Z") - offsetFromMax * DAY;
  return new Date(ts).toISOString().slice(0, 10);
}

const EXCLUDED_DAY = day(84); // one day too early for the trailing-84-day span
const BUCKET0_DAY = day(83); // exactly spanStart -> bucket 0
const BUCKET6_DAY = day(40); // (83-40)/7 = 6.14 -> bucket 6
const BUCKET11_DAY = day(0); // hi itself -> bucket 11

function buildSyntheticModel(): ModelJson {
  const reference = makeReference({
    gradeRates: [{ grade: "G1", gradeName: "Grade 1", effectiveFrom: "2020-01-01", hourlyCostGBP: GRADE_RATE }],
    // no resources, no peopleCostHistory -> estate cost is 0 for every row
  });
  return makeModel({
    meta: { generatedAt: "2026-01-01T00:00:00.000Z", source: "test", sourceRows: 0, dateMin: DATE_MIN, dateMax: DATE_MAX, unmappedQueues: [] },
    spokes: [
      { id: 1, name: "Alpha", short: "AL", colorLight: "#111111", colorDark: "#eeeeee" },
      { id: 2, name: "Beta", short: "BE", colorLight: "#222222", colorDark: "#dddddd" },
    ],
    propositions: [
      { name: "PropA", spoke: "Alpha" },
      { name: "PropB", spoke: "Beta" },
    ],
    processes: [
      {
        id: 1, name: "Process A", acronym: "PA", description: "", proposition: "PropA", spoke: "Alpha",
        queues: [{ queue: "QA", stage: null, order: 1 }], smvMinutes: SMV_MINUTES, grade: "G1", gradeName: "Grade 1",
        currentHourly: GRADE_RATE, icon: "form", tags: [],
      },
      {
        id: 2, name: "Process B", acronym: "PB", description: "", proposition: "PropB", spoke: "Beta",
        queues: [{ queue: "QB", stage: null, order: 1 }], smvMinutes: SMV_MINUTES, grade: "G1", gradeName: "Grade 1",
        currentHourly: GRADE_RATE, icon: "form", tags: [],
      },
    ],
    dayRows: [
      // excluded: 84 days back, large completed count -> must NOT show up anywhere
      { d: EXCLUDED_DAY, p: 1, c: 999, b: 0, s: 0, n: 0, w: 100, cw: 0, gb: 0, ec: 0 },
      // Alpha, bucket 0 (exactly spanStart)
      { d: BUCKET0_DAY, p: 1, c: 5, b: 0, s: 0, n: 0, w: 100, cw: 0, gb: 0, ec: 0 },
      // Alpha, bucket 6 (middle of the span)
      { d: BUCKET6_DAY, p: 1, c: 11, b: 0, s: 0, n: 0, w: 100, cw: 0, gb: 0, ec: 0 },
      // Alpha, bucket 11 (hi itself)
      { d: BUCKET11_DAY, p: 1, c: 7, b: 0, s: 0, n: 0, w: 100, cw: 0, gb: 0, ec: 0 },
      // Beta, bucket 11 -- separate spoke, same day
      { d: BUCKET11_DAY, p: 2, c: 3, b: 0, s: 0, n: 0, w: 100, cw: 0, gb: 0, ec: 0 },
    ],
    reference,
  });
}

describe("SpokeAgg.netTrend12w (trailing 84-day, 12-weekly-bucket trend)", () => {
  it("12 buckets oldest->newest; 84-days-back excluded; 83-days-back is bucket 0; hi is bucket 11; cost is 0 so bucket value == benefit", () => {
    const model = buildSyntheticModel();
    const m = renderModel(model); // DEFAULT_FILTERS: spoke "All"

    const alpha = m.bySpoke.find((s) => s.spoke === "Alpha");
    expect(alpha).toBeDefined();
    expect(alpha!.netTrend12w).toHaveLength(12);

    // benefit = completed * (SMV_MINUTES/60) * GRADE_RATE = completed * 10, cost is exactly 0
    expect(alpha!.netTrend12w[0]).toBe(5 * GRADE_RATE); // BUCKET0_DAY
    expect(alpha!.netTrend12w[6]).toBe(11 * GRADE_RATE); // BUCKET6_DAY
    expect(alpha!.netTrend12w[11]).toBe(7 * GRADE_RATE); // BUCKET11_DAY (hi)
    // every other bucket is untouched -- in particular the 999-completion row
    // 84 days back must NOT have leaked into any bucket.
    for (const i of [1, 2, 3, 4, 5, 7, 8, 9, 10]) expect(alpha!.netTrend12w[i]).toBe(0);
    const bucketSum = alpha!.netTrend12w.reduce((a, b) => a + b, 0);
    expect(bucketSum).toBe((5 + 11 + 7) * GRADE_RATE); // excludes the 999-completion (9990) row entirely

    const beta = m.bySpoke.find((s) => s.spoke === "Beta");
    expect(beta).toBeDefined();
    expect(beta!.netTrend12w).toHaveLength(12);
    expect(beta!.netTrend12w[11]).toBe(3 * GRADE_RATE);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(beta!.netTrend12w[i]).toBe(0);
  });

  it("rows outside the active entity filter are excluded from the trend (and from bySpoke entirely)", () => {
    const model = buildSyntheticModel();
    const filtered = renderModel(model, { spoke: "Alpha" });

    // Beta never passes matchProcess under spoke=Alpha, so it has no entry at all.
    expect(filtered.bySpoke.find((s) => s.spoke === "Beta")).toBeUndefined();

    const alpha = filtered.bySpoke.find((s) => s.spoke === "Alpha");
    expect(alpha).toBeDefined();
    // Alpha's own trend is identical to the unfiltered run -- Beta's rows
    // never contributed to Alpha's bucket sums in the first place.
    expect(alpha!.netTrend12w[0]).toBe(5 * GRADE_RATE);
    expect(alpha!.netTrend12w[6]).toBe(11 * GRADE_RATE);
    expect(alpha!.netTrend12w[11]).toBe(7 * GRADE_RATE);
  });
});
