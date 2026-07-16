// ---------------------------------------------------------------------------
// reference-store.ts
// ---------------------------------------------------------------------------
// Pure (no React) data-shape + persistence layer for the editable reference
// data store. This is the canonical TS type for data/reference/reference.json
// (mirrored into model.json's `reference` field by tools/build-dashboard-data.mjs
// and consumed by reference-context.tsx). Import ReferenceJson from here
// wherever the reference shape is needed.
// ---------------------------------------------------------------------------

export interface SpokeRef {
  spokeId: number;
  spokeName: string;
  shortName: string;
  colorLight: string;
  colorDark: string;
}

export interface GradeRateRef {
  grade: string;
  gradeName: string;
  effectiveFrom: string;
  hourlyCostGBP: number;
}

export interface PropositionRef {
  propositionId: number;
  propositionName: string;
  spokeId: number;
}

export interface ProcessRef {
  processId: number;
  processName: string;
  processAcronym: string;
  processDescription: string;
  propositionId: number;
  smvMinutes: number;
  grade: string;
  isActive: boolean;
  icon: string;
  tags: string[];
}

export interface QueueMapRef {
  queueName: string;
  processId: number;
  stageName: string | null;
  stageOrder: number | null;
}

// costClass is free-form in the data ("prod" | "test" today) — kept as string
// so extra classes don't require a type change here.
//
// isActive vs status: INTENTIONALLY independent concepts, not kept in sync.
// `isActive` is the SQL-twin lifecycle flag (mirrors core.RefResource.IsActive,
// drives the SQL exporter only). `status` ("active"|"retired") is the D3
// license/coverage concept that drives vdiDailyCost/vdiAvailableOn — only it
// gates whether a VDI's cost/capacity counts on a given day. A resource could
// in principle be isActive=false for reporting purposes while its coverage
// window math is still driven solely by status; don't assume one implies the
// other.
export interface ResourceRef {
  resourceName: string;
  botName: string;
  botAcronym: string;
  vdiName: string;
  costClass: string;
  spokeId: number | null; // null = hub-owned
  activeFrom: string;
  activeTo: string | null;
  notes: string | null;
  isActive: boolean;
  // --- VDI renewal / coverage-window fields (see economics.ts) ---
  renewalDate: string; // ISO date; annual renewal cycles tile every 365 days from this anchor
  annualCostGBP: number | null; // overrides the costClass rate when set
  licenseExpiryDate: string | null; // last day of licensed cover, if any
  status: "active" | "retired";
}

export interface VdiCostHistoryRef {
  costClass: string;
  effectiveFrom: string;
  annualCostPerVDIGBP: number;
}

// teamAnnualCostGBP is retained for schema parity with bp-sql-layer's
// core.RefEstateCostHistory but is NOT read for cost calculation — the hub's
// people-cost run-rate comes exclusively from peopleCostHistory (ownerId='HUB');
// estateCostHistory now only supplies workingDaysPerYear/productiveHoursPerDay/
// effectiveFrom/note.
export interface EstateCostHistoryRef {
  effectiveFrom: string;
  teamAnnualCostGBP: number;
  workingDaysPerYear: number;
  productiveHoursPerDay: number;
  note?: string;
}

// ownerId = "HUB" (the sole source of truth for the hub's people run-rate used
// in cost calculation) or a spokeId as a STRING (informational only — spoke
// people cost is never charged into the estate economics, only spoke infra is).
export interface PeopleCostHistoryRef {
  ownerId: string;
  headcount: number;
  annualCostGBP: number;
  effectiveFrom: string;
  note?: string;
}

export interface ExceptionPatternRef {
  matchPattern: string;
  exceptionType: "System" | "Business";
  priority: number;
}

export interface TargetsRef {
  completionPct: number;
  exceptionRate: number;
  systemRate: number;
  costPerCase: number;
  utilMin: number;
  utilMax: number;
}

// Per-spoke or per-process override of one global target metric. Resolution
// precedence (see resolveThreshold below): a matching PROCESS override wins
// over a matching SPOKE override (of the process's own spoke, resolved via
// propositions) which wins over the global TargetsRef value. Optional field —
// see the SCHEMA_VERSION comment below for why adding it does not require a
// version bump.
export interface ThresholdOverrideRef {
  scope: "spoke" | "process";
  /** spokeName (scope="spoke") or processId as a STRING (scope="process") — processId
   *  is a string here to match DayRow.processId/ProcessDim.id elsewhere in the app,
   *  even though ProcessRef.processId (above) is typed as number. */
  scopeId: string;
  metric: keyof TargetsRef;
  value: number;
}

