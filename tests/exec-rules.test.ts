// ---------------------------------------------------------------------------
// tests/exec-rules.test.ts
// ---------------------------------------------------------------------------
// src/pages/exec-rules.ts — fyToDateWindow's fiscal-year-to-date window and
// labels (incl. a fiscal year starting in April with a data-through date in
// February, which exercises the fiscal-year-rollover branch), buildBriefing's
// wording with and without a target, and topMovers/bottomLossMakers ordering.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { fyToDateWindow, buildBriefing, topMovers, bottomLossMakers, deriveScopeOptions, resolveStoredScope, aggregateByProposition, orderHubAlerts, comparePeriods, trendLabel, ESTATE_SCOPE } from "../src/pages/exec-rules";

const DAY = 86400000;
const iso = (y: number, m: number, d: number) => Date.UTC(y, m, d);

describe("fyToDateWindow", () => {
  it("fiscal year start rolls back into the PRIOR calendar year when dateMax falls before the fiscal start month", () => {
    // Data-through date: 15 Feb 2026. Fiscal year starts in April, so the
    // fiscal year containing 15 Feb 2026 is 1 Apr 2025 -> 31 Mar 2026 — the
    // rollover case where the FY start year is the PRIOR calendar year.
    const dateMax = iso(2026, 1, 15); // month is 0-based: 1 = February
    const w = fyToDateWindow(dateMax, 4);
    expect(w.lo).toBe(iso(2025, 3, 1)); // 1 Apr 2025 — prior calendar year
    expect(w.hi).toBe(dateMax);
    expect(w.fyLabel).toBe("FY 2025/26");
  });

  it("fiscal year start stays in the same calendar year when dateMax falls on or after the fiscal start month", () => {
    const w = fyToDateWindow(iso(2026, 6, 10), 4); // 10 Jul 2026
    expect(w.lo).toBe(iso(2026, 3, 1)); // 1 Apr 2026 — same calendar year
    expect(w.fyLabel).toBe("FY 2026/27");
  });

  it("computes the inclusive day count from the fiscal year start through dateMax", () => {
    // 1 Apr 2026 -> 14 Jul 2026 inclusive: 30 (Apr) + 31 (May) + 30 (Jun) + 14 (Jul) = 105
    const w = fyToDateWindow(iso(2026, 6, 14), 4);
    expect(w.days).toBe(105);
  });

  it("builds the exact display label", () => {
    const w = fyToDateWindow(iso(2026, 6, 14), 4);
    expect(w.label).toBe("FY 2026/27 · 1 Apr 2026 to 14 Jul 2026 (105 days)");
  });

  it("a single-day window (dateMax IS the fiscal year start) reads '1 day', not '1 days'", () => {
    const w = fyToDateWindow(iso(2026, 3, 1), 4); // 1 Apr 2026, FY start = April
    expect(w.days).toBe(1);
    expect(w.label).toMatch(/\(1 day\)$/);
  });

  it("a January fiscal-year start uses a single-year label ('FY 2026'), not a year range", () => {
    const w = fyToDateWindow(iso(2026, 7, 5), 1); // 5 Aug 2026, FY start = January
    expect(w.lo).toBe(iso(2026, 0, 1));
    expect(w.fyLabel).toBe("FY 2026");
    expect(w.label).toMatch(/^FY 2026 ·/);
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

  it('headline says "with no comparable figure" when prior FYTD is exactly zero', () => {
    const b = buildBriefing({ fyToDateNet: 50000, fyToDatePriorNet: 0 });
    expect(b.headline).toBe("Fiscal-year-to-date net benefit is £50.0k, with no comparable figure last fiscal year.");
  });

  it("headline states the prior figure (not a percentage) when the current net is negative", () => {
    const b = buildBriefing({ fyToDateNet: -236.18, fyToDatePriorNet: -10500 });
    expect(b.headline).toBe("Fiscal-year-to-date net benefit is -£236.18, improved from -£10.5k at the same point last fiscal year.");
  });

  it("headline says 'worsened' when the current figure is lower than a negative prior figure", () => {
    const b = buildBriefing({ fyToDateNet: -20000, fyToDatePriorNet: -5000 });
    expect(b.headline).toMatch(/worsened from -£5\.0k at the same point last fiscal year/);
  });

  it("headline states the prior figure when the prior FYTD was negative but the current one is positive", () => {
    const b = buildBriefing({ fyToDateNet: 50000, fyToDatePriorNet: -10000 });
    expect(b.headline).toBe("Fiscal-year-to-date net benefit is £50.0k, improved from -£10.0k at the same point last fiscal year.");
  });

  it("headline states the prior figure when the current FYTD is negative but the prior one was positive", () => {
    const b = buildBriefing({ fyToDateNet: -5000, fyToDatePriorNet: 20000 });
    expect(b.headline).toBe("Fiscal-year-to-date net benefit is -£5.0k, worsened from £20.0k at the same point last fiscal year.");
  });

  it("headline never shows a percentage change unless both the current and prior figures are strictly positive", () => {
    const b = buildBriefing({ fyToDateNet: -236.18, fyToDatePriorNet: -10500 });
    expect(b.headline).not.toMatch(/%/);
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

describe("deriveScopeOptions", () => {
  const allSpokes = ["Insurance, Pensions & Investments", "Risk", "Commercial", "Consumer Lending"];

  it("admin (no spokeIds): sees Estate plus every hub, defaulting to Estate", () => {
    const { options, defaultScope } = deriveScopeOptions([], allSpokes);
    expect(options.map((o) => o.value)).toEqual([ESTATE_SCOPE, ...allSpokes]);
    expect(defaultScope).toBe(ESTATE_SCOPE);
  });

  it("hub lead with one spoke: sees only that hub, no Estate option, defaults to it", () => {
    const { options, defaultScope } = deriveScopeOptions(["Risk"], allSpokes);
    expect(options.map((o) => o.value)).toEqual(["Risk"]);
    expect(defaultScope).toBe("Risk");
  });

  it("business user with two hubs: sees only those two hubs, no Estate option, defaults to the first", () => {
    const { options, defaultScope } = deriveScopeOptions(["Commercial", "Risk"], allSpokes);
    expect(options.map((o) => o.value)).toEqual(["Commercial", "Risk"]);
    expect(defaultScope).toBe("Commercial");
  });

  it("CoE-wide user (empty spokeIds, e.g. hub_member) is treated the same as admin", () => {
    const { options, defaultScope } = deriveScopeOptions([], allSpokes);
    expect(options.some((o) => o.value === ESTATE_SCOPE)).toBe(true);
    expect(defaultScope).toBe(ESTATE_SCOPE);
  });
});

describe("resolveStoredScope", () => {
  const options = [{ value: "Estate", label: "Estate" }, { value: "Risk", label: "Risk" }];

  it("keeps a stored value that is still a valid option", () => {
    expect(resolveStoredScope("Risk", options, "Estate")).toBe("Risk");
  });

  it("falls back to the default when the stored value is null", () => {
    expect(resolveStoredScope(null, options, "Estate")).toBe("Estate");
  });

  it("falls back to the default when the stored value is no longer a valid option (e.g. a spoke the user no longer belongs to)", () => {
    expect(resolveStoredScope("Commercial", options, "Estate")).toBe("Estate");
  });
});

describe("aggregateByProposition", () => {
  const rows = [
    { proposition: "Claims", completed: 100, exceptions: 10, attempts: 110, benefit: 1000, runtimeCost: 400 },
    { proposition: "Claims", completed: 50, exceptions: 5, attempts: 55, benefit: 500, runtimeCost: 100 },
    { proposition: "Renewals", completed: 20, exceptions: 2, attempts: 22, benefit: 200, runtimeCost: 300 },
  ];

  it("groups by proposition, summing each field", () => {
    const agg = aggregateByProposition(rows);
    const claims = agg.find((a) => a.proposition === "Claims")!;
    expect(claims.completed).toBe(150);
    expect(claims.exceptions).toBe(15);
    expect(claims.attempts).toBe(165);
    expect(claims.cost).toBe(500);
    expect(claims.net).toBe(1000 - 400 + (500 - 100)); // 1000
  });

  it("computes cost per case as summed cost / summed completed", () => {
    const agg = aggregateByProposition(rows);
    const claims = agg.find((a) => a.proposition === "Claims")!;
    expect(claims.costPerCase).toBeCloseTo(500 / 150, 10);
  });

  it("cost per case is 0 (not NaN/Infinity) when completed is 0", () => {
    const agg = aggregateByProposition([{ proposition: "Idle", completed: 0, exceptions: 0, attempts: 0, benefit: 0, runtimeCost: 50 }]);
    expect(agg[0].costPerCase).toBe(0);
  });

  it("sorts by net benefit, descending", () => {
    const agg = aggregateByProposition(rows);
    expect(agg.map((a) => a.proposition)).toEqual(["Claims", "Renewals"]); // Claims net 1000 > Renewals net -100
  });

  it("totals reconcile: summed net across every proposition equals summed net across the source rows", () => {
    const agg = aggregateByProposition(rows);
    const aggTotal = agg.reduce((s, a) => s + a.net, 0);
    const rowsTotal = rows.reduce((s, r) => s + (r.benefit - r.runtimeCost), 0);
    expect(aggTotal).toBeCloseTo(rowsTotal, 10);
  });

  it("totals reconcile: summed completed across every proposition equals summed completed across the source rows", () => {
    const agg = aggregateByProposition(rows);
    expect(agg.reduce((s, a) => s + a.completed, 0)).toBe(rows.reduce((s, r) => s + r.completed, 0));
  });

  it("returns one row per distinct proposition, even with a single source row", () => {
    expect(aggregateByProposition([rows[2]])).toHaveLength(1);
  });

  it("empty input returns an empty array", () => {
    expect(aggregateByProposition([])).toEqual([]);
  });
});

describe("comparePeriods", () => {
  it("returns a percentage only when both current and prior are strictly positive", () => {
    expect(comparePeriods(110, 100)).toEqual({ kind: "pct", pct: 0.1 });
  });

  it('returns "none" when the prior value is exactly zero', () => {
    expect(comparePeriods(50, 0)).toEqual({ kind: "none" });
  });

  it('returns "none" when the prior value is non-finite', () => {
    expect(comparePeriods(50, NaN)).toEqual({ kind: "none" });
    expect(comparePeriods(50, Infinity)).toEqual({ kind: "none" });
  });

  it('returns "improved" when the current value is greater than a negative prior value', () => {
    expect(comparePeriods(-236.18, -10500)).toEqual({ kind: "improved", prior: -10500 });
  });

  it('returns "worsened" when the current value is less than the prior value and both are not positive', () => {
    expect(comparePeriods(-20000, -5000)).toEqual({ kind: "worsened", prior: -5000 });
  });

  it('returns "improved" when the prior value was negative and the current one is positive', () => {
    expect(comparePeriods(50000, -10000)).toEqual({ kind: "improved", prior: -10000 });
  });

  it('returns "worsened" when the current value is negative and the prior value was positive', () => {
    expect(comparePeriods(-5000, 20000)).toEqual({ kind: "worsened", prior: 20000 });
  });

  it('returns "unchanged" when current equals a non-positive prior value', () => {
    expect(comparePeriods(-500, -500)).toEqual({ kind: "unchanged", prior: -500 });
  });

  it("never returns a percentage when either side is not strictly positive", () => {
    expect(comparePeriods(0, 100).kind).not.toBe("pct");
    expect(comparePeriods(100, -1).kind).not.toBe("pct");
    expect(comparePeriods(-1, 100).kind).not.toBe("pct");
  });
});

describe("orderHubAlerts", () => {
  const alerts = [
    { id: "e1", scope: "estate", severity: "breach" },
    { id: "s1", scope: "spoke", spokeFilter: "Risk", severity: "breach" },
    { id: "e2", scope: "estate", severity: "warn" },
    { id: "p1", scope: "process", spokeFilter: "Risk", severity: "warn" },
    { id: "v1", scope: "vdi", spokeFilter: "Risk", severity: "warn" },
  ];

  it("puts every alert whose spokeFilter is the hub before every estate-scope alert", () => {
    const ordered = orderHubAlerts(alerts, "Risk");
    expect(ordered.map((a) => a.id)).toEqual(["s1", "p1", "v1", "e1", "e2"]);
  });

  it("preserves the input's relative (severity) order WITHIN each group — a stable partition", () => {
    // Input is already severity-sorted (breach before warn) within each
    // group; orderHubAlerts must not reshuffle that.
    const ordered = orderHubAlerts(alerts, "Risk");
    const own = ordered.filter((a) => a.spokeFilter === "Risk");
    expect(own.map((a) => a.id)).toEqual(["s1", "p1", "v1"]); // s1 (breach) still first
    const estate = ordered.filter((a) => a.scope === "estate");
    expect(estate.map((a) => a.id)).toEqual(["e1", "e2"]); // e1 (breach) still first
  });

  it("an alert belonging to a DIFFERENT hub is dropped from neither group it doesn't belong to (own+estate only)", () => {
    const mixed = [...alerts, { id: "s2", scope: "spoke", spokeFilter: "Commercial", severity: "breach" }];
    const ordered = orderHubAlerts(mixed, "Risk");
    expect(ordered.map((a) => a.id)).not.toContain("s2");
  });

  it("returns an empty array for an empty input", () => {
    expect(orderHubAlerts([], "Risk")).toEqual([]);
  });
});

describe("trendLabel", () => {
  it("never returns a bare arrow: the pct branch always carries a magnitude", () => {
    const label = trendLabel({ kind: "pct", pct: 0.124 });
    expect(label).toBe("▲ 12.4% vs same point last FY");
  });

  it("a negative pct uses the down arrow", () => {
    expect(trendLabel({ kind: "pct", pct: -0.082 })).toBe("▼ 8.2% vs same point last FY");
  });

  it("withBasis: false drops the trailing basis wording but keeps direction and magnitude", () => {
    expect(trendLabel({ kind: "pct", pct: 0.18 }, { withBasis: false })).toBe("▲ 18.0%");
  });

  it("the cash branches (improved/worsened/unchanged) state the prior figure, never a percentage", () => {
    expect(trendLabel({ kind: "improved", prior: -10500 })).toBe("improved from -£10.5k last FY");
    expect(trendLabel({ kind: "worsened", prior: 20000 })).toBe("worsened from £20.0k last FY");
    expect(trendLabel({ kind: "unchanged", prior: -500 })).toBe("unchanged from -£500.00 last FY");
  });

  it("withBasis: false on a cash branch still names the prior figure", () => {
    expect(trendLabel({ kind: "improved", prior: -10500 }, { withBasis: false })).toBe("improved from -£10.5k");
  });

  it('"none" reads as a plain, honest "no comparable figure" rather than a dash or a computed 0%', () => {
    expect(trendLabel({ kind: "none" })).toBe("no comparable figure last FY");
    expect(trendLabel({ kind: "none" }, { withBasis: false })).toBe("no comparable figure");
  });
});
