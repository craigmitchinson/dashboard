// ---------------------------------------------------------------------------
// Blue Prism RPA dataset (semantic model)
// ---------------------------------------------------------------------------
// The app's data store. NOTHING here is synthetic any more: every binding is
// populated by initData() from /data/model.json, which tools/build-dashboard-data.mjs
// derives from a work-queue export CSV (mock or real) + team-owned reference
// data — the same transforms as the bp-sql-layer SQL warehouse. Swap the CSV,
// re-run `npm run data:build`, and every visual updates; point VITE_DATA_URL at
// an API serving the same JSON and the app runs off the live warehouse.
//
// main.tsx awaits the fetch and calls initData() BEFORE the first render, so
// modules may import these bindings freely — they are `let` live bindings that
// are final by the time any component reads them.
//
// HUB & SPOKE: every process belongs to a proposition, which belongs to a CoE
// spoke. Benefit is valued per process at its GRADE's rate in force on each
// item's outcome date (precomputed into the rows as `gb`); estate cost is the
// hub pool apportioned across all work plus the spoke's own infra apportioned
// within the spoke (precomputed as `ec`). The client only ever SUMS money —
// all rate resolution happened in the pipeline, identically to the SQL views.
//
// Grain of the fact tables:
//   ROWS      one row per (outcome date, process): outcomes, worktime, £gb, £ec
//   EXC_ROWS  one row per (outcome date, process, exception reason)
//   RES_ROWS  one row per (outcome date, resource, process): items, worktime, £ec

import type { ComponentType } from "react";
import {
  IconForm,
  IconLetter,
  IconPayment,
  IconShield,
  IconGlobe,
  IconRoute,
  IconInbox,
  IconCard,
  IconRefresh,
  IconGraph,
} from "./components/icons";
import type { ReferenceJson } from "./reference/reference-store";

export type OutcomeKey = "completed" | "business" | "system";

export const OUTCOMES: { key: OutcomeKey; label: string }[] = [
  { key: "completed", label: "Completed" },
  { key: "business", label: "Business exception" },
  { key: "system", label: "System exception" },
];

// --- shape of /data/model.json (the pipeline output) ------------------------
export interface ModelJson {
  meta: { generatedAt: string; source: string; sourceRows: number; dateMin: string; dateMax: string; unmappedQueues: string[] };
  targets: { completionPct: number; exceptionRate: number; systemRate: number; costPerCase: number; utilMin: number; utilMax: number };
  vdiOperatingHoursPerDay: number;
  spokes: { id: number; name: string; short: string; colorLight: string; colorDark: string }[];
  propositions: { name: string; spoke: string }[];
  processes: {
    id: number; name: string; acronym: string; description: string;
    proposition: string; spoke: string;
    queues: { queue: string; stage: string | null; order: number | null }[];
    smvMinutes: number; grade: string; gradeName: string; currentHourly: number;
    icon: string; tags: string[];
  }[];
  resources: {
    name: string; bot: string; acronym: string; vdi: string; class: string; spoke: string;
    spokeId: number | null;
    activeFrom: string; activeTo: string | null; notes: string | null;
    renewalDate: string; annualCostGBP: number | null; licenseExpiryDate: string | null; status: "active" | "retired";
  }[];
  exceptionReasons: { reason: string; type: "System" | "Business"; code: string }[];
  estateRateByDate: { d: string; cost: number; wd: number; ph: number }[];
  dayRows: { d: string; p: number; c: number; b: number; s: number; n: number; w: number; cw: number; gb: number; ec: number }[];
  excRows: { d: string; p: number; r: string; t: "System" | "Business"; n: number; w: number }[];
  resRows: { d: string; r: string; p: number; n: number; e: number; w: number; ec: number }[];
  dayWorktimeTotals?: Record<string, number>;
  spokeDayWorktimeTotals?: Record<string, number>;
  // Per-VDI activity discovery (D6 — stale-VDI flagging), computed from ALL
  // items including unmapped-queue rows (spokesServed is [] for a resource
  // whose activity is entirely on unmapped queues). Optional/undefined-safe
  // for an older model.json that predates this field — see RESOURCE_ACTIVITY
  // below and src/alerts/engine.ts's stale-VDI check.
  resourceActivity?: Record<string, { firstSeen: string; lastSeen: string; items: number; spokesServed: string[] }>;
  // Full base reference object (unmodified data/reference/reference.json), so
  // the client can overlay browser-side edits onto it — see src/reference/.
  reference: ReferenceJson;
}

