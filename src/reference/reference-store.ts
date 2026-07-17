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
  // Scopes THIS RATE ROW to one spoke — absent/undefined = universal (applies
  // to every spoke automating against this grade). Stored as a spokeId AS A
  // STRING, same convention as PeopleCostHistoryRef.ownerId (below) so the two
  // "spoke identity as a string" fields in this file read the same way.
  // RESOLUTION (see gradeRateOn in economics.ts / gradeRate in
  // build-dashboard-data.mjs / 08_report_views.sql — all three MUST stay in
  // step): for (grade, processSpoke, day), take the row with the latest
  // effectiveFrom <= day among rows whose spokeId matches processSpoke; if
  // none, fall back to the latest effectiveFrom <= day among rows with no
  // spokeId (universal). A spoke-scoped row always wins over a universal row
  // when both are in force, regardless of which has the later effectiveFrom.
  spokeId?: string;
}

// A grade CODE's identity + which spokes may select it at all (scope, not
// rate). spokeIds is a list of spokeId-AS-STRING values (see GradeRateRef.spokeId
// above); an EMPTY array means universal — every spoke may use this grade.
// This is deliberately a SEPARATE scoping axis from GradeRateRef.spokeId:
// `grades[]` says who may automate against a grade at all (e.g. an admin
// picker for a process's grade field should only offer grades whose spokeIds
// is [] or includes that process's own spoke); GradeRateRef.spokeId says
// whether one specific dated RATE ROW for that grade is a universal figure or
// a spoke-specific override. gradeName is the canonical source of a grade's
// display name going forward; GradeRateRef.gradeName is retained on every
// rate row for BACK-COMPAT READS (older code / a stale rate row read in
// isolation still has a usable name) and is kept mirrored to the matching
// grades[] entry — see gradeNameOf() below for the resolution order.
export interface GradeRef {
  grade: string;
  gradeName: string;
  spokeIds: string[];
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
  // Scopes THIS CLASS-RATE ROW to one spoke — absent/undefined = universal.
  // Same spokeId-as-string convention and resolution order as
  // GradeRateRef.spokeId above: for (costClass, vdiSpoke, day), the row with
  // the latest effectiveFrom <= day among vdiSpoke-matching rows wins; else
  // the latest effectiveFrom <= day among spokeId-absent (universal) rows.
  // Resolved inside vdiDailyCost/report.fn_VdiDailyCost at the VDI's own
  // coverage-cycle-start date, exactly like the unscoped case.
  spokeId?: string;
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

// ownerId = "HUB" (the sole source of truth for the HUB's people run-rate
// used in cost calculation) or a spokeId as a STRING. AS OF D5 (spoke people
// cost), a spoke's own OwnerId=<spokeId> record IS charged into estate
// economics: it feeds that spoke's pool/day (spoke VDI infra + this record's
// AnnualCostGBP-in-force/365.25), apportioned within the spoke by worktime
// exactly like infra — see buildRateTables in economics.ts. It is NOT
// informational-only any more; do not describe it that way in UI copy.
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
  // VDI ACTIVITY MONITORING (D6 — not a rate/£ target like the six above, but
  // deliberately kept in `targets` rather than a separate top-level object:
  // it's app-side config that resolves through the same resolveThreshold()
  // helper as every other TargetsRef field). Like utilMin/utilMax, this
  // metric only supports SPOKE-scoped overrides — resolveThreshold(reference,
  // "vdiStaleDays", "spoke", spokeName) — consumed by src/alerts/engine.ts's
  // staleVdi evaluation and VdiSection.tsx's review queue. It does NOT
  // support PROCESS-scoped overrides: VDIs aren't process-owned the way rate
  // metrics are, so a process-scoped vdiStaleDays row would have nothing to
  // attach to and is never evaluated (ThresholdsSection.tsx's process-scope
  // metric picker excludes it for the same reason it excludes utilMin/
  // utilMax; any pre-existing process-scoped row is flagged "not evaluated"
  // in that section's override list rather than silently ignored). A VDI
  // whose activity (rpaData.ts's RESOURCE_ACTIVITY) has gone quiet for MORE
  // than the resolved threshold's days (and whose status isn't "retired")
  // gets a "staleVdi" alert. Default 14 if a reference.json predates this
  // field (tools/build-dashboard-data.mjs applies the same default when
  // emitting model.json's targets, so the two stay in step).
  vdiStaleDays: number;
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
  // Grade identity + scope (which spokes may select each grade at all). See
  // GradeRef's comment above for how this differs from GradeRateRef.spokeId.
  // Required as of SCHEMA_VERSION 3 (see the bump comment below) — a stale
  // pre-scoped-grades overlay is dropped by loadOverlay() rather than read
  // with this field missing. gradeNameOf() below still defends defensively
  // (`reference.grades ?? []`) against the base reference.json itself ever
  // being incomplete mid-edit, but callers should not need to.
  grades: GradeRef[];
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
// Bumped to 3 for scoped grades + VDI class-rate spoke overrides: `grades`
// is a new REQUIRED field (a stale overlay that predates it has no grades[]
// at all — not an optional-field gap like thresholdOverrides above, so it
// can't be safely defaulted the same way; every consumer of resolveGradeRate/
// gradeNameOf assumes `reference.grades` exists) and both GradeRateRef and
// VdiCostHistoryRef gained an optional `spokeId` (additive on existing rows,
// but the resolution CODE now expects to be able to read it, so a rate
// engine built against the pre-bump shape would silently resolve every rate
// as universal even where a spoke override was intended — worth invalidating
// stale overlays for). Bumping bumps by DROPPING old overlays cleanly (see
// loadOverlay()), never by attempting a migration.
export const SCHEMA_VERSION = 3;

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

// --- scoped grades / VDI class-rate spoke overrides ---------------------------

/** A spoke NAME resolved to its spokeId-AS-A-STRING, matching the convention
 *  GradeRateRef.spokeId / VdiCostHistoryRef.spokeId / PeopleCostHistoryRef.ownerId
 *  all use. undefined in, undefined out (no spoke to resolve against, e.g. a
 *  hub-owned VDI or an estate-scope caller). */
export function spokeIdStringOf(reference: ReferenceJson, spokeName: string | undefined | null): string | undefined {
  if (spokeName == null) return undefined;
  const s = reference.spokes.find((sp) => sp.spokeName === spokeName);
  return s ? String(s.spokeId) : undefined;
}

/**
 * Canonical grade display name: reads `reference.grades` first (the source
 * of truth as of SCHEMA_VERSION 3), falling back to the first matching
 * `gradeRates` row's own `gradeName` for BACK-COMPAT (a reference object
 * built before this file existed, or a defensive read if `grades` is
 * unexpectedly empty), and finally to the grade code itself so this never
 * returns undefined/empty.
 */
export function gradeNameOf(reference: ReferenceJson, grade: string): string {
  return (
    (reference.grades ?? []).find((g) => g.grade === grade)?.gradeName ??
    reference.gradeRates.find((g) => g.grade === grade)?.gradeName ??
    grade
  );
}

/**
 * Grades a given spoke NAME may be assigned to a process (see GradeRef's
 * comment on reference-store.ts's GradeRef for why this is a separate axis
 * from GradeRateRef.spokeId's rate-override scoping): a grade with an empty
 * spokeIds is universal (every spoke may use it); otherwise the spoke's own
 * spokeId-as-string must appear in it. Falls back to "every known grade code
 * is universal" when `reference.grades` is empty/absent (defensive; see
 * gradeNameOf above) so this never returns an empty list purely because the
 * scope dimension hasn't been populated.
 */
export function gradesInScopeForSpoke(reference: ReferenceJson, spokeName: string | undefined | null): GradeRef[] {
  const sid = spokeIdStringOf(reference, spokeName);
  const known = reference.grades ?? [];
  if (known.length === 0) {
    // no grades[] dimension at all — derive a fully-universal list from
    // gradeRates so callers still get every grade code that's actually used.
    const codes = new Map<string, string>();
    for (const g of reference.gradeRates) if (!codes.has(g.grade)) codes.set(g.grade, g.gradeName);
    return [...codes.entries()].map(([grade, gradeName]) => ({ grade, gradeName, spokeIds: [] }));
  }
  return known.filter((g) => g.spokeIds.length === 0 || (sid != null && g.spokeIds.includes(sid)));
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
 * RefResource's RenewalDate/AnnualCostGBP/LicenseExpiryDate/Status columns,
 * plus core.RefGrade/core.RefGradeSpoke (scoped-grade dimension + junction)
 * and RefGradeRate/RefVDICostHistory's SpokeId columns (scoped rate rows),
 * are defined in bp-sql-layer/scripts/03_core_dimensions.sql and seeded in
 * 07_seed_reference.sql — keep this function's column lists in step with
 * those if either side changes.
 */
export function exportReferenceSql(reference: ReferenceJson): string {
  const parts: string[] = [
    "/* Generated by the dashboard's reference-data editor.\n" +
      "   Ordering guarantee: ALL deletes run first, in child-first FK order\n" +
      "   (RefQueueMap -> RefProcess -> RefProposition -> RefResource ->\n" +
      "   RefGradeSpoke -> RefSpoke -> RefGrade, then the FK-independent tables);\n" +
      "   ALL inserts run after, in parent-first order — matching\n" +
      "   bp-sql-layer/scripts/07_seed_reference.sql's proven pattern. RefGradeSpoke\n" +
      "   deletes before BOTH RefSpoke and RefGrade (it FKs to both); RefGradeSpoke\n" +
      "   inserts after BOTH (see 03_core_dimensions.sql's constraints). Safe to\n" +
      "   re-run against an already-seeded database. */",
    "USE BPAnalytics;",
    "GO",
    "",
    // --- Deletes: child-first FK order ---
    deleteStatement("RefQueueMap"),
    deleteStatement("RefProcess"),
    deleteStatement("RefProposition"),
    deleteStatement("RefResource"),
    deleteStatement("RefGradeSpoke"), // FKs to RefSpoke + RefGrade — must delete before both
    deleteStatement("RefSpoke"),
    deleteStatement("RefGrade"),
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
      "RefGrade",
      ["GradeCode", "GradeName"],
      (reference.grades ?? []).map((g) => [sqlStr(g.grade), sqlStr(g.gradeName)]),
    ),
    "GO",
    "",
    insertStatement(
      "RefGradeSpoke",
      ["GradeCode", "SpokeId"],
      (reference.grades ?? []).flatMap((g) => g.spokeIds.map((sid) => [sqlStr(g.grade), sqlNum(Number(sid))])),
    ),
    "GO",
    "",
    insertStatement(
      "RefGradeRate",
      ["GradeCode", "GradeName", "EffectiveFrom", "HourlyCostGBP", "SpokeId"],
      reference.gradeRates.map((g) => [sqlStr(g.grade), sqlStr(g.gradeName), sqlStr(g.effectiveFrom), sqlNum(g.hourlyCostGBP), sqlStr(g.spokeId)]),
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
      ["CostClass", "EffectiveFrom", "AnnualCostPerVDIGBP", "SpokeId"],
      reference.vdiCostHistory.map((v) => [sqlStr(v.costClass), sqlStr(v.effectiveFrom), sqlNum(v.annualCostPerVDIGBP), sqlStr(v.spokeId)]),
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
