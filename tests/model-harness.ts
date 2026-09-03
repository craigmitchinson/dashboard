// ---------------------------------------------------------------------------
// tests/model-harness.ts
// ---------------------------------------------------------------------------
// src/filters-context.tsx exports `computeModel(filters, rateOverride,
// reference, tables)` — the pure "build me a Model" entry point the
// provider's own `model` useMemo is a thin wrapper over. This harness just
// wires up its three non-filters inputs from a ModelJson fixture (via
// initData(), same as the real FiltersProvider does at mount) and calls it
// directly — no react-dom/server render, no DEFAULT_FILTERS mutation.
// ---------------------------------------------------------------------------
import { initData, ROWS, REFERENCE_BASE, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS } from "../src/rpaData";
import type { ModelJson } from "../src/rpaData";
import { DEFAULT_FILTERS, RATE_AUTO, computeModel } from "../src/filters-context";
import type { Filters, Model } from "../src/filters-context";
import { buildRateTables } from "../src/reference/economics";

export function renderModel(model: ModelJson, filterOverrides: Partial<Filters> = {}): Model {
  initData(model);

  const filters: Filters = { ...DEFAULT_FILTERS, ...filterOverrides };
  const reference = REFERENCE_BASE;
  if (!reference) throw new Error("renderModel: REFERENCE_BASE is null after initData() — model.json is missing its embedded `reference` field");

  const tables = buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS);
  return computeModel(filters, RATE_AUTO, reference, tables);
}
