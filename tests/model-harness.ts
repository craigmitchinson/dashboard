// ---------------------------------------------------------------------------
// tests/model-harness.ts
// ---------------------------------------------------------------------------
// aggregate() in src/filters-context.tsx is NOT exported (only the
// FiltersProvider component / useFilters hook are), and it closes over
// module-level state populated by src/rpaData.ts's initData(). To get a pure
// "build me a Model for this ModelJson + these filters" entry point WITHOUT
// editing any src/** file, this harness renders the real FiltersProvider
// tree via react-dom/server (a synchronous, DOM-less render — this suite's
// vitest environment is plain "node", no jsdom) with a tiny Probe component
// that captures `useFilters().model` during render, then returns it.
//
// Applying a non-default Filters selection without a src change: react-dom/
// server does one synchronous top-down render pass with no event loop, so
// there is no way to *call* setFilters and observe a second render.
// FiltersProviderInner instead does `useState<Filters>(DEFAULT_FILTERS)` —
// passing the imported object DIRECTLY (not a lazy-init function) — so React
// adopts that exact object reference as the state on mount. DEFAULT_FILTERS
// is an exported `const` binding but the OBJECT it points to is a plain
// mutable POJO, not frozen. Mutating its fields immediately before the
// render call (then restoring them in a `finally`) lets this harness select
// any Filters for that one render without touching src/filters-context.tsx.
// ---------------------------------------------------------------------------
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initData } from "../src/rpaData";
import type { ModelJson } from "../src/rpaData";
import { FiltersProvider, useFilters, DEFAULT_FILTERS } from "../src/filters-context";
import type { Filters, Model } from "../src/filters-context";

export function renderModel(model: ModelJson, filterOverrides: Partial<Filters> = {}): Model {
  initData(model);

  const snapshot: Filters = { ...DEFAULT_FILTERS };
  for (const k of Object.keys(DEFAULT_FILTERS)) delete (DEFAULT_FILTERS as Record<string, unknown>)[k];
  Object.assign(DEFAULT_FILTERS, snapshot, filterOverrides);

  let captured: Model | null = null;
  function Probe() {
    captured = useFilters().model;
    return null;
  }

  try {
    renderToStaticMarkup(createElement(FiltersProvider, null, createElement(Probe)));
  } finally {
    for (const k of Object.keys(DEFAULT_FILTERS)) delete (DEFAULT_FILTERS as Record<string, unknown>)[k];
    Object.assign(DEFAULT_FILTERS, snapshot);
  }

  if (!captured) throw new Error("renderModel: Probe never rendered — FiltersProvider tree failed silently");
  return captured;
}
