// ---------------------------------------------------------------------------
// help/page-mapping.ts
// ---------------------------------------------------------------------------
// Pure lookup tables mapping a dashboard page id (App.tsx's `Page.id`) to (a)
// the feature-catalogue section that documents it and (b) the metric
// dictionary items ("section: metrics" in docs/feature-catalogue.data.mjs)
// whose measures actually appear on that page — the drawer's "Metric
// definitions on this page" block.
// ---------------------------------------------------------------------------

export const PAGE_SECTION_MAP: Record<string, string> = {
  overview: "page-overview",
  alerts: "page-alerts",
  "input-outcome": "page-input-outcome",
  process: "page-process-analysis",
  exceptions: "page-exceptions",
  "process-detail": "page-process-detail",
  capacity: "page-capacity",
  exec: "page-exec",
  value: "page-value-finance",
  commercial: "page-commercial",
  admin: "admin",
  model: "page-reference",
  playbook: "page-reference",
};

export function sectionIdForPage(pageId: string): string | undefined {
  return PAGE_SECTION_MAP[pageId];
}

// Per-page allowlist of "metrics" section item ids (docs/feature-catalogue.data.mjs).
// overview's list is given verbatim by the feature brief; the rest are this
// worker's best-effort match between each page's own catalogue section
// content and the metric dictionary — worth a hub/product pass to confirm.
export const PAGE_METRIC_ALLOWLIST: Record<string, string[]> = {
  overview: ["m-completion", "m-cpc", "m-exceptions", "m-netfte", "m-completed", "m-timesaved", "m-excrate", "m-outcomemix"],
  alerts: ["m-completion", "m-excrate", "m-system", "m-util", "m-cpc"],
  "input-outcome": ["m-attempts", "m-completed", "m-outcomemix", "m-business", "m-system"],
  process: ["m-cycle", "m-wcycle", "m-completion", "m-excrate", "m-activedays"],
  exceptions: ["m-exceptions", "m-business", "m-system", "m-excrate", "m-rework"],
  "process-detail": ["m-completion", "m-cycle", "m-excrate", "m-cpc", "m-timesaved"],
  capacity: ["m-util", "m-idle", "m-available", "m-activehours", "m-stale", "m-costshare"],
  exec: ["m-net", "m-roi", "m-cpc", "m-fytd", "m-projected", "m-netfte"],
  value: ["m-gross", "m-net", "m-cost", "m-roi", "m-runrate", "m-payback", "m-teams", "m-machines"],
  commercial: ["m-cpc", "m-roi", "m-margin", "m-trend12", "m-pareto", "m-graderate"],
  admin: ["m-smv", "m-graderate", "m-blendedrate"],
  model: [],
  playbook: [],
};

export function metricIdsForPage(pageId: string): string[] {
  return PAGE_METRIC_ALLOWLIST[pageId] ?? [];
}
