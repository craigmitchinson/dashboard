// ---------------------------------------------------------------------------
// sql-reference.ts — real-mode ReferenceStore: reconstructs the full
// ReferenceJson from core.Ref* + core.RefAppSettings, and writes it back
// transactionally in the SAME FK-safe order as
// src/reference/reference-store.ts's exportReferenceSql (see table-order.ts).
//
// core.RefProcess.Icon/Tags (03_core_dimensions.sql) are first-class
// columns: Icon is a plain string, Tags is a ';'-delimited list persisted
// as a single NVARCHAR column (split/joined here on read/write). These were
// FORMERLY a stopgap FIFTH core.RefAppSettings JSON document
// ('processExtras') — that code path, and the document itself on an
// already-deployed database, is retired by the guarded migration in
// 13_api_model_views.sql. See server/test/sql-reference.test.ts's
// "spa-exporter-columns-in-sync" test for the matching SPA-side change
// still required in src/reference/reference-store.ts's exportReferenceSql.
// ---------------------------------------------------------------------------
import sql from "mssql";
import type { Db } from "../db.js";
import { DELETE_ORDER, INSERT_ORDER } from "./table-order.js";
import type { PutReferenceInput, ReferenceSnapshot, ReferenceStore } from "./reference-store.js";
import { VersionConflictError } from "./reference-store.js";
import { validateReference } from "../validate/reference-schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ref = Record<string, any>;

function dateOnly(v: unknown): string {
  if (v == null) return v as unknown as string;
  if (typeof v === "string") return v.slice(0, 10);
  return new Date(v as string | number | Date).toISOString().slice(0, 10);
}

async function getAppSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const req = db.request();
  req.input("key", sql.NVarChar(64), key);
  const result = await req.query("SELECT ValueJson FROM core.RefAppSettings WHERE SettingKey = @key");
  const row = result.recordset[0];
  if (!row) return fallback;
  try {
    return JSON.parse(row.ValueJson) as T;
  } catch {
    return fallback;
  }
}