// --- dimensions ---------------------------------------------------------------
export interface ProcessDim {
  id: string; // ProcessId as string ("101") — string keys keep slicer state simple
  name: string;
  acronym: string;
  description: string;
  proposition: string;
  spoke: string;
  queue: string; // primary queue (first by stage order)
  queues: { queue: string; stage: string | null; order: number | null }[];
  tags: string[];
  Icon: ComponentType<{ size?: number }>;
  smvMinutes: number; // standard minutes value displaced per completed item
  grade: string; // grade code of the colleague whose work is displaced
  gradeName: string;
  colleagueHourly: number; // that grade's CURRENT rate (display; history is in the rows)
}

export interface VdiDim {
  id: string; // ResourceName
  name: string;
  bot: string;
  spoke: string; // owning spoke ("Hub" for shared/test machines)
  spokeId: number | null; // owning spoke's numeric id, null = hub-owned (see economics.ts's spoke-scoped VDI class-rate resolution)
  pool: string; // presentation label
  costClass: string;
  activeFrom: string;
  activeTo: string | null;
  notes: string | null;
  // --- VDI renewal / coverage-window fields (see src/reference/economics.ts) ---
  renewalDate: string;
  annualCostGBP: number | null;
  licenseExpiryDate: string | null;
  status: "active" | "retired";
}

export interface ExceptionTypeDim {
  name: string; // display reason (source prefix stripped)
  category: OutcomeKey; // "system" | "business"
}

// --- fact rows ------------------------------------------------------------------
export interface DayRow {
  date: string;
  ts: number;
  processId: string;
  completed: number;
  business: number;
  system: number;
  pending: number;
  worktimeSec: number; // total bot seconds (all outcomes)
  completedWorktimeSec: number;
  benefitGBP: number; // grade-rate-correct gross benefit (completed items)
  estateCostGBP: number; // hub + spoke apportioned estate cost, time-correct
}

export interface ExcRow {
  date: string;
  ts: number;
  processId: string;
  reason: string;
  category: "system" | "business";
  count: number;
  worktimeSec: number;
}

export interface ResRow {
  date: string;
  ts: number;
  resource: string;
  processId: string;
  items: number;
  exceptions: number;
  worktimeSec: number;
  estateCostGBP: number;
}

// --- live bindings (populated by initData before first render) -------------------
export let META: ModelJson["meta"] = { generatedAt: "", source: "", sourceRows: 0, dateMin: "", dateMax: "", unmappedQueues: [] };
export let TARGETS: ModelJson["targets"] = { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6 };
export let SPOKES: string[] = [];
// per-spoke identity: short code + accent colour per surface (hub-validated set —
// see reference.json; re-validate with the dataviz six-checks if changed)
export let SPOKE_INFO: Record<string, { short: string; light: string; dark: string }> = {};
export let PROCESSES: ProcessDim[] = [];
export let PROCESS_BY_ID = new Map<string, ProcessDim>();
export let PROPOSITIONS: string[] = [];
export let QUEUES: string[] = [];
export let TAGS: string[] = [];
export let VDIS: VdiDim[] = [];
export let VDI_OPERATING_HOURS = 20;
export let SYSTEM_EXCEPTIONS: string[] = [];
export let BUSINESS_EXCEPTIONS: string[] = [];
export let EXCEPTION_TYPES: ExceptionTypeDim[] = [];
export let EX_CODE: Record<string, string> = {};
export let ROWS: DayRow[] = [];
export let EXC_ROWS: ExcRow[] = [];
export let RES_ROWS: ResRow[] = [];
export let DAY_WORKTIME_TOTALS: Map<string, number> | undefined = undefined;
export let SPOKE_DAY_WORKTIME_TOTALS: Map<string, number> | undefined = undefined;
// Per-VDI activity discovery (D6), keyed by ResourceName — undefined for an
// older model.json that predates this field (see ModelJson.resourceActivity
// above). Consumed by src/alerts/engine.ts's stale-VDI check.
export let RESOURCE_ACTIVITY: Map<string, { firstSeen: string; lastSeen: string; items: number; spokesServed: string[] }> | undefined = undefined;
export let DATE_MIN = 0;
export let DATE_MAX = 0;
export let DATA_MIN_ISO = "";
export let DATA_MAX_ISO = "";
// per outcome-date working assumptions (from the estate cost history in force)
export let ESTATE_RATE = new Map<string, { costPerDay: number; workingDays: number; prodHours: number }>();
// Base reference object for the editable reference-data store (src/reference/) —
// null until initData() runs; reference-context.tsx has a fetch fallback for
// the (normally unreached) case where it's still null when the provider mounts.
export let REFERENCE_BASE: ReferenceJson | null = null;

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  form: IconForm,
  letter: IconLetter,
  payment: IconPayment,
  shield: IconShield,
  globe: IconGlobe,
  route: IconRoute,
  inbox: IconInbox,
  card: IconCard,
  refresh: IconRefresh,
  graph: IconGraph,
};