export interface ReferenceJson {
  _comment?: string[];
  spokes: SpokeRef[];
  gradeRates: GradeRateRef[];
  propositions: PropositionRef[];
  processes: ProcessRef[];
  queueMap: QueueMapRef[];
  resources: ResourceRef[];
  vdiOperatingHoursPerDay: number;
  vdiCostHistory: VdiCostHistoryRef[];
  estateCostHistory: EstateCostHistoryRef[];
  peopleCostHistory: PeopleCostHistoryRef[];
  exceptionPatterns: ExceptionPatternRef[];
  exceptionDisplayCodes: Record<string, string>;
  targets: TargetsRef;
  thresholdOverrides?: ThresholdOverrideRef[];
}

// --- localStorage overlay -----------------------------------------------------

// Deliberately NOT namespaced per-user (unlike other localStorage keys
// elsewhere in the app). Reference data is organisational truth shared by
// everyone using this device/browser, not a personal preference — a
// per-user key would let different users on the same machine see divergent
// numbers (fork the data), which is exactly wrong for a shared cost/rate
// model. The real production fix is a server-side reference API (not
// localStorage at all) — see the in-app Playbook for that plan.
export const BP_REFERENCE_STORAGE_KEY = "bp-reference-v1";

// Schema version of the ReferenceJson shape itself (NOT an edit counter —
// that's OverlaySnapshot.version below). Bump this whenever ReferenceJson's
// shape changes (new required fields, renamed fields, etc.) so stale
// localStorage overlays written under an older shape are safely dropped
// instead of blowing up downstream (e.g. `.filter` on a missing
// peopleCostHistory, or vdiDailyCost reading an undefined renewalDate).
// Bumped to 2 for the peopleCostHistory + VDI renewal/coverage-window fields.
//
// thresholdOverrides (ThresholdOverrideRef[], above) is an additive OPTIONAL
// field, so SCHEMA_VERSION is deliberately NOT bumped for it: loadOverlay()
// below only rejects an overlay on a schemaVersion MISMATCH, not on
// structural/shape validation, so a stale overlay written before this field
// existed is still a fully valid ReferenceJson — thresholdOverrides is simply
// absent from it. Every consumer of thresholdOverrides MUST treat
// `reference.thresholdOverrides` as possibly undefined (default to `[]`)
// rather than assuming presence. Bumping SCHEMA_VERSION here would needlessly
// wipe every user's existing local reference edits on their next load, which
// is exactly what SCHEMA_VERSION bumps are supposed to avoid doing
// unnecessarily.
export const SCHEMA_VERSION = 2;

export interface ChangelogEntry {
  ts: string; // ISO timestamp
  section: string; // free-form label of what changed (e.g. "resources", "gradeRates")
  actor?: string;
}

// changelog is capped at 50 entries, NEWEST LAST (i.e. push new entries onto
// the end, drop from the front once over the cap) — matches the natural
// chronological reading order of an array rendered top-to-bottom in a log view.
const CHANGELOG_CAP = 50;

export function appendChangelog(changelog: ChangelogEntry[], entry: ChangelogEntry): ChangelogEntry[] {
  const next = [...changelog, entry];
  return next.length > CHANGELOG_CAP ? next.slice(next.length - CHANGELOG_CAP) : next;
}

export interface OverlaySnapshot {
  version: number; // edit counter (bumped on every update()), NOT the schema version
  schemaVersion: number; // ReferenceJson shape version this overlay was written under — see SCHEMA_VERSION
  editedBy?: string;
  editedAt: string; // ISO timestamp
  reference: ReferenceJson;
  changelog: ChangelogEntry[];
}

/**
 * Reads + parses the overlay from localStorage. Swallows any parse error and
 * returns null. Also rejects (returns null) any overlay whose schemaVersion
 * doesn't match the current SCHEMA_VERSION — no migration is attempted, a
 * stale-shape overlay is simply dropped so the app falls back to the base
 * reference cleanly instead of failing downstream (e.g. peopleCostOn/
 * vdiDailyCost reading fields that don't exist on an old overlay). Logs a
 * console.warn so this is debuggable rather than silent.
 */
export function loadOverlay(): OverlaySnapshot | null {
  try {
    const raw = localStorage.getItem(BP_REFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.reference) return null;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      console.warn(
        `reference-store: dropping stale localStorage overlay (schemaVersion ${parsed.schemaVersion ?? "unset"}, expected ${SCHEMA_VERSION}) — falling back to base reference.`,
      );
      return null;
    }
    return parsed as OverlaySnapshot;
  } catch {
    return null;
  }
}

export function saveOverlay(snapshot: OverlaySnapshot): boolean {
  try {
    localStorage.setItem(BP_REFERENCE_STORAGE_KEY, JSON.stringify({ ...snapshot, schemaVersion: SCHEMA_VERSION }));
    return true;
  } catch {
    return false;
  }
}

