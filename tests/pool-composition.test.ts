// ---------------------------------------------------------------------------
// tests/pool-composition.test.ts
// ---------------------------------------------------------------------------
// D6 pool-composition breakdown: RateTables.poolCompositionOn(date, spoke)
// (src/reference/economics.ts, part of buildRateTables' returned object)
// splits each day's hub/spoke pool cost into people vs infra components.
// This must reconcile EXACTLY (to the penny, asserted here to 1e-9) back to
// hubPoolPerDay/spokeInfraPerDay — see the doc comment on RateTables in
// economics.ts — and must degrade to 0 (never NaN) for an un-seeded spoke,
// a pre-history date, or an out-of-coverage-window VDI.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { buildRateTables } from "../src/reference/economics";
import { makeReference } from "./fixtures";

const SPOKE1 = { spokeId: 1, spokeName: "Spoke1", shortName: "S1", colorLight: "#111111", colorDark: "#eeeeee" };
const SPOKE2 = { spokeId: 2, spokeName: "Spoke2", shortName: "S2", colorLight: "#222222", colorDark: "#dddddd" };

describe("poolCompositionOn", () => {
  it("hubPeople+hubInfra reconstitutes hubPoolPerDay; spokePeople+spokeInfra reconstitutes that spoke's whole pool", () => {
    const reference = makeReference({
      spokes: [SPOKE1, SPOKE2],
      resources: [
        {
          resourceName: "VDI-HUB", botName: "BH", botAcronym: "BH", vdiName: "VDI-HUB", costClass: "prod", spokeId: null,
          activeFrom: "2020-01-01", activeTo: null, notes: null, isActive: true,
          renewalDate: "2020-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "active",
        }, // 3650/365 = 10/day, hub-owned
        {
          resourceName: "VDI-1", botName: "B1", botAcronym: "B1", vdiName: "VDI-1", costClass: "prod", spokeId: 1,
          activeFrom: "2020-01-01", activeTo: null, notes: null, isActive: true,
          renewalDate: "2020-01-01", annualCostGBP: 1825, licenseExpiryDate: null, status: "active",
        }, // 1825/365 = 5/day, Spoke1-owned
      ],
      peopleCostHistory: [
        { ownerId: "HUB", headcount: 1, annualCostGBP: 3652.5, effectiveFrom: "2020-01-01" }, // /365.25 = 10/day
        { ownerId: "1", headcount: 1, annualCostGBP: 7305, effectiveFrom: "2020-01-01" }, // /365.25 = 20/day (Spoke1's own)
        // no ownerId "2" record at all -> Spoke2 has no people cost
      ],
    });
    const date = "2026-01-01";
    const tables = buildRateTables(reference, [], date, date, new Map(), new Map());

    const compSpoke1 = tables.poolCompositionOn(date, "Spoke1");
    expect(compSpoke1.hubPeople).toBeCloseTo(10, 9);
    expect(compSpoke1.hubInfra).toBeCloseTo(10, 9);
    expect(compSpoke1.spokePeople).toBeCloseTo(20, 9);
    expect(compSpoke1.spokeInfra).toBeCloseTo(5, 9);
    expect(compSpoke1.hubPeople + compSpoke1.hubInfra).toBeCloseTo(tables.hubPoolPerDay(date), 9);
    expect(compSpoke1.spokePeople + compSpoke1.spokeInfra).toBeCloseTo(tables.spokeInfraPerDay("Spoke1", date), 9);

    // Spoke2: no peopleCostHistory record and no owned VDI -> both 0, and the
    // identity still holds against a 0 pool (not NaN).
    const compSpoke2 = tables.poolCompositionOn(date, "Spoke2");
    expect(compSpoke2.spokePeople).toBe(0);
    expect(compSpoke2.spokeInfra).toBe(0);
    expect(compSpoke2.spokePeople + compSpoke2.spokeInfra).toBeCloseTo(tables.spokeInfraPerDay("Spoke2", date), 9);
    expect(tables.spokeInfraPerDay("Spoke2", date)).toBe(0);
  });

  it("a day before any people-cost record resolves every component to 0, never NaN", () => {
    const reference = makeReference({
      spokes: [SPOKE1],
      peopleCostHistory: [{ ownerId: "HUB", headcount: 1, annualCostGBP: 3652.5, effectiveFrom: "2026-01-01" }],
    });
    const tables = buildRateTables(reference, [], "2020-01-01", "2020-01-01", new Map(), new Map());
    const comp = tables.poolCompositionOn("2020-01-01", "Spoke1");
    expect(comp.hubPeople).toBe(0);
    expect(comp.hubInfra).toBe(0);
    expect(comp.spokePeople).toBe(0);
    expect(comp.spokeInfra).toBe(0);
    for (const v of [comp.hubPeople, comp.hubInfra, comp.spokePeople, comp.spokeInfra]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("a retired VDI's infra component is exactly 0 on a day after its coverage window closes", () => {
    const reference = makeReference({
      spokes: [SPOKE1],
      resources: [
        {
          resourceName: "VDI-1", botName: "B1", botAcronym: "B1", vdiName: "VDI-1", costClass: "prod", spokeId: 1,
          activeFrom: "2020-01-01", activeTo: "2026-03-31", notes: null, isActive: false,
          renewalDate: "2026-01-01", annualCostGBP: 3650, licenseExpiryDate: null, status: "retired",
        },
      ],
      peopleCostHistory: [{ ownerId: "1", headcount: 1, annualCostGBP: 3652.5, effectiveFrom: "2020-01-01" }], // 10/day, unaffected by the VDI's retirement
    });
    const tables = buildRateTables(reference, [], "2026-03-31", "2026-04-01", new Map(), new Map());
    const comp = tables.poolCompositionOn("2026-04-01", "Spoke1");
    expect(comp.spokeInfra).toBe(0);
    expect(comp.spokePeople).toBeCloseTo(10, 9);
    expect(comp.spokePeople + comp.spokeInfra).toBeCloseTo(tables.spokeInfraPerDay("Spoke1", "2026-04-01"), 9);

    // one day before retirement, the VDI is still fully in its coverage window.
    const compBefore = tables.poolCompositionOn("2026-03-31", "Spoke1");
    expect(compBefore.spokeInfra).toBeGreaterThan(0);
  });
});
