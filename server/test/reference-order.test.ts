// ---------------------------------------------------------------------------
// reference-order.test.ts — data/table-order.ts's DELETE_ORDER/INSERT_ORDER
// (what SqlReferenceStore.put() uses against a real database) must equal
// the SPA's own src/reference/reference-store.ts's exportReferenceSql()
// order exactly — a divergence here is a data-corrupting bug waiting to
// happen the moment someone edits one exporter without the other.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { exportReferenceSql, type ReferenceJson } from "../../src/reference/reference-store.ts";
import { DELETE_ORDER, INSERT_ORDER } from "../src/data/table-order.js";

// insertStatement() emits a "-- no rows to insert" COMMENT (not an INSERT
// INTO) for an empty array, so an all-empty reference would produce ZERO
// INSERT INTO statements and this test couldn't recover an order at all —
// every table needs at least one row.
const minimalReference: ReferenceJson = {
  spokes: [{ spokeId: 1, spokeName: "Spoke A", shortName: "A", colorLight: "#000000", colorDark: "#000000" }],
  grades: [{ grade: "G1", gradeName: "Grade 1", spokeIds: ["1"] }],
  gradeRates: [{ grade: "G1", gradeName: "Grade 1", effectiveFrom: "2023-01-01", hourlyCostGBP: 10 }],
  propositions: [{ propositionId: 1, propositionName: "Prop 1", spokeId: 1 }],
  processes: [
    { processId: 1, processName: "Process 1", processAcronym: "P1", processDescription: "d", propositionId: 1, smvMinutes: 1, grade: "G1", isActive: true, icon: "form", tags: [] },
  ],
  queueMap: [{ queueName: "Q1", processId: 1, stageName: null, stageOrder: null }],
  resources: [
    {
      resourceName: "R1", botName: "B1", botAcronym: "B1", vdiName: "V1", costClass: "prod", spokeId: 1,
      activeFrom: "2023-01-01", activeTo: null, notes: null, isActive: true,
      renewalDate: "2023-01-01", annualCostGBP: null, licenseExpiryDate: null, status: "active",
    },
  ],
  vdiOperatingHoursPerDay: 20,
  vdiCostHistory: [{ costClass: "prod", effectiveFrom: "2023-01-01", annualCostPerVDIGBP: 100 }],
  estateCostHistory: [{ effectiveFrom: "2023-01-01", teamAnnualCostGBP: 100, workingDaysPerYear: 252, productiveHoursPerDay: 7.5 }],
  peopleCostHistory: [{ ownerId: "HUB", headcount: 1, annualCostGBP: 100, effectiveFrom: "2023-01-01" }],
  exceptionPatterns: [{ matchPattern: "%x%", exceptionType: "Business", priority: 1 }],
  exceptionDisplayCodes: {},
  targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 },
};

function extractOrder(sql: string, verb: "DELETE FROM" | "INSERT INTO"): string[] {
  const re = new RegExp(`${verb} core\\.(\\w+)`, "g");
  const order: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) order.push(m[1]);
  return order;
}

describe("reference write order parity", () => {
  const sql = exportReferenceSql(minimalReference);

  it("DELETE_ORDER matches exportReferenceSql's delete order", () => {
    expect(DELETE_ORDER).toEqual(extractOrder(sql, "DELETE FROM"));
  });

  it("INSERT_ORDER matches exportReferenceSql's insert order", () => {
    expect(INSERT_ORDER).toEqual(extractOrder(sql, "INSERT INTO"));
  });
});