export function clearOverlay(): void {
  localStorage.removeItem(BP_REFERENCE_STORAGE_KEY);
}

/**
 * Overlay wins WHOLESALE if present (a full replacement of the base reference,
 * not a deep field-by-field merge) — editing reference data always operates on
 * a complete snapshot, so there's nothing to reconcile.
 */
export function mergeReference(base: ReferenceJson, overlay: ReferenceJson | null): ReferenceJson {
  return overlay ?? base;
}

// --- threshold overrides --------------------------------------------------------

/** Resolves a process id (string, matching DayRow.processId/ProcessDim.id) to its
 *  owning spoke NAME via reference.processes -> propositions -> spokes, or undefined
 *  if any link is missing. Deliberately reference-driven (not rpaData-driven) so it
 *  stays correct even for reference edits made after the data build. */
export function spokeOfProcess(reference: ReferenceJson, processId: string): string | undefined {
  const proc = reference.processes.find((p) => String(p.processId) === processId);
  if (!proc) return undefined;
  const prop = reference.propositions.find((pr) => pr.propositionId === proc.propositionId);
  if (!prop) return undefined;
  return reference.spokes.find((s) => s.spokeId === prop.spokeId)?.spokeName;
}

/**
 * Resolves the effective threshold value for `metric` at a given scope, applying
 * the precedence: an override matching exactly this scope+scopeId+metric wins;
 * else (for scope="process" only) an override matching the process's own spoke
 * wins; else the global `reference.targets[metric]`.
 */
export function resolveThreshold(
  reference: ReferenceJson,
  metric: keyof TargetsRef,
  scope: "spoke" | "process",
  scopeId: string,
): number {
  const overrides = reference.thresholdOverrides ?? [];
  if (scope === "process") {
    const direct = overrides.find((o) => o.scope === "process" && o.scopeId === scopeId && o.metric === metric);
    if (direct) return direct.value;
    const spoke = spokeOfProcess(reference, scopeId);
    if (spoke) {
      const viaSpoke = overrides.find((o) => o.scope === "spoke" && o.scopeId === spoke && o.metric === metric);
      if (viaSpoke) return viaSpoke.value;
    }
    return reference.targets[metric];
  }
  const direct = overrides.find((o) => o.scope === "spoke" && o.scopeId === scopeId && o.metric === metric);
  return direct ? direct.value : reference.targets[metric];
}

// --- export -------------------------------------------------------------------

export function exportReferenceJson(reference: ReferenceJson): string {
  return JSON.stringify(reference, null, 2);
}

const sqlStr = (s: string | null | undefined): string => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sqlNum = (n: number | null | undefined): string => (n == null ? "NULL" : String(n));
const sqlBit = (b: boolean): string => (b ? "1" : "0");

function deleteStatement(table: string): string {
  return `DELETE FROM core.${table};`;
}

function insertStatement(table: string, columns: string[], rows: string[][]): string {
  if (!rows.length) return `-- ${table}: no rows to insert`;
  const values = rows.map((r) => `    (${r.join(", ")})`).join(",\n");
  return `INSERT INTO core.${table} (${columns.join(", ")}) VALUES\n${values};`;
}

/**
 * A single TSQL script that DELETEs from every Ref* table FIRST (in
 * child-first FK order) and only then INSERTs into every Ref* table (in
 * parent-first order), matching bp-sql-layer/scripts/07_seed_reference.sql's
 * proven ordering — grouping all deletes ahead of all inserts (rather than
 * DELETE-then-INSERT per table) avoids violating FK constraints when this
 * script is re-run against an already-seeded database. Column naming/casing
 * matches 07_seed_reference.sql exactly. core.RefPeopleCostHistory and
 * RefResource's RenewalDate/AnnualCostGBP/LicenseExpiryDate/Status columns
 * are defined in bp-sql-layer/scripts/03_core_dimensions.sql and seeded in
 * 07_seed_reference.sql — keep this function's column lists in step with
 * those if either side changes.
 */
