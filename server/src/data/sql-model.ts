// ---------------------------------------------------------------------------
// sql-model.ts — real-mode ModelJson rowset source: queries the
// report.vw_Model* views (13_api_model_views.sql) + report.vw_EstateRateByDate
// (08_report_views.sql), and derives spokes/propositions/processes/resources
// from the reconstructed `reference` (see reference-mapping.ts) exactly like
// the Node build does from reference.json — see shared/model-assembler.mjs's
// header comment for why these four dims don't need their own new views.
// ---------------------------------------------------------------------------
import type { Db } from "../db.js";
import { loadReferenceFromDb } from "./sql-reference.js";
import {
  processesRowsetFromReference,
  propositionsRowsetFromReference,
  resourcesRowsetFromReference,
  spokesRowsetFromReference,
} from "./reference-mapping.js";
import type { ModelRowsets, Row } from "../model-types.js";

/** mssql returns SQL DATE columns as JS Date objects (UTC midnight, given
 *  the driver's default useUTC:true) — convert to 'YYYY-MM-DD' so they match
 *  what assembleModel's dayRows/excRows/resRows/*WorktimeTotals rowsets
 *  expect verbatim (see shared/model-assembler.mjs: only estateRateByDate/
 *  resourceActivity/meta run their date fields through its own dateOnly()). */
function stringifyDateField(rows: Row[], field: string): Row[] {
  return rows.map((r) => {
    const v = r[field];
    if (v instanceof Date) return { ...r, [field]: v.toISOString().slice(0, 10) };
    return r;
  });
}

export class SqlModelSource {
  constructor(private db: Db) {}

  async computeCacheKey(): Promise<string> {
    const req = this.db.request();
    const result = await req.query(`
      DECLARE @dataKey NVARCHAR(50) = NULL;
      IF OBJECT_ID('core.PipelineRun') IS NOT NULL
        SELECT TOP 1 @dataKey = CAST(Id AS NVARCHAR(50)) FROM core.PipelineRun WHERE Status = 'ok' ORDER BY FinishedAt DESC;
      IF @dataKey IS NULL
        SELECT @dataKey = CONVERT(NVARCHAR(50), MAX(LastUpdatedDate), 126) FROM core.FactWorkItem;
      DECLARE @refVersion INT = (SELECT TOP 1 Version FROM core.RefVersion WHERE Id = 1);
      SELECT @dataKey AS DataKey, @refVersion AS RefVersion;
    `);
    const row = result.recordset[0] ?? {};
    return `sql:${row.DataKey ?? "unknown"}:${row.RefVersion ?? 0}`;
  }

  async buildRowsets(): Promise<ModelRowsets> {
    const reference = await loadReferenceFromDb(this.db);

    const [exceptionReasons, estateRateByDate, dayRows, excRows, resRows, dayWorktimeTotals, spokeDayWorktimeTotals, resourceActivity, metaRes, unmappedQueues] =
      await Promise.all([
        this.db.request().query("SELECT Reason, ExceptionType FROM report.vw_ModelExceptionReasons"),
        this.db.request().query("SELECT [Date], EstateCostPerDayGBP, WorkingDaysPerYear, ProductiveHoursPerDay FROM report.vw_EstateRateByDate"),
        this.db.request().query("SELECT d, p, c, b, s, n, w, cw, gb, ec FROM report.vw_ModelDayRows"),
        this.db.request().query("SELECT d, p, r, t, n, w FROM report.vw_ModelExcRows"),
        this.db.request().query("SELECT d, r, p, n, e, w, ec FROM report.vw_ModelResRows"),
        this.db.request().query("SELECT d, w FROM report.vw_ModelDayWorktimeTotals"),
        this.db.request().query("SELECT SpokeName, d, w FROM report.vw_ModelSpokeDayWorktimeTotals"),
        this.db.request().query("SELECT ResourceName, FirstSeen, LastSeen, Items, SpokesServed FROM report.vw_ModelResourceActivity"),
        this.db.request().query("SELECT SourceRows, DateMin, DateMax FROM report.vw_ModelMeta"),
        this.db.request().query("SELECT QueueName FROM report.vw_ModelUnmappedQueues"),
      ]);

    return {
      reference,
      spokes: spokesRowsetFromReference(reference),
      propositions: propositionsRowsetFromReference(reference),
      processes: processesRowsetFromReference(reference),
      resources: resourcesRowsetFromReference(reference),
      exceptionReasons: exceptionReasons.recordset,
      estateRateByDate: estateRateByDate.recordset,
      dayRows: stringifyDateField(dayRows.recordset, "d"),
      excRows: stringifyDateField(excRows.recordset, "d"),
      resRows: stringifyDateField(resRows.recordset, "d"),
      dayWorktimeTotals: stringifyDateField(dayWorktimeTotals.recordset, "d"),
      spokeDayWorktimeTotals: stringifyDateField(spokeDayWorktimeTotals.recordset, "d"),
      resourceActivity: resourceActivity.recordset,
      meta: metaRes.recordset[0] ?? {},
      unmappedQueues: unmappedQueues.recordset.map((r: Row) => r.QueueName as string),
    };
  }
}

/** For GET /api/health's lastPullAt: latest successful core.PipelineRun
 *  finish time, tolerating the table's absence (owned by 11_pipeline_ops.sql,
 *  a sibling script this task does not create) -> null. */
export async function getLastPullAt(db: Db): Promise<string | null> {
  const result = await db.request().query(`
    DECLARE @finishedAt DATETIME2(0) = NULL;
    IF OBJECT_ID('core.PipelineRun') IS NOT NULL
      SELECT TOP 1 @finishedAt = FinishedAt FROM core.PipelineRun WHERE Status = 'ok' ORDER BY FinishedAt DESC;
    SELECT @finishedAt AS FinishedAt;
  `);
  const v = result.recordset[0]?.FinishedAt;
  return v ? new Date(v).toISOString() : null;
}
