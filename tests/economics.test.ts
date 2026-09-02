// ---------------------------------------------------------------------------
// tests/economics.test.ts
// ---------------------------------------------------------------------------
// Encodes the real business rules from src/reference/economics.ts +
// ARCHITECTURE.md's "Hub & spoke economics" section. Every test fails if the
// underlying rule regresses -- not a shape/smoke test.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import {
  inForce,
  gradeRateOn,
  peopleCostOn,
  vdiClassRate,
  vdiDailyCost,
  vdiAvailableOn,
  availableDaysInWindow,
  buildRateTables,
  costForRow,
  reworkCostForRow,
  type VdiCoverageInput,
} from "../src/reference/economics";
import type { DayRow, ExcRow, ProcessDim } from "../src/rpaData";
import { makeReference } from "./fixtures";

const DAY_MS = 86400000;
const ts = (iso: string) => Date.parse(iso + "T00:00:00Z");

function makeProcess(overrides: Partial<ProcessDim> = {}): ProcessDim {
  return {
    id: "1",
    name: "Process",
    acronym: "PRC",
    description: "",
    proposition: "Prop",
    spoke: "Spoke1",
    queue: "Q",
    queues: [],
    tags: [],
    Icon: (() => null) as unknown as ProcessDim["Icon"],
    smvMinutes: 10,
    grade: "G1",
    gradeName: "Grade 1",
    colleagueHourly: 20,
    ...overrides,
  };
}

const SPOKE1 = { spokeId: 1, spokeName: "Spoke1", shortName: "S1", colorLight: "#111111", colorDark: "#eeeeee" };

// ===========================================================================
// Grade rate resolution (gradeRateOn / inForce)
// ===========================================================================
describe("inForce (generic date-effective lookup)", () => {
  it("the row with the latest effectiveFrom <= date wins", () => {
    const history = [
      { effectiveFrom: "2024-01-01", v: 1 },
      { effectiveFrom: "2025-06-01", v: 2 },
      { effectiveFrom: "2025-01-01", v: 3 },
    ];
    expect(inForce(history, "2024-06-01")?.v).toBe(1);
    expect(inForce(history, "2025-03-01")?.v).toBe(3);
    expect(inForce(history, "2026-01-01")?.v).toBe(2);
  });

  it("returns undefined when the date precedes every record", () => {
    const history = [{ effectiveFrom: "2025-01-01", v: 1 }];
    expect(inForce(history, "2020-01-01")).toBeUndefined();
  });
});

describe("gradeRateOn", () => {
  it("latest effectiveFrom <= day wins (universal rows, no spoke)", () => {
    const reference = makeReference({
      gradeRates: [
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2024-01-01", hourlyCostGBP: 10 },
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2025-06-01", hourlyCostGBP: 30 },
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2025-01-01", hourlyCostGBP: 20 },
      ],
    });
    expect(gradeRateOn(reference, "G1", undefined, "2024-06-01")).toBe(10);
    expect(gradeRateOn(reference, "G1", undefined, "2025-03-01")).toBe(20);
    expect(gradeRateOn(reference, "G1", undefined, "2026-01-01")).toBe(30);
  });

  it("a spoke-scoped row beats a universal row regardless of dates", () => {
    const reference = makeReference({
      spokes: [SPOKE1],
      gradeRates: [
        // spoke-scoped row is OLDER than the universal row, but must still win
        // for Spoke1 at any date on/after 2020-01-01.
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2020-01-01", hourlyCostGBP: 10, spokeId: "1" },
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2025-01-01", hourlyCostGBP: 999 },
      ],
    });
    expect(gradeRateOn(reference, "G1", "Spoke1", "2026-01-01")).toBe(10);
    // an estate-wide / no-process caller (no spoke) only ever sees the universal row.
    expect(gradeRateOn(reference, "G1", undefined, "2026-01-01")).toBe(999);
  });

  it("a day before any record falls back to 0, never NaN", () => {
    const reference = makeReference({
      gradeRates: [{ grade: "G1", gradeName: "Grade 1", effectiveFrom: "2025-01-01", hourlyCostGBP: 10 }],
    });
    const rate = gradeRateOn(reference, "G1", undefined, "2020-01-01");
    expect(rate).toBe(0);
    expect(Number.isFinite(rate)).toBe(true);
  });
});

