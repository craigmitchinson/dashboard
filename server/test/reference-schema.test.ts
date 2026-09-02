// ---------------------------------------------------------------------------
// reference-schema.test.ts — validate/reference-schema.ts's validateReference():
//   1. NaN/Infinity must be rejected for a numeric field (typeof x === "number"
//      incorrectly admits both; Number.isFinite does not).
//   2. A duplicate spokeId within financeTargets[] must be rejected with a
//      400-shaped { ok: false } result whose error names the duplicate value.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { validateReference } from "../src/validate/reference-schema.js";

// Minimal-but-complete ReferenceJson-shaped object (mirrors the fixture used
// by reference-order.test.ts) so every OTHER section passes validation and
// only the field under test can fail.
function minimalReference(): Record<string, unknown> {
  return {
    spokes: [{ spokeId: 1, spokeName: "Spoke A", shortName: "A", colorLight: "#000000", colorDark: "#000000" }],
    grades: [{ grade: "G1", gradeName: "Grade 1", spokeIds: ["1"] }],
    gradeRates: [{ grade: "G1", gradeName: "Grade 1", effectiveFrom: "2023-01-01", hourlyCostGBP: 10 }],
    propositions: [{ propositionId: 1, propositionName: "Prop 1", spokeId: 1 }],
    processes: [{ processId: 1, processName: "Process 1", propositionId: 1, smvMinutes: 1, grade: "G1" }],
    queueMap: [{ queueName: "Q1", processId: 1 }],
    resources: [
      {
        resourceName: "R1",
        botName: "B1",
        vdiName: "V1",
        costClass: "prod",
        activeFrom: "2023-01-01",
        renewalDate: "2023-01-01",
        status: "active",
      },
    ],
    vdiOperatingHoursPerDay: 20,
    vdiCostHistory: [{ costClass: "prod", effectiveFrom: "2023-01-01", annualCostPerVDIGBP: 100 }],
    estateCostHistory: [{ effectiveFrom: "2023-01-01", teamAnnualCostGBP: 100, workingDaysPerYear: 252, productiveHoursPerDay: 7.5 }],
    peopleCostHistory: [{ ownerId: "HUB", headcount: 1, annualCostGBP: 100, effectiveFrom: "2023-01-01" }],
    exceptionPatterns: [{ matchPattern: "%x%", exceptionType: "Business", priority: 1 }],
    exceptionDisplayCodes: {},
    targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6 },
    financeTargets: [{ spokeId: "ESTATE", annualNetBenefitTargetGBP: 100000 }],
  };
}

describe("validateReference — numeric fields reject NaN/Infinity", () => {
  it("accepts a well-formed financeTargets amount", () => {
    const ref = minimalReference();
    expect(validateReference(ref).ok).toBe(true);
  });

  it("rejects NaN for financeTargets[].annualNetBenefitTargetGBP", () => {
    const ref = minimalReference();
    (ref.financeTargets as Record<string, unknown>[])[0].annualNetBenefitTargetGBP = NaN;
    const result = validateReference(ref);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("annualNetBenefitTargetGBP"))).toBe(true);
  });

  it("rejects Infinity for financeTargets[].annualNetBenefitTargetGBP", () => {
    const ref = minimalReference();
    (ref.financeTargets as Record<string, unknown>[])[0].annualNetBenefitTargetGBP = Infinity;
    const result = validateReference(ref);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("annualNetBenefitTargetGBP"))).toBe(true);
  });
});

describe("validateReference — duplicate detection", () => {
  it("rejects a duplicate spokeId within financeTargets, naming the duplicate value", () => {
    const ref = minimalReference();
    ref.financeTargets = [
      { spokeId: "SPK-04", annualNetBenefitTargetGBP: 100000 },
      { spokeId: "SPK-04", annualNetBenefitTargetGBP: 50000 },
    ];
    const result = validateReference(ref);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Duplicate spokeId "SPK-04" in financeTargets');
  });
});
