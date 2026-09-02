// ---------------------------------------------------------------------------
// tests/fixtures.ts
// ---------------------------------------------------------------------------
// Shared test-data builders. `makeReference` returns a minimal-but-complete
// ReferenceJson (every field present, all collections empty) that callers
// override piecemeal — keeps each test's fixture focused on the fields that
// actually matter for the rule under test instead of restating the whole
// shape every time.
// ---------------------------------------------------------------------------
import type { ReferenceJson, TargetsRef } from "../src/reference/reference-store";
import type { ModelJson } from "../src/rpaData";

export const DEFAULT_TARGETS: TargetsRef = {
  completionPct: 0.95,
  exceptionRate: 0.06,
  systemRate: 0.03,
  costPerCase: 9,
  utilMin: 0.15,
  utilMax: 0.6,
  vdiStaleDays: 14,
};

export function makeReference(overrides: Partial<ReferenceJson> = {}): ReferenceJson {
  return {
    spokes: [],
    grades: [],
    gradeRates: [],
    propositions: [],
    processes: [],
    queueMap: [],
    resources: [],
    vdiOperatingHoursPerDay: 20,
    vdiCostHistory: [],
    estateCostHistory: [],
    peopleCostHistory: [],
    exceptionPatterns: [],
    exceptionDisplayCodes: {},
    targets: { ...DEFAULT_TARGETS },
    thresholdOverrides: [],
    ...overrides,
  };
}

export function makeModel(overrides: Partial<ModelJson> = {}): ModelJson {
  const reference = overrides.reference ?? makeReference();
  return {
    meta: { generatedAt: "2026-01-01T00:00:00.000Z", source: "test", sourceRows: 0, dateMin: "2026-01-01", dateMax: "2026-01-10", unmappedQueues: [] },
    targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6 },
    vdiOperatingHoursPerDay: 20,
    spokes: [],
    propositions: [],
    processes: [],
    resources: [],
    exceptionReasons: [],
    estateRateByDate: [],
    dayRows: [],
    excRows: [],
    resRows: [],
    reference,
    ...overrides,
  };
}