// ===========================================================================
// People-cost pro-rating: the "hire on 1 Sep" rule
// ===========================================================================
describe("peopleCostOn / hub pro-rating", () => {
  it("pro-rates headcount 10 -> 11 exactly on the effectiveFrom day (D-1 uses old, D uses new)", () => {
    const reference = makeReference({
      peopleCostHistory: [
        { ownerId: "HUB", headcount: 10, annualCostGBP: 365250, effectiveFrom: "2020-01-01" }, // /365.25 = 1000/day
        { ownerId: "HUB", headcount: 11, annualCostGBP: 401775, effectiveFrom: "2026-09-01" }, // /365.25 = 1100/day
      ],
    });
    expect(peopleCostOn(reference, "HUB", "2026-08-31")).toBe(365250);
    expect(peopleCostOn(reference, "HUB", "2026-09-01")).toBe(401775);

    const tables = buildRateTables(reference, [], "2026-08-30", "2026-09-02", new Map(), new Map());
    expect(tables.hubPoolPerDay("2026-08-31")).toBeCloseTo(1000, 6);
    expect(tables.hubPoolPerDay("2026-09-01")).toBeCloseTo(1100, 6);
  });

  it("0 (not a throw) for an unseeded owner", () => {
    const reference = makeReference({ peopleCostHistory: [] });
    const v = peopleCostOn(reference, "999", "2026-01-01");
    expect(v).toBe(0);
    expect(Number.isFinite(v)).toBe(true);
  });
});

// ===========================================================================
// Pool composition + worktime apportionment
// ===========================================================================
describe("buildRateTables: spoke pool, hub pool, worktime apportionment", () => {
  it("spoke pool = spoke VDI infra/day + spoke people cost/day; hub pool includes HUB people + hub VDI infra; costForRow splits the day's pools proportionally to worktime and the split sums back to the pools", () => {
    const reference = makeReference({
      spokes: [SPOKE1],
      resources: [
        {
          resourceName: "VDI-1", botName: "B1", botAcronym: "B1", vdiName: "VDI-1", costClass: "prod", spokeId: 1,
          activeFrom: "2020-01-01", activeTo: null, notes: null, isActive: true,
          renewalDate: "2020-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "active",
        }, // 3650/365 = 10/day
        {
          resourceName: "VDI-HUB", botName: "BH", botAcronym: "BH", vdiName: "VDI-HUB", costClass: "prod", spokeId: null,
          activeFrom: "2020-01-01", activeTo: null, notes: null, isActive: true,
          renewalDate: "2020-01-01", annualCostGBP: 1825, licenseExpiryDate: null, status: "active",
        }, // 1825/365 = 5/day, hub-owned
      ],
      peopleCostHistory: [
        { ownerId: "1", headcount: 1, annualCostGBP: 36525, effectiveFrom: "2020-01-01" }, // /365.25 = 100/day (spoke's own)
        { ownerId: "HUB", headcount: 1, annualCostGBP: 3652.5, effectiveFrom: "2020-01-01" }, // /365.25 = 10/day
      ],
    });

    const date = "2026-01-01";
    const dayTotalWorktimeSec = new Map([[date, 100]]);
    const daySpokeWorktimeSec = new Map([[`Spoke1|${date}`, 100]]);
    const tables = buildRateTables(reference, [], date, date, dayTotalWorktimeSec, daySpokeWorktimeSec);

    // spoke pool/day = 10 (VDI) + 100 (spoke people) = 110
    expect(tables.spokeInfraPerDay("Spoke1", date)).toBeCloseTo(110, 6);
    // hub pool/day = 10 (HUB people) + 5 (hub-owned VDI) = 15
    expect(tables.hubPoolPerDay(date)).toBeCloseTo(15, 6);

    const processA = makeProcess({ spoke: "Spoke1" });
    const processB = makeProcess({ spoke: "Spoke1" });
    const rowA: DayRow = { date, ts: ts(date), processId: "A", completed: 0, business: 0, system: 0, pending: 0, worktimeSec: 30, completedWorktimeSec: 0, benefitGBP: 0, estateCostGBP: 0 };
    const rowB: DayRow = { date, ts: ts(date), processId: "B", completed: 0, business: 0, system: 0, pending: 0, worktimeSec: 70, completedWorktimeSec: 0, benefitGBP: 0, estateCostGBP: 0 };

    const costA = costForRow(rowA, processA, tables);
    const costB = costForRow(rowB, processB, tables);

    // per-second share = (hubPool + spokePool) / totalWorktime = 125/100 = 1.25
    expect(costA).toBeCloseTo(30 * 1.25, 6);
    expect(costB).toBeCloseTo(70 * 1.25, 6);
    // the day's two processes' costs sum EXACTLY back to the day's total pool.
    expect(costA + costB).toBeCloseTo(tables.hubPoolPerDay(date) + tables.spokeInfraPerDay("Spoke1", date), 6);
    expect(Number.isFinite(costA)).toBe(true);
    expect(Number.isFinite(costB)).toBe(true);
  });
});

