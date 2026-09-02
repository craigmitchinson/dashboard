/* =====================================================================
   11_pipeline_ops.sql
   ---------------------------------------------------------------------
   Operational tables for a Cloud Run Job-driven pipeline: a run ledger
   (core.PipelineRun) and a durable watermark store (core.IngestWatermark).

   WHY THESE EXIST (Cloud SQL for SQL Server production context):
   A Cloud Run Job is stateless container storage-wise -- its filesystem
   does not survive between executions, so the JSON watermark state files
   that ingest/bp_api_to_csv.py (BP_STATE_FILE) writes today, and the
   FROM_DATE/TO_DATE-only watermark that ingest/elastic_to_csv.py relies
   on, cannot live on local disk in production. Both adapters and
   ingest/load_to_sql.py / ingest/run_pipeline.py read and write these two
   tables INSTEAD, when SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD env
   vars are present (see ingest/sqlconn.py) -- falling back to the local
   JSON file / manual FROM_DATE/TO_DATE only when those env vars are
   absent (e.g. running the adapter by hand on an analyst's laptop against
   a non-Cloud Run, on-prem SQL Server, or with no SQL connectivity yet).

   core.PipelineRun IS AN API CONTRACT: the production data API's
   GET /api/health reads it for lastPullAt. Its columns must not be
   renamed without updating that API. See "API CONTRACT" comment below.

   Idempotent: safe to re-run (creates tables only if they don't already
   exist -- unlike most scripts 01-08, this one does NOT drop and
   recreate, because PipelineRun/IngestWatermark hold operational history
   that must survive a re-run of this script).
   ===================================================================== */
USE BPAnalytics;
GO

/* =====================================================================
   core.PipelineRun -- one row per pipeline execution (adapter pull ->
   load_to_sql.py -> core.usp_RunPull), written by ingest/run_pipeline.py.

   API CONTRACT (the production data API's GET /api/health depends on
   this exact shape):
     RunId          BIGINT IDENTITY, surrogate key.
     StartedAt      DATETIME2(3), UTC, set the moment run_pipeline.py
                    begins (before the adapter runs).
     FinishedAt     DATETIME2(3), UTC, NULL while a run is in flight.
                    /api/health's lastPullAt = MAX(FinishedAt) WHERE
                    Status = 'success'. A NULL FinishedAt with an old
                    StartedAt (see usp_GetInFlightRun below) means either
                    a run is genuinely still going, or a prior run crashed
                    without reaching its final UPDATE -- run_pipeline.py's
                    overlap/in-flight guard (see run_pipeline.py's
                    IN_FLIGHT_STALE_MINUTES) treats a run older than that
                    threshold as abandoned, not blocking.
     Adapter        NVARCHAR(20): 'elastic' or 'api' (matches
                    BP_ADAPTER's two values in run_pipeline.py).
     RowsStaged     INT, rows in staging.WorkQueueItem after
                    staging.usp_LoadStaging ran this pull (this pull's
                    file/delta only -- staging is truncated-and-rebuilt
                    every pull, see 02_raw_and_staging.sql).
     RowsMerged     INT, (fact row count AFTER usp_MergeFact) minus
                    (fact row count BEFORE) -- i.e. net NEW rows inserted
                    this pull. This is core.usp_RunPull's own
                    "new items inserted" figure, captured programmatically
                    instead of only PRINTed.
     MaxLastUpdated DATETIME2(0), MAX(LastUpdatedDate) across the rows
                    staged this pull -- what "how fresh is the data"
                    actually means; distinct from FinishedAt (when the
                    pipeline ran) which only tells you the pipeline is
                    alive, not how current the underlying BP data is.
     Status         NVARCHAR(20): 'running' | 'success' | 'failed'.
     Error          NVARCHAR(MAX) NULL: exception text/traceback summary
                    when Status = 'failed'; NULL otherwise.
   ===================================================================== */
IF OBJECT_ID('core.PipelineRun') IS NULL
BEGIN
    CREATE TABLE core.PipelineRun (
        RunId           BIGINT         NOT NULL IDENTITY(1,1) PRIMARY KEY,
        StartedAt       DATETIME2(3)   NOT NULL,
        FinishedAt      DATETIME2(3)   NULL,
        Adapter         NVARCHAR(20)   NOT NULL,
        RowsStaged      INT            NULL,
        RowsMerged      INT            NULL,
        MaxLastUpdated  DATETIME2(0)   NULL,
        Status          NVARCHAR(20)   NOT NULL DEFAULT 'running',
        Error           NVARCHAR(MAX)  NULL,
        CONSTRAINT CK_PipelineRun_Status CHECK (Status IN ('running','success','failed')),
        CONSTRAINT CK_PipelineRun_Adapter CHECK (Adapter IN ('elastic','api'))
    );
