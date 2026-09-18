// Local structural type for the rowsets object passed to
// shared/model-assembler.mjs's assembleModel(). Kept here (rather than
// importing shared/model-assembler.d.ts by specifier) so the server's
// module resolution never depends on TS's cross-extension (.mjs/.d.ts)
// declaration-file matching, which is fragile under NodeNext resolution.
// See shared/model-assembler.mjs's header comment for the authoritative
// contract this type mirrors.
export type Row = Record<string, unknown>;

export interface ModelRowsets {
  reference: Record<string, unknown>;
  spokes: Row[];
  propositions: Row[];
  processes: Row[];
  resources: Row[];
  exceptionReasons: Row[];
  estateRateByDate: Row[];
  dayRows: Row[];
  excRows: Row[];
  resRows: Row[];
  dayWorktimeTotals: Row[];
  spokeDayWorktimeTotals: Row[];
  resourceActivity: Row[];
  meta: Row;
  unmappedQueues: (string | Row)[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelJson = Record<string, any>;

/** GET /api/health's `lastRun` -- the latest core.PipelineRun row
 *  (report.vw_PipelineHealth, 13_api_model_views.sql), whatever its
 *  Status. See server/src/data/sql-model.ts's getLastRun() (sql mode) and
 *  server/src/data/fixtures.ts's synthetic healthy object (fixture mode). */
export interface PipelineHealth {
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  rowsStaged: number | null;
  rowsMerged: number | null;
  rowsRejected: number | null;
  unmappedQueues: { queue: string; rows: number }[];
  watermarkAgeMinutes: number | null;
  error: string | null;
}