export async function loadReferenceFromDb(db: Db): Promise<Ref> {
  const spokesRes = await db.request().query("SELECT SpokeId, SpokeName, ShortName, ColorHexLight, ColorHexDark FROM core.RefSpoke");
  const spokes = spokesRes.recordset.map((r) => ({
    spokeId: r.SpokeId,
    spokeName: r.SpokeName,
    shortName: r.ShortName,
    colorLight: r.ColorHexLight,
    colorDark: r.ColorHexDark,
  }));

  const gradesRes = await db.request().query("SELECT GradeCode, GradeName FROM core.RefGrade");
  const gradeSpokesRes = await db.request().query("SELECT GradeCode, SpokeId FROM core.RefGradeSpoke");
  const gradeSpokeMap = new Map<string, string[]>();
  for (const row of gradeSpokesRes.recordset) {
    const arr = gradeSpokeMap.get(row.GradeCode) ?? [];
    arr.push(String(row.SpokeId));
    gradeSpokeMap.set(row.GradeCode, arr);
  }
  const grades = gradesRes.recordset.map((r) => ({ grade: r.GradeCode, gradeName: r.GradeName, spokeIds: gradeSpokeMap.get(r.GradeCode) ?? [] }));

  const gradeRatesRes = await db.request().query("SELECT GradeCode, GradeName, EffectiveFrom, HourlyCostGBP, SpokeId FROM core.RefGradeRate");
  const gradeRates = gradeRatesRes.recordset.map((r) => ({
    grade: r.GradeCode,
    gradeName: r.GradeName,
    effectiveFrom: dateOnly(r.EffectiveFrom),
    hourlyCostGBP: Number(r.HourlyCostGBP),
    ...(r.SpokeId != null ? { spokeId: String(r.SpokeId) } : {}),
  }));

  const propsRes = await db.request().query("SELECT PropositionId, PropositionName, SpokeId FROM core.RefProposition");
  const propositions = propsRes.recordset.map((r) => ({ propositionId: r.PropositionId, propositionName: r.PropositionName, spokeId: r.SpokeId }));

  const procRes = await db
    .request()
    .query(
      "SELECT ProcessId, ProcessName, ProcessAcronym, ProcessDescription, PropositionId, SMVMinutes, GradeCode, IsActive, Icon, Tags FROM core.RefProcess",
    );
  const processes = procRes.recordset.map((r) => ({
    processId: r.ProcessId,
    processName: r.ProcessName,
    processAcronym: r.ProcessAcronym,
    processDescription: r.ProcessDescription,
    propositionId: r.PropositionId,
    smvMinutes: Number(r.SMVMinutes),
    grade: r.GradeCode,
    isActive: !!r.IsActive,
    icon: r.Icon ?? "",
    tags: r.Tags ? String(r.Tags).split(";").filter((t: string) => t.length > 0) : [],
  }));

  const queueMapRes = await db.request().query("SELECT QueueName, ProcessId, StageName, StageOrder FROM core.RefQueueMap");
  const queueMap = queueMapRes.recordset.map((r) => ({ queueName: r.QueueName, processId: r.ProcessId, stageName: r.StageName, stageOrder: r.StageOrder }));

  const resRes = await db
    .request()
    .query(
      "SELECT ResourceName, BotName, BotAcronym, VDIName, CostClass, SpokeId, ActiveFrom, ActiveTo, Notes, IsActive, RenewalDate, AnnualCostGBP, LicenseExpiryDate, Status FROM core.RefResource",
    );
  const resources = resRes.recordset.map((r) => ({
    resourceName: r.ResourceName,
    botName: r.BotName,
    botAcronym: r.BotAcronym,
    vdiName: r.VDIName,
    costClass: r.CostClass,
    spokeId: r.SpokeId,
    activeFrom: dateOnly(r.ActiveFrom),
    activeTo: r.ActiveTo ? dateOnly(r.ActiveTo) : null,
    notes: r.Notes,
    isActive: !!r.IsActive,
    renewalDate: dateOnly(r.RenewalDate),
    annualCostGBP: r.AnnualCostGBP != null ? Number(r.AnnualCostGBP) : null,
    licenseExpiryDate: r.LicenseExpiryDate ? dateOnly(r.LicenseExpiryDate) : null,
    status: r.Status,
  }));

  const vdiRes = await db.request().query("SELECT CostClass, EffectiveFrom, AnnualCostPerVDIGBP, SpokeId FROM core.RefVDICostHistory");
  const vdiCostHistory = vdiRes.recordset.map((r) => ({
    costClass: r.CostClass,
    effectiveFrom: dateOnly(r.EffectiveFrom),
    annualCostPerVDIGBP: Number(r.AnnualCostPerVDIGBP),
    ...(r.SpokeId != null ? { spokeId: String(r.SpokeId) } : {}),
  }));

  const estRes = await db.request().query("SELECT EffectiveFrom, TeamAnnualCostGBP, WorkingDaysPerYear, ProductiveHoursPerDay, Note FROM core.RefEstateCostHistory");
  const estateCostHistory = estRes.recordset.map((r) => ({
    effectiveFrom: dateOnly(r.EffectiveFrom),
    teamAnnualCostGBP: Number(r.TeamAnnualCostGBP),
    workingDaysPerYear: r.WorkingDaysPerYear,
    productiveHoursPerDay: Number(r.ProductiveHoursPerDay),
    ...(r.Note != null ? { note: r.Note } : {}),
  }));

  const peopleRes = await db.request().query("SELECT OwnerId, Headcount, AnnualCostGBP, EffectiveFrom, Note FROM core.RefPeopleCostHistory");
  const peopleCostHistory = peopleRes.recordset.map((r) => ({
    ownerId: r.OwnerId,
    headcount: r.Headcount,
    annualCostGBP: Number(r.AnnualCostGBP),
    effectiveFrom: dateOnly(r.EffectiveFrom),
    ...(r.Note != null ? { note: r.Note } : {}),
  }));

  const excTypeRes = await db.request().query("SELECT MatchPattern, ExceptionType, Priority FROM core.RefExceptionType");
  const exceptionPatterns = excTypeRes.recordset.map((r) => ({ matchPattern: r.MatchPattern, exceptionType: r.ExceptionType, priority: r.Priority }));

  const [targets, thresholdOverrides, exceptionDisplayCodes, vdiOperatingHoursPerDay, financeTargets] = await Promise.all([
    getAppSetting(db, "targets", {}),
    getAppSetting<unknown[]>(db, "thresholdOverrides", []),
    getAppSetting(db, "exceptionDisplayCodes", {}),
    getAppSetting<number>(db, "vdiOperatingHoursPerDay", 20),
    getAppSetting<unknown[]>(db, "financeTargets", []),
  ]);

  return {
    spokes,
    grades,
    gradeRates,
    propositions,
    processes,
    queueMap,
    resources,
    vdiOperatingHoursPerDay,
    vdiCostHistory,
    estateCostHistory,
    peopleCostHistory,
    exceptionPatterns,
    exceptionDisplayCodes,
    targets,
    thresholdOverrides,
    financeTargets,
  };
}

