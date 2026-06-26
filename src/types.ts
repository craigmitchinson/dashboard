// The roadmap is a five-level tree. The slide is a flattened, column-based
// view of this tree. Keep this shape clean and serialisable so that file or
// API persistence can be bolted on later without touching the render layer.
//
//   Theme  -> many Outcomes
//   Outcome -> many Epics
//   Epic   -> many Features
//   Feature -> one or more Values
//
// A Value is the leaf unit of the layout. Every level above it (including the
// Feature) spans the combined height of its descendant leaves (see layout.ts).

export interface Value {
  id: string;
  text: string;
}

export interface Feature {
  id: string;
  text: string;
  /** Optional Jira (or other tracker) reference, e.g. "ONB-1201". */
  ref?: string;
  /** One or more value statements. A feature spans the height of its values,
   *  which are the leaf unit of the layout. */
  values: Value[];
}

export interface Epic {
  id: string;
  text: string;
  /** Optional Jira reference. */
  ref?: string;
  features: Feature[];
}

export interface Outcome {
  id: string;
  text: string;
  /** Optional Jira reference. */
  ref?: string;
  epics: Epic[];
}

/** Levels that carry a Jira reference. */
export type RefLevel = "outcome" | "epic" | "feature";

export interface Theme {
  id: string;
  text: string;
  outcomes: Outcome[];
}

/** Org identity shown on every slide and shared across the whole pack. The team
 *  itself is the active-team selection (held in the teams context), not here. */
export interface Org {
  platform: string;
  lab: string;
}

export type OrgField = keyof Org;

/** Per-slide chrome. The eyebrow above the title is the shared QBR + quarter
 *  label (driven by the quarter picker); the team identity lives in Org. */
export interface RoadmapMeta {
  /** The slide's display title. */
  title: string;
}

export type MetaField = keyof RoadmapMeta;

export interface Roadmap {
  meta: RoadmapMeta;
  themes: Theme[];
}

/** The five columns, in left-to-right order. */
export type Level = "theme" | "outcome" | "epic" | "feature" | "value";

export const LEVELS: Level[] = ["theme", "outcome", "epic", "feature", "value"];

export const COLUMN_HEADINGS: Record<Level, string> = {
  theme: "Theme",
  outcome: "Outcome",
  epic: "Epics",
  feature: "Features",
  value: "Value",
};

// ---------------------------------------------------------------------------
// Dependencies slide
// ---------------------------------------------------------------------------
// A second view in the same pack. Dependencies are grouped by time horizon
// (this quarter and previous, vs next quarter and beyond), and within each are
// classified by commitment status and by whether they are newly arriving
// (incoming) or carried over from before (existing).

export type DepStatus = "committed" | "not-committed" | "blocked";
export type DepOrigin = "incoming" | "existing";

export const DEP_STATUSES: DepStatus[] = [
  "committed",
  "not-committed",
  "blocked",
];

export const DEP_STATUS_LABELS: Record<DepStatus, string> = {
  committed: "Committed",
  "not-committed": "Not committed",
  blocked: "Blocked",
};

export const DEP_ORIGIN_LABELS: Record<DepOrigin, string> = {
  incoming: "Incoming",
  existing: "Existing",
};

export interface Dependency {
  id: string;
  text: string;
  status: DepStatus;
  origin: DepOrigin;
}

export interface Escalation {
  id: string;
  text: string;
}

export type RiskSeverity = "high" | "medium" | "low";

export const RISK_SEVERITIES: RiskSeverity[] = ["high", "medium", "low"];

export const RISK_SEVERITY_LABELS: Record<RiskSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export interface Risk {
  id: string;
  text: string;
  severity: RiskSeverity;
}

/** The two time-horizon columns of the dependencies slide. */
export type Horizon = "current" | "next";

export interface DependenciesBoard {
  title: string;
  current: Dependency[];
  next: Dependency[];
  escalations: Escalation[];
  risks: Risk[];
}

export type BoardField = "title" | "team";

// ---------------------------------------------------------------------------
// Delivery slide
// ---------------------------------------------------------------------------
// A trend view over the last three quarters (including the selected, possibly
// in-progress, quarter) plus per-quarter delivery highlights.

export interface DeliveryMetrics {
  committed: number;
  delivered: number;
  committedDelivered: number;
  throughput: number;
}

export type MetricField = keyof DeliveryMetrics;

export const METRIC_ROWS: { field: MetricField; label: string }[] = [
  { field: "committed", label: "Features committed" },
  { field: "delivered", label: "Features delivered" },
  { field: "committedDelivered", label: "Committed features delivered" },
  { field: "throughput", label: "Total throughput" },
];

export interface DeliveryHighlight {
  id: string;
  team: string;
  text: string;
}

export type HighlightField = "team" | "text";

export interface DeliveryBoard {
  title: string;
  metrics: DeliveryMetrics;
  highlights: DeliveryHighlight[];
}

// ---------------------------------------------------------------------------
// Objectives (OKRs) slide
// ---------------------------------------------------------------------------

export type RagStatus = "on-track" | "at-risk" | "off-track";

export const RAG_STATUSES: RagStatus[] = ["on-track", "at-risk", "off-track"];

export const RAG_LABELS: Record<RagStatus, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
};

export interface KeyResult {
  id: string;
  text: string;
  /** Freeform progress measure, e.g. "62% vs 70% target". */
  metric: string;
  status: RagStatus;
}

export interface Objective {
  id: string;
  text: string;
  status: RagStatus;
  keyResults: KeyResult[];
}

export interface ObjectivesBoard {
  title: string;
  objectives: Objective[];
}

export type KrField = "text" | "metric";

// ---------------------------------------------------------------------------
// Summary (executive opener) slide
// ---------------------------------------------------------------------------

export interface Ask {
  id: string;
  owner: string;
  text: string;
}

export type AskField = "owner" | "text";

export interface SummaryBoard {
  title: string;
  /** One-line headline / TL;DR (the one human narrative line). */
  headline: string;
  /** Decisions / asks for leadership. */
  asks: Ask[];
}

export type SummaryField = "title" | "headline";

/** Highlights, watch-outs and next-quarter focus are derived from the other
 *  tabs rather than typed, so the summary always reflects the real data. */
export interface DerivedStory {
  highlights: string[];
  watchouts: string[];
  focus: string[];
}