// ===========================================================================
// VDI coverage window (D3 algorithm)
// ===========================================================================
describe("vdiDailyCost / vdiAvailableOn: coverage-window algorithm", () => {
  it("a renewal buys exactly 365 days of full cost, tiling both forward and backward from the anchor", () => {
    const reference = makeReference();
    const vdi: VdiCoverageInput = {
      activeFrom: "2020-01-01", activeTo: null, costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "active",
    };
    const perDay = 3650 / 365;
    expect(vdiDailyCost(vdi, "2026-01-01", reference)).toBeCloseTo(perDay, 6);
    expect(vdiDailyCost(vdi, "2026-07-01", reference)).toBeCloseTo(perDay, 6);
    expect(vdiDailyCost(vdi, "2026-12-31", reference)).toBeCloseTo(perDay, 6);
    // the PRIOR cycle (tiled backward from the anchor) is covered too, since activeFrom predates it.
    expect(vdiDailyCost(vdi, "2025-12-31", reference)).toBeCloseTo(perDay, 6);
    // the NEXT cycle starts fresh at full cost again.
    expect(vdiDailyCost(vdi, "2027-01-01", reference)).toBeCloseTo(perDay, 6);
  });

  it("licenseExpiryDate cuts the coverage window (and zeroes cost+availability the day after)", () => {
    const reference = makeReference();
    const vdi: VdiCoverageInput = {
      activeFrom: "2020-01-01", activeTo: null, costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: "2026-06-30", status: "active",
    };
    const windowDays = Math.round((ts("2026-07-01") - ts("2026-01-01")) / DAY_MS); // 181
    expect(windowDays).toBe(181);
    expect(vdiDailyCost(vdi, "2026-06-30", reference)).toBeCloseTo(3650 / 181, 6);
    expect(vdiAvailableOn(vdi, "2026-06-30", reference)).toBe(true);
    expect(vdiDailyCost(vdi, "2026-07-01", reference)).toBe(0);
    expect(vdiAvailableOn(vdi, "2026-07-01", reference)).toBe(false);
  });

  it("retired + activeTo cuts the coverage window the same way", () => {
    const reference = makeReference();
    const vdi: VdiCoverageInput = {
      activeFrom: "2020-01-01", activeTo: "2026-03-31", costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "retired",
    };
    const windowDays = Math.round((ts("2026-04-01") - ts("2026-01-01")) / DAY_MS); // 90
    expect(vdiDailyCost(vdi, "2026-03-31", reference)).toBeCloseTo(3650 / windowDays, 6);
    expect(vdiDailyCost(vdi, "2026-04-01", reference)).toBe(0);
    expect(vdiAvailableOn(vdi, "2026-04-01", reference)).toBe(false);
  });

  it("an active VDI not yet at its activeFrom within the current cycle is out-of-window: zero cost AND zero availability", () => {
    const reference = makeReference();
    const vdi: VdiCoverageInput = {
      activeFrom: "2026-06-01", activeTo: null, costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "active",
    };
    const cost = vdiDailyCost(vdi, "2026-03-01", reference);
    expect(cost).toBe(0);
    expect(Number.isFinite(cost)).toBe(true);
    expect(vdiAvailableOn(vdi, "2026-03-01", reference)).toBe(false);
    // once activeFrom arrives, it's covered for the remainder of the same cycle.
    expect(vdiAvailableOn(vdi, "2026-06-01", reference)).toBe(true);
  });

  it("class rate is resolved at CYCLE START -- a mid-cycle class-rate change doesn't affect cost until the next renewal", () => {
    const reference = makeReference({
      vdiCostHistory: [
        { costClass: "prod", effectiveFrom: "2020-01-01", annualCostPerVDIGBP: 3650 },
        { costClass: "prod", effectiveFrom: "2026-06-01", annualCostPerVDIGBP: 7300 }, // mid-cycle change
      ],
    });
    const vdi: VdiCoverageInput = {
      activeFrom: "2020-01-01", activeTo: null, costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: null, licenseExpiryDate: null, status: "active",
    };
    // this cycle's cost is fixed at the rate in force on 2026-01-01 (cycle start) = 3650, even AFTER 2026-06-01.
    expect(vdiDailyCost(vdi, "2026-01-15", reference)).toBeCloseTo(3650 / 365, 6);
    expect(vdiDailyCost(vdi, "2026-07-01", reference)).toBeCloseTo(3650 / 365, 6);
    // the NEXT cycle (starting 2027-01-01) picks up the new rate.
    expect(vdiDailyCost(vdi, "2027-01-15", reference)).toBeCloseTo(7300 / 365, 6);
  });

  it("a per-VDI annualCostGBP override wins over the costClass rate", () => {
    const reference = makeReference({
      vdiCostHistory: [{ costClass: "prod", effectiveFrom: "2020-01-01", annualCostPerVDIGBP: 999999 }],
    });
    const vdi: VdiCoverageInput = {
      activeFrom: "2020-01-01", activeTo: null, costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "active",
    };
    expect(vdiDailyCost(vdi, "2026-01-15", reference)).toBeCloseTo(3650 / 365, 6);
  });

  it("vdiClassRate: a spoke-scoped class rate beats a universal rate regardless of dates", () => {
    const reference = makeReference({
      vdiCostHistory: [
        { costClass: "prod", effectiveFrom: "2019-01-01", annualCostPerVDIGBP: 500, spokeId: "1" },
        { costClass: "prod", effectiveFrom: "2020-01-01", annualCostPerVDIGBP: 1000 },
      ],
    });
    expect(vdiClassRate(reference, "prod", "2026-01-01", 1)).toBe(500);
    // a hub-owned VDI (spokeId null) only ever matches universal rows.
    expect(vdiClassRate(reference, "prod", "2026-01-01", null)).toBe(1000);
  });

  it("availableDaysInWindow counts exactly the covered days", () => {
    const reference = makeReference();
    const vdi: VdiCoverageInput = {
      activeFrom: "2020-01-01", activeTo: null, costClass: "prod",
      renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: "2026-01-10", status: "active",
    };
    // covered Jan 1..10 inclusive = 10 days, out of a Jan 1..20 window.
    const count = availableDaysInWindow(vdi, reference, ts("2026-01-01"), ts("2026-01-20"));
    expect(count).toBe(10);
  });
});