// --- write path --------------------------------------------------------

// mssql's Int/NVarChar/Decimal/etc are a mix of ISqlTypeFactory and
// ISqlTypeFactoryWithNoParams depending on whether they take a length/
// precision argument — request.input() accepts either at runtime, but the
// two don't unify cleanly as a single TS type, so this is typed loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ColSpec = { name: string; type: () => any; value: (row: Ref) => unknown };

const TABLE_SPECS: Record<string, { rows: (ref: Ref) => Ref[]; columns: ColSpec[] }> = {
  RefSpoke: {
    rows: (ref) => ref.spokes,
    columns: [
      { name: "SpokeId", type: () => sql.Int, value: (r) => r.spokeId },
      { name: "SpokeName", type: () => sql.NVarChar(100), value: (r) => r.spokeName },
      { name: "ShortName", type: () => sql.NVarChar(10), value: (r) => r.shortName },
      { name: "ColorHexLight", type: () => sql.Char(7), value: (r) => r.colorLight },
      { name: "ColorHexDark", type: () => sql.Char(7), value: (r) => r.colorDark },
    ],
  },
  RefGrade: {
    rows: (ref) => ref.grades ?? [],
    columns: [
      { name: "GradeCode", type: () => sql.NVarChar(10), value: (r) => r.grade },
      { name: "GradeName", type: () => sql.NVarChar(100), value: (r) => r.gradeName },
    ],
  },
  RefGradeSpoke: {
    rows: (ref) => (ref.grades ?? []).flatMap((g: Ref) => (g.spokeIds as string[]).map((sid) => ({ grade: g.grade, spokeId: Number(sid) }))),
    columns: [
      { name: "GradeCode", type: () => sql.NVarChar(10), value: (r) => r.grade },
      { name: "SpokeId", type: () => sql.Int, value: (r) => r.spokeId },
    ],
  },
  RefGradeRate: {
    rows: (ref) => ref.gradeRates,
    columns: [
      { name: "GradeCode", type: () => sql.NVarChar(10), value: (r) => r.grade },
      { name: "GradeName", type: () => sql.NVarChar(100), value: (r) => r.gradeName },
      { name: "EffectiveFrom", type: () => sql.Date, value: (r) => r.effectiveFrom },
      { name: "HourlyCostGBP", type: () => sql.Decimal(8, 2), value: (r) => r.hourlyCostGBP },
      { name: "SpokeId", type: () => sql.NVarChar(20), value: (r) => r.spokeId ?? null },
    ],
  },
  RefProposition: {
    rows: (ref) => ref.propositions,
    columns: [
      { name: "PropositionId", type: () => sql.Int, value: (r) => r.propositionId },
      { name: "PropositionName", type: () => sql.NVarChar(100), value: (r) => r.propositionName },
      { name: "SpokeId", type: () => sql.Int, value: (r) => r.spokeId },
    ],
  },
  RefProcess: {
    rows: (ref) => ref.processes,
    columns: [
      { name: "ProcessId", type: () => sql.Int, value: (r) => r.processId },
      { name: "ProcessName", type: () => sql.NVarChar(150), value: (r) => r.processName },
      { name: "ProcessAcronym", type: () => sql.NVarChar(20), value: (r) => r.processAcronym },
      { name: "ProcessDescription", type: () => sql.NVarChar(500), value: (r) => r.processDescription },
      { name: "PropositionId", type: () => sql.Int, value: (r) => r.propositionId },
      { name: "SMVMinutes", type: () => sql.Decimal(8, 2), value: (r) => r.smvMinutes },
      { name: "GradeCode", type: () => sql.NVarChar(10), value: (r) => r.grade },
      { name: "IsActive", type: () => sql.Bit, value: (r) => !!r.isActive },
      { name: "Icon", type: () => sql.NVarChar(40), value: (r) => (r.icon ? r.icon : null) },
      {
        name: "Tags",
        type: () => sql.NVarChar(400),
        value: (r) => (Array.isArray(r.tags) && r.tags.length > 0 ? r.tags.join(";") : null),
      },
    ],
  },
  RefQueueMap: {
    rows: (ref) => ref.queueMap,
    columns: [
      { name: "QueueName", type: () => sql.NVarChar(200), value: (r) => r.queueName },
      { name: "ProcessId", type: () => sql.Int, value: (r) => r.processId },
      { name: "StageName", type: () => sql.NVarChar(100), value: (r) => r.stageName ?? null },
      { name: "StageOrder", type: () => sql.Int, value: (r) => r.stageOrder ?? null },
    ],
  },
  RefResource: {
    rows: (ref) => ref.resources,
    columns: [
      { name: "ResourceName", type: () => sql.NVarChar(200), value: (r) => r.resourceName },
      { name: "BotName", type: () => sql.NVarChar(200), value: (r) => r.botName },
      { name: "BotAcronym", type: () => sql.NVarChar(20), value: (r) => r.botAcronym },
      { name: "VDIName", type: () => sql.NVarChar(200), value: (r) => r.vdiName },
      { name: "CostClass", type: () => sql.NVarChar(10), value: (r) => r.costClass },
      { name: "SpokeId", type: () => sql.Int, value: (r) => r.spokeId ?? null },
      { name: "ActiveFrom", type: () => sql.Date, value: (r) => r.activeFrom },
      { name: "ActiveTo", type: () => sql.Date, value: (r) => r.activeTo ?? null },
      { name: "Notes", type: () => sql.NVarChar(500), value: (r) => r.notes ?? null },
      { name: "IsActive", type: () => sql.Bit, value: (r) => !!r.isActive },
      { name: "RenewalDate", type: () => sql.Date, value: (r) => r.renewalDate },
      { name: "AnnualCostGBP", type: () => sql.Decimal(12, 2), value: (r) => r.annualCostGBP ?? null },
      { name: "LicenseExpiryDate", type: () => sql.Date, value: (r) => r.licenseExpiryDate ?? null },
      { name: "Status", type: () => sql.NVarChar(10), value: (r) => r.status },
    ],
  },
  RefVDICostHistory: {
    rows: (ref) => ref.vdiCostHistory,
    columns: [
      { name: "CostClass", type: () => sql.NVarChar(10), value: (r) => r.costClass },
      { name: "EffectiveFrom", type: () => sql.Date, value: (r) => r.effectiveFrom },
      { name: "AnnualCostPerVDIGBP", type: () => sql.Decimal(12, 2), value: (r) => r.annualCostPerVDIGBP },
      { name: "SpokeId", type: () => sql.NVarChar(20), value: (r) => r.spokeId ?? null },
    ],
  },
  RefEstateCostHistory: {
    rows: (ref) => ref.estateCostHistory,
    columns: [
      { name: "EffectiveFrom", type: () => sql.Date, value: (r) => r.effectiveFrom },
      { name: "TeamAnnualCostGBP", type: () => sql.Decimal(14, 2), value: (r) => r.teamAnnualCostGBP },
      { name: "WorkingDaysPerYear", type: () => sql.Int, value: (r) => r.workingDaysPerYear },
      { name: "ProductiveHoursPerDay", type: () => sql.Decimal(5, 2), value: (r) => r.productiveHoursPerDay },
      { name: "Note", type: () => sql.NVarChar(300), value: (r) => r.note ?? null },
    ],
  },
  RefPeopleCostHistory: {
    rows: (ref) => ref.peopleCostHistory,
    columns: [
      { name: "OwnerId", type: () => sql.NVarChar(20), value: (r) => r.ownerId },
      { name: "Headcount", type: () => sql.Int, value: (r) => r.headcount },
      { name: "AnnualCostGBP", type: () => sql.Decimal(14, 2), value: (r) => r.annualCostGBP },
      { name: "EffectiveFrom", type: () => sql.Date, value: (r) => r.effectiveFrom },
      { name: "Note", type: () => sql.NVarChar(300), value: (r) => r.note ?? null },
    ],
  },
  RefExceptionType: {
    rows: (ref) => ref.exceptionPatterns,
    columns: [
      { name: "MatchPattern", type: () => sql.NVarChar(200), value: (r) => r.matchPattern },
      { name: "ExceptionType", type: () => sql.NVarChar(20), value: (r) => r.exceptionType },
      { name: "Priority", type: () => sql.Int, value: (r) => r.priority },
    ],
  },
};

