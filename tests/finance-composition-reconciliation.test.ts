// ---------------------------------------------------------------------------
// tests/finance-composition-reconciliation.test.ts
// ---------------------------------------------------------------------------
// Reconciliation identity for the D6 pool-composition breakdown (see
// src/filters-context.tsx's `costComposition`/`bySpoke` and the doc comment
// on RateTables.poolCompositionOn in src/reference/economics.ts), exercised
// against the REAL BUILT public/data/model.json rather than a synthetic
// fixture — a regression trip-wire on the actual mock estate, not just the
// pure formula. costComposition is the two-way (Teams, Machines) PUBLIC
// split — CoE is one owner alongside the spokes, not a separate tier — while
// poolCompositionOn itself stays a 4-way (hub/spoke × people/infra) internal
// helper that this identity's teams/machines are summed from.
//
// aggregate() (filters-context.tsx) is not exported — only the
// FiltersProvider component / useFilters hook are — so this loads the model
// through the real provider tree via tests/model-harness.ts's renderModel(),
// which is a DOM-less react-dom/server render capturing useFilters().model.
// See that file's header comment for exactly how, and why it needs no
// src/** change.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelJson } from "../src/rpaData";
import { renderModel } from "./model-harness";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = join(root, "public", "data", "model.json");
const PENNY = 0.01;

describe("cost-composition reconciliation (real mock model)", () => {
  it.skipIf(!existsSync(modelPath))("DEFAULT_FILTERS: teams + machines reconciles to automationCost/netBenefit, and per-spoke sums reconcile to the estate", () => {
    const model: ModelJson = JSON.parse(readFileSync(modelPath, "utf8"));
    const m = renderModel(model);

    const comp = m.costComposition;
    const compTotal = comp.teams + comp.machines;
    expect(compTotal).toBeGreaterThan(0); // sanity: the mock estate has real spend
    expect(Math.abs(compTotal - m.automationCost)).toBeLessThan(PENNY);

    // per-spoke composition (peopleCost/infraCost) sums to that spoke's own cost
    for (const s of m.bySpoke) {
      expect(Math.abs(s.peopleCost + s.infraCost - s.cost)).toBeLessThan(PENNY);
    }

    // sum over spokes of spoke cost === estate cost
    const spokeCostSum = m.bySpoke.reduce((sum, s) => sum + s.cost, 0);
    expect(Math.abs(spokeCostSum - m.automationCost)).toBeLessThan(PENNY);

    // netBenefit === grossBenefit - estateCost EXACTLY (unattributed excluded from both sides)
    expect(m.netBenefit).toBe(m.grossBenefit - m.automationCost);
  });

  it.skipIf(!existsSync(modelPath))("single-spoke filter: the same identities hold for the filtered window", () => {
    const model: ModelJson = JSON.parse(readFileSync(modelPath, "utf8"));
    const spokeName: string = model.spokes[0].name;
    const m = renderModel(model, { spoke: spokeName });

    const comp = m.costComposition;
    const compTotal = comp.teams + comp.machines;
    expect(Math.abs(compTotal - m.automationCost)).toBeLessThan(PENNY);

    // filtering to one spoke collapses bySpoke to (at most) that one spoke
    expect(m.bySpoke.every((s) => s.spoke === spokeName)).toBe(true);
    for (const s of m.bySpoke) {
      expect(Math.abs(s.peopleCost + s.infraCost - s.cost)).toBeLessThan(PENNY);
    }
    const spokeCostSum = m.bySpoke.reduce((sum, s) => sum + s.cost, 0);
    expect(Math.abs(spokeCostSum - m.automationCost)).toBeLessThan(PENNY);

    expect(m.netBenefit).toBe(m.grossBenefit - m.automationCost);
  });
});