// ===========================================================================
// Rework (exception) cost
// ===========================================================================
describe("reworkCostForRow", () => {
  it("equals count x SMV/60 x the grade rate in force on the ROW'S OWN date", () => {
    const reference = makeReference({
      gradeRates: [
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2020-01-01", hourlyCostGBP: 24 },
        { grade: "G1", gradeName: "Grade 1", effectiveFrom: "2026-06-01", hourlyCostGBP: 30 },
      ],
    });
    const tables = buildRateTables(reference, [], "2026-01-01", "2026-07-01", new Map(), new Map());
    const process = makeProcess({ grade: "G1", spoke: "Spoke1", smvMinutes: 30 });

    const rowBefore: ExcRow = { date: "2026-01-01", ts: ts("2026-01-01"), processId: "1", reason: "x", category: "business", count: 10, worktimeSec: 0 };
    const rowAfter: ExcRow = { date: "2026-07-01", ts: ts("2026-07-01"), processId: "1", reason: "x", category: "business", count: 10, worktimeSec: 0 };

    // hours = 10 * 30/60 = 5
    expect(reworkCostForRow(rowBefore, process, tables)).toBeCloseTo(5 * 24, 6);
    expect(reworkCostForRow(rowAfter, process, tables)).toBeCloseTo(5 * 30, 6);
  });
});

// ===========================================================================
// Zero-worktime days: unattributed pool, no NaN/Infinity
// ===========================================================================
describe("zero-worktime day handling", () => {
  it("routes the day's pool cost into zeroWorktimePoolCostByDate and never produces NaN/Infinity", () => {
    const reference = makeReference({
      peopleCostHistory: [{ ownerId: "HUB", headcount: 1, annualCostGBP: 3652.5, effectiveFrom: "2020-01-01" }], // 10/day
    });
    const date = "2026-01-01";
    const dayTotalWorktimeSec = new Map<string, number>(); // no entry -> 0
    const daySpokeWorktimeSec = new Map<string, number>();
    const tables = buildRateTables(reference, [], date, date, dayTotalWorktimeSec, daySpokeWorktimeSec);

    expect(tables.zeroWorktimePoolCostByDate.get(date)).toBeCloseTo(10, 6);
    expect(Number.isFinite(tables.hubPoolPerDay(date))).toBe(true);
    expect(Number.isFinite(tables.spokeInfraPerDay("NoSuchSpoke", date))).toBe(true);

    // A row that claims worktime on a day the estate totals say had none is a
    // degenerate/inconsistent input, but costForRow must still guard the
    // division rather than divide by zero.
    const process = makeProcess({ spoke: "NoSuchSpoke" });
    const row: DayRow = { date, ts: ts(date), processId: "1", completed: 0, business: 0, system: 0, pending: 0, worktimeSec: 50, completedWorktimeSec: 0, benefitGBP: 0, estateCostGBP: 0 };
    const cost = costForRow(row, process, tables);
    expect(cost).toBe(0);
    expect(Number.isFinite(cost)).toBe(true);
    expect(Number.isNaN(cost)).toBe(false);
  });
});