/** The exact column list SqlReferenceStore.put() writes for one Ref* table,
 *  in order — exposed for server/test/sql-reference.test.ts's parity checks
 *  (notably "spa-exporter-columns-in-sync", which compares this against
 *  src/reference/reference-store.ts's exportReferenceSql RefProcess column
 *  list). Not used by production code; TABLE_SPECS itself stays internal. */
export function writerColumnsFor(table: keyof typeof TABLE_SPECS): string[] {
  return TABLE_SPECS[table].columns.map((c) => c.name);
}

async function insertRows(tx: sql.Transaction, table: string, ref: Ref): Promise<void> {
  const spec = TABLE_SPECS[table];
  const rows = spec.rows(ref);
  for (const row of rows) {
    const req = new sql.Request(tx);
    for (const col of spec.columns) req.input(col.name, col.type(), col.value(row));
    const cols = spec.columns.map((c) => c.name).join(", ");
    const params = spec.columns.map((c) => `@${c.name}`).join(", ");
    await req.query(`INSERT INTO core.${table} (${cols}) VALUES (${params})`);
  }
}

async function upsertAppSetting(tx: sql.Transaction, key: string, value: unknown, actor: string): Promise<void> {
  const req = new sql.Request(tx);
  req.input("key", sql.NVarChar(64), key);
  req.input("value", sql.NVarChar(sql.MAX), JSON.stringify(value));
  req.input("actor", sql.NVarChar(200), actor);
  await req.query(`
    UPDATE core.RefAppSettings SET ValueJson = @value, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @actor WHERE SettingKey = @key;
    IF @@ROWCOUNT = 0
      INSERT INTO core.RefAppSettings (SettingKey, ValueJson, UpdatedBy) VALUES (@key, @value, @actor);
  `);
}

