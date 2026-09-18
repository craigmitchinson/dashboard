// ---------------------------------------------------------------------------
// help/tour-steps.ts
// ---------------------------------------------------------------------------
// Pure step data + pure skip logic (no DOM, no React) so it's directly unit
// testable — see tests/help-tour-steps.test.ts. TourOverlay.tsx supplies the
// real `hasTarget` (a querySelector[data-tour=...] + visibility check) at
// render time.
// ---------------------------------------------------------------------------

export type TourTargetId = "nav" | "filters" | "freshness" | "kpi" | "bell" | "search";

export interface TourStepDef {
  id: TourTargetId;
  title: string;
  body: string;
}

// The six-step first-run tour, in order. Selectors: `[data-tour="<id>"]` on
// the corresponding element (nav rail, filter bar, data-freshness pill, a
// KPI card, the notification bell, the ⌘K search trigger).
export const TOUR_STEPS: TourStepDef[] = [
  { id: "nav", title: "Navigation", body: "Six groups, thirteen pages. Pages you can't see are hidden, not greyed." },
  { id: "filters", title: "Filter bar", body: "Every chart on the page follows these. Spoke first; the rest narrow to it." },
  { id: "freshness", title: "Data-through pill", body: "Every date window ends here, not today." },
  { id: "kpi", title: "A KPI card", body: "Value, change against the previous window, and target status. Red always means a breach or a negative." },
  { id: "bell", title: "Bell", body: "Threshold breaches and warnings for your hub. Acknowledge or snooze." },
  { id: "search", title: "Search", body: "Jump anywhere, drill into a process, or type > for actions." },
];

/**
 * Filters the fixed step list down to the ones with a live target right now,
 * preserving order. A missing target (e.g. the filter bar on a `noSlicers`
 * page, or chrome collapsed away at a narrow width) is skipped rather than
 * shown pointing at nothing.
 */
export function resolveVisibleSteps(steps: TourStepDef[], hasTarget: (id: TourTargetId) => boolean): TourStepDef[] {
  return steps.filter((s) => hasTarget(s.id));
}
