// ---------------------------------------------------------------------------
// tests/help-tour-steps.test.ts
// ---------------------------------------------------------------------------
// src/help/tour-steps.ts — the tour's fixed six-step list and the pure
// skip-when-missing-target logic (resolveVisibleSteps). The real DOM lookup
// lives in TourOverlay.tsx; here `hasTarget` is a fake so the filtering
// logic itself is exercised in isolation.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { TOUR_STEPS, resolveVisibleSteps } from "../src/help/tour-steps";

describe("TOUR_STEPS", () => {
  it("has exactly the six steps, in order, from the brief", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["nav", "filters", "freshness", "kpi", "bell", "search"]);
  });

  it("every step has a non-empty title and body", () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveVisibleSteps", () => {
  it("keeps every step when every target is present", () => {
    const result = resolveVisibleSteps(TOUR_STEPS, () => true);
    expect(result).toEqual(TOUR_STEPS);
  });

  it("drops the filters step on a noSlicers page (no filter-bar target)", () => {
    const result = resolveVisibleSteps(TOUR_STEPS, (id) => id !== "filters");
    expect(result.map((s) => s.id)).toEqual(["nav", "freshness", "kpi", "bell", "search"]);
  });

  it("drops a step whose target is collapsed away at a narrow width (e.g. kpi)", () => {
    const result = resolveVisibleSteps(TOUR_STEPS, (id) => id !== "kpi");
    expect(result.map((s) => s.id)).toEqual(["nav", "filters", "freshness", "bell", "search"]);
  });

  it("preserves step order regardless of which targets are missing", () => {
    const result = resolveVisibleSteps(TOUR_STEPS, (id) => id === "search" || id === "nav");
    expect(result.map((s) => s.id)).toEqual(["nav", "search"]);
  });

  it("returns an empty array when nothing is present", () => {
    expect(resolveVisibleSteps(TOUR_STEPS, () => false)).toEqual([]);
  });
});