export class SqlReferenceStore implements ReferenceStore {
  constructor(private db: Db) {}

  async get(): Promise<ReferenceSnapshot> {
    const reference = await loadReferenceFromDb(this.db);
    const verRes = await this.db.request().query("SELECT TOP 1 Version, UpdatedAt, UpdatedBy FROM core.RefVersion WHERE Id = 1");
    const row = verRes.recordset[0] ?? { Version: 1, UpdatedAt: new Date().toISOString(), UpdatedBy: null };
    return { reference, version: row.Version, updatedAt: new Date(row.UpdatedAt).toISOString(), updatedBy: row.UpdatedBy ?? null };
  }

  async put(input: PutReferenceInput): Promise<ReferenceSnapshot> {
    const check = validateReference(input.reference);
    if (!check.ok) throw Object.assign(new Error(`Invalid reference payload: ${check.errors.join("; ")}`), { status: 400 });

    const verRes = await this.db.request().query("SELECT TOP 1 Version FROM core.RefVersion WHERE Id = 1");
    const currentVersion = verRes.recordset[0]?.Version ?? 1;
    if (currentVersion !== input.expectedVersion) {
      throw new VersionConflictError(await this.get());
    }

    const tx = this.db.transaction();
    await tx.begin();
    try {
      for (const table of DELETE_ORDER) await new sql.Request(tx).query(`DELETE FROM core.${table}`);
      for (const table of INSERT_ORDER) await insertRows(tx, table, input.reference);

      await upsertAppSetting(tx, "targets", input.reference.targets, input.actor);
      await upsertAppSetting(tx, "thresholdOverrides", input.reference.thresholdOverrides ?? [], input.actor);
      await upsertAppSetting(tx, "exceptionDisplayCodes", input.reference.exceptionDisplayCodes, input.actor);
      await upsertAppSetting(tx, "vdiOperatingHoursPerDay", input.reference.vdiOperatingHoursPerDay, input.actor);
      await upsertAppSetting(tx, "financeTargets", input.reference.financeTargets ?? [], input.actor);

      const bumpReq = new sql.Request(tx);
      bumpReq.input("actor", sql.NVarChar(200), input.actor);
      await bumpReq.query("UPDATE core.RefVersion SET Version = Version + 1, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @actor WHERE Id = 1");

      const clRequest = new sql.Request(tx);
      clRequest.input("actor", sql.NVarChar(200), input.actor);
      clRequest.input("section", sql.NVarChar(100), input.section);
      await clRequest.query("INSERT INTO core.RefChangeLog (Actor, Section) VALUES (@actor, @section)");

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    return this.get();
  }
}