END
GO

-- Supports both "is a run currently in flight" (run_pipeline.py's overlap
-- guard) and /api/health's "most recent successful FinishedAt" query.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PipelineRun_Status_StartedAt' AND object_id = OBJECT_ID('core.PipelineRun')
)
    CREATE INDEX IX_PipelineRun_Status_StartedAt ON core.PipelineRun (Status, StartedAt DESC);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PipelineRun_Status_FinishedAt' AND object_id = OBJECT_ID('core.PipelineRun')
)
    CREATE INDEX IX_PipelineRun_Status_FinishedAt ON core.PipelineRun (Status, FinishedAt DESC);
GO

/* =====================================================================
   core.IngestWatermark -- durable "how far have we pulled" marker per
   adapter, surviving a stateless Cloud Run Job's restarts.

     Source          NVARCHAR(20): 'elastic' or 'api' (same values as
                     core.PipelineRun.Adapter).
     Queue           NVARCHAR(200): the BP queue name for the 'api'
                     adapter (bp_api_to_csv.py keeps one watermark per
                     queue, exactly like its existing BP_STATE_FILE JSON
                     shape: {"<queue name>": "<iso timestamp>", ...}).
                     For the 'elastic' adapter, which has no per-queue
                     concept (one date-range query across the whole
                     index), this is the literal string '*'.
     LastUpdatedMax  DATETIME2(0) NULL: the maximum LastUpdatedDate seen
                     in that source/queue's last successful pull. NULL
                     only means "never successfully pulled yet".
     UpdatedAt       DATETIME2(0): when this row was last written, for
                     operator visibility only (not read by any adapter).

   RESUMABILITY: an adapter always re-pulls a deliberate overlap window
   BEHIND this stored value (bp_api_to_csv.py's existing
   WATERMARK_OVERLAP_HOURS; elastic_to_csv.py's new
   ELASTIC_WATERMARK_OVERLAP_HOURS, see elastic_to_csv.py) -- never
   "since exactly this timestamp" -- for the same reason the JSON state
   file's docstring already gives: a work queue item mutating in place
   near the edge of a narrow window could otherwise be missed forever.
   Writing this row only happens AFTER the CSV a watermark represents is
   durably written and merged (see run_pipeline.py) -- mirrors
   bp_api_to_csv.py's existing "write CSV, then advance watermark, never
   the other order" discipline for its JSON file.
   ===================================================================== */
IF OBJECT_ID('core.IngestWatermark') IS NULL
BEGIN
    CREATE TABLE core.IngestWatermark (
        Source          NVARCHAR(20)  NOT NULL,
        Queue           NVARCHAR(200) NOT NULL,
        LastUpdatedMax  DATETIME2(0)  NULL,
        UpdatedAt       DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_IngestWatermark PRIMARY KEY (Source, Queue),
        CONSTRAINT CK_IngestWatermark_Source CHECK (Source IN ('elastic','api'))
    );
END
GO

/* =====================================================================
   core.usp_GetInFlightRun -- helper for run_pipeline.py's "never overlap
   pulls" guard (Cloud Scheduler + concurrency=1 on the Cloud Run Job
   already prevents most overlap, but Cloud Scheduler can still retry a
   slow-to-fail request, or an operator can trigger a manual run while a
   scheduled one is mid-flight -- this is the belt to that braces).
   Returns the most recent run that is still Status='running' AND started
   less than @StaleAfterMinutes ago; a 'running' row older than that is
   presumed crashed (the process died without reaching its final UPDATE)
   and is NOT returned, so a genuinely stuck run can never permanently
   wedge the pipeline.
   ===================================================================== */
CREATE OR ALTER PROCEDURE core.usp_GetInFlightRun
    @StaleAfterMinutes INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 RunId, StartedAt, Adapter
    FROM core.PipelineRun
    WHERE Status = 'running'
      AND StartedAt >= DATEADD(MINUTE, -@StaleAfterMinutes, SYSUTCDATETIME())
    ORDER BY StartedAt DESC;
END
GO