const tsOf = (iso: string) => Date.parse(iso + "T00:00:00Z");

export function initData(m: ModelJson) {
  META = m.meta;
  TARGETS = m.targets;
  VDI_OPERATING_HOURS = m.vdiOperatingHoursPerDay;
  SPOKES = m.spokes.map((s) => s.name);
  SPOKE_INFO = Object.fromEntries(m.spokes.map((s) => [s.name, { short: s.short, light: s.colorLight, dark: s.colorDark }]));

  PROCESSES = m.processes.map((p) => {
    const queues = [...p.queues].sort((a, b) => (a.order ?? 1) - (b.order ?? 1));
    return {
      id: String(p.id),
      name: p.name,
      acronym: p.acronym,
      description: p.description,
      proposition: p.proposition,
      spoke: p.spoke,
      queue: queues[0]?.queue ?? "",
      queues,
      tags: p.tags,
      Icon: ICONS[p.icon] ?? IconForm,
      smvMinutes: p.smvMinutes,
      grade: p.grade,
      gradeName: p.gradeName,
      colleagueHourly: p.currentHourly,
    };
  });
  PROCESS_BY_ID = new Map(PROCESSES.map((p) => [p.id, p]));
  PROPOSITIONS = m.propositions.map((p) => p.name);
  QUEUES = PROCESSES.flatMap((p) => p.queues.map((q) => q.queue));
  TAGS = Array.from(new Set(PROCESSES.flatMap((p) => p.tags))).sort();

  VDIS = m.resources.map((r) => ({
    id: r.name,
    name: r.name,
    bot: r.bot,
    spoke: r.spoke,
    spokeId: r.spokeId ?? null,
    pool: r.class === "prod" ? r.spoke : `${r.spoke} · test`,
    costClass: r.class,
    activeFrom: r.activeFrom,
    activeTo: r.activeTo,
    notes: r.notes,
    renewalDate: r.renewalDate,
    annualCostGBP: r.annualCostGBP,
    licenseExpiryDate: r.licenseExpiryDate,
    status: r.status,
  }));

  SYSTEM_EXCEPTIONS = m.exceptionReasons.filter((e) => e.type === "System").map((e) => e.reason);
  BUSINESS_EXCEPTIONS = m.exceptionReasons.filter((e) => e.type === "Business").map((e) => e.reason);
  EXCEPTION_TYPES = m.exceptionReasons.map((e) => ({ name: e.reason, category: e.type === "System" ? ("system" as const) : ("business" as const) }));
  EX_CODE = Object.fromEntries(m.exceptionReasons.map((e) => [e.reason, e.code]));

  ROWS = m.dayRows.map((r) => ({
    date: r.d, ts: tsOf(r.d), processId: String(r.p),
    completed: r.c, business: r.b, system: r.s, pending: r.n,
    worktimeSec: r.w, completedWorktimeSec: r.cw,
    benefitGBP: r.gb, estateCostGBP: r.ec,
  }));
  EXC_ROWS = m.excRows.map((r) => ({
    date: r.d, ts: tsOf(r.d), processId: String(r.p),
    reason: r.r, category: r.t === "System" ? ("system" as const) : ("business" as const),
    count: r.n, worktimeSec: r.w,
  }));
  RES_ROWS = m.resRows.map((r) => ({
    date: r.d, ts: tsOf(r.d), resource: r.r, processId: String(r.p),
    items: r.n, exceptions: r.e, worktimeSec: r.w, estateCostGBP: r.ec,
  }));
  DAY_WORKTIME_TOTALS = m.dayWorktimeTotals ? new Map(Object.entries(m.dayWorktimeTotals)) : undefined;
  SPOKE_DAY_WORKTIME_TOTALS = m.spokeDayWorktimeTotals ? new Map(Object.entries(m.spokeDayWorktimeTotals)) : undefined;
  RESOURCE_ACTIVITY = m.resourceActivity ? new Map(Object.entries(m.resourceActivity)) : undefined;

  DATE_MIN = tsOf(m.meta.dateMin);
  DATE_MAX = tsOf(m.meta.dateMax);
  DATA_MIN_ISO = m.meta.dateMin;
  DATA_MAX_ISO = m.meta.dateMax;

  ESTATE_RATE = new Map(m.estateRateByDate.map((r) => [r.d, { costPerDay: r.cost, workingDays: r.wd, prodHours: r.ph }]));

  REFERENCE_BASE = m.reference;
}

export const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
export const fmtDateFull = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const monthKey = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