export function exportReferenceSql(reference: ReferenceJson): string {
  const parts: string[] = [
    "/* Generated by the dashboard's reference-data editor.\n" +
      "   Ordering guarantee: ALL deletes run first, in child-first FK order\n" +
      "   (RefQueueMap -> RefProcess -> RefProposition -> RefResource -> RefSpoke,\n" +
      "   then the FK-independent tables); ALL inserts run after, in parent-first\n" +
      "   order — matching bp-sql-layer/scripts/07_seed_reference.sql's proven\n" +
      "   pattern. Safe to re-run against an already-seeded database. */",
    "USE BPAnalytics;",
    "GO",
    "",
    // --- Deletes: child-first FK order ---
    deleteStatement("RefQueueMap"),
    deleteStatement("RefProcess"),
    deleteStatement("RefProposition"),
    deleteStatement("RefResource"),
    deleteStatement("RefSpoke"),
    // FK-independent tables — order irrelevant relative to each other/above
    deleteStatement("RefGradeRate"),
    deleteStatement("RefVDICostHistory"),
    deleteStatement("RefEstateCostHistory"),
    deleteStatement("RefPeopleCostHistory"),
    deleteStatement("RefExceptionType"),
    "GO",
    "",
    // --- Inserts: parent-first order ---
    insertStatement(
      "RefSpoke",
      ["SpokeId", "SpokeName", "ShortName", "ColorHexLight", "ColorHexDark"],
      reference.spokes.map((s) => [sqlNum(s.spokeId), sqlStr(s.spokeName), sqlStr(s.shortName), sqlStr(s.colorLight), sqlStr(s.colorDark)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefGradeRate",
      ["GradeCode", "GradeName", "EffectiveFrom", "HourlyCostGBP"],
      reference.gradeRates.map((g) => [sqlStr(g.grade), sqlStr(g.gradeName), sqlStr(g.effectiveFrom), sqlNum(g.hourlyCostGBP)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefProposition",
      ["PropositionId", "PropositionName", "SpokeId"],
      reference.propositions.map((p) => [sqlNum(p.propositionId), sqlStr(p.propositionName), sqlNum(p.spokeId)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefProcess",
      ["ProcessId", "ProcessName", "ProcessAcronym", "ProcessDescription", "PropositionId", "SMVMinutes", "GradeCode", "IsActive"],
      reference.processes.map((p) => [
        sqlNum(p.processId),
        sqlStr(p.processName),
        sqlStr(p.processAcronym),
        sqlStr(p.processDescription),
        sqlNum(p.propositionId),
        sqlNum(p.smvMinutes),
        sqlStr(p.grade),
        sqlBit(p.isActive),
      ]),
    ),
    "GO",
    "",
    insertStatement(
      "RefQueueMap",
      ["QueueName", "ProcessId", "StageName", "StageOrder"],
      reference.queueMap.map((q) => [sqlStr(q.queueName), sqlNum(q.processId), sqlStr(q.stageName), sqlNum(q.stageOrder)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefResource",
      [
        "ResourceName", "BotName", "BotAcronym", "VDIName", "CostClass", "SpokeId",
        "ActiveFrom", "ActiveTo", "Notes", "IsActive",
        "RenewalDate", "AnnualCostGBP", "LicenseExpiryDate", "Status",
      ],
      reference.resources.map((r) => [
        sqlStr(r.resourceName), sqlStr(r.botName), sqlStr(r.botAcronym), sqlStr(r.vdiName), sqlStr(r.costClass), sqlNum(r.spokeId),
        sqlStr(r.activeFrom), sqlStr(r.activeTo), sqlStr(r.notes), sqlBit(r.isActive),
        sqlStr(r.renewalDate), sqlNum(r.annualCostGBP), sqlStr(r.licenseExpiryDate), sqlStr(r.status),
      ]),
    ),
    "GO",
    "",
    insertStatement(
      "RefVDICostHistory",
      ["CostClass", "EffectiveFrom", "AnnualCostPerVDIGBP"],
      reference.vdiCostHistory.map((v) => [sqlStr(v.costClass), sqlStr(v.effectiveFrom), sqlNum(v.annualCostPerVDIGBP)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefEstateCostHistory",
      ["EffectiveFrom", "TeamAnnualCostGBP", "WorkingDaysPerYear", "ProductiveHoursPerDay", "Note"],
      reference.estateCostHistory.map((e) => [sqlStr(e.effectiveFrom), sqlNum(e.teamAnnualCostGBP), sqlNum(e.workingDaysPerYear), sqlNum(e.productiveHoursPerDay), sqlStr(e.note)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefPeopleCostHistory",
      ["OwnerId", "Headcount", "AnnualCostGBP", "EffectiveFrom", "Note"],
      reference.peopleCostHistory.map((p) => [sqlStr(p.ownerId), sqlNum(p.headcount), sqlNum(p.annualCostGBP), sqlStr(p.effectiveFrom), sqlStr(p.note)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefExceptionType",
      ["MatchPattern", "ExceptionType", "Priority"],
      reference.exceptionPatterns.map((e) => [sqlStr(e.matchPattern), sqlStr(e.exceptionType), sqlNum(e.priority)]),
    ),
    "GO",
    "",
  ];
  return parts.join("\n");
}
