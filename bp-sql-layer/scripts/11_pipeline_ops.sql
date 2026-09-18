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
     RowsRejected   INT NULL: rows from this pull's raw.WorkQueueItem that
                    failed a validation check in staging.usp_LoadStaging
                    and were quarantined to raw.WorkQueueItemRejected
                    instead of reaching staging.WorkQueueItem (see that
                    script's header). Set by ingest/load_to_sql.py after
                    core.usp_RunPull, via a COUNT(*) ... WHERE LoadBatchId
                    = <this pull's LoadBatchId> (RunId isn't known INSIDE
                    staging.usp_LoadStaging -- see raw.WorkQueueItemRejected
                    below for why LoadBatchId, not RunId, is the join key
                    load_to_sql.py uses to attribute rejects to a run).
     UnmappedQueues NVARCHAR(MAX) NULL: JSON array of {"queue","rows"}
                    for every QueueName staged this pull with no
                    core.RefQueueMap row -- ingest/load_to_sql.py's own
                    early-warning copy of what
                    report.vw_ModelUnmappedQueues/core.usp_RunPull's PRINT
                    already surface, but scoped to THIS pull's staged rows
                    and structured for the API/dashboard to render
                    directly (see 13_api_model_views.sql's
                    report.vw_PipelineHealth and src/pages/admin/
                    DataSyncSection.tsx).
     WatermarkAgeMinutes INT NULL: DATEDIFF(MINUTE, MAX(LastUpdatedDate),
                    SYSUTCDATETIME()) over staging.WorkQueueItem at the
                    moment this pull finished -- "how stale is the
                    underlying BP data", independent of whether the
                    pipeline itself is running on schedule. See
                    report.vw_PipelineHealth's `stale` derivation
                    (PULL_CADENCE_MINUTES x 3) in server/src/routes/health.ts.
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
        RowsRejected        INT           NULL,
        UnmappedQueues      NVARCHAR(MAX) NULL,
        WatermarkAgeMinutes INT           NULL,
        CONSTRAINT CK_PipelineRun_Status CHECK (Status IN ('running','success','failed')),
        CONSTRAINT CK_PipelineRun_Adapter CHECK (Adapter IN ('elastic','api'))
    );
END
GO

-- Idempotent ALTER for an already-deployed database that created
-- core.PipelineRun before this task's columns existed. IF COL_LENGTH(...)
-- IS NULL is the standard "does this column already exist" guard (works
-- whether or not the table itself pre-dates this script) -- see this
-- file's own header comment on why 11_pipeline_ops.sql never DROPs.
IF COL_LENGTH('core.PipelineRun', 'RowsRejected') IS NULL
    ALTER TABLE core.PipelineRun ADD RowsRejected INT NULL;
GO
IF COL_LENGTH('core.PipelineRun', 'UnmappedQueues') IS NULL
    ALTER TABLE core.PipelineRun ADD UnmappedQueues NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('core.PipelineRun', 'WatermarkAgeMinutes') IS NULL
    ALTER TABLE core.PipelineRun ADD WatermarkAgeMinutes INT NULL;
GO

/* =====================================================================
   raw.WorkQueueItemRejected -- the quarantine table staging.usp_LoadStaging
   (05_proc_load_staging.sql) writes to instead of silently dropping a
   blank-ID row or silently accepting a row with an unparseable date/number
   as a quiet NULL. Same columns as raw.WorkQueueItem (all-text, exactly as
   the export carried them -- so an operator can see precisely what was in
   the bad row) plus:
     RejectReason NVARCHAR(200) -- one of: 'blank ID', 'unparseable
                  LoadedDate'/'LastUpdatedDate'/'CompletedDate'/
                  'ExceptionDate'/'DeferredDate'/'LockedDate',
                  'non-integer Worktime', 'negative Worktime',
                  'non-integer Attempt', 'unknown Status'. See
                  05_proc_load_staging.sql for the exact per-row rule
                  (first matching reason wins; a row lands in exactly one
                  of staging.WorkQueueItem or here, never both/neither).
     RunId        BIGINT NULL, FK to core.PipelineRun.RunId. NULL
                  immediately after staging.usp_LoadStaging runs (that
                  procedure has no RunId parameter -- it is called with no
                  arguments by core.usp_RunPull, which this task does not
                  own/modify) -- ingest/load_to_sql.py backfills it right
                  after core.usp_RunPull returns, by matching this pull's
                  own LoadBatchId (already present on every raw row loaded
                  this pull -- see ingest/load_to_sql.py) to the RunId it
                  opened for the same pull. A row whose RunId is still NULL
                  means either the backfill UPDATE hasn't run yet or this
                  procedure was invoked outside load_to_sql.py's control
                  (e.g. an operator running core.usp_RunPull by hand).
     RejectedAt   DATETIME2(0), when the row was quarantined.
   APPEND-ONLY / NEVER TRUNCATED: unlike staging.WorkQueueItem (rebuilt
   every pull), this table accumulates across pulls -- it is the audit
   trail an operator needs to answer "was this bad data corrupted at
   source, and since when", the same reasoning core.RefChangeLog's own
   comment (13_api_model_views.sql) gives for never dropping an audit
   table. Housekeeping/retention, if ever needed, is a deliberate separate
   job, exactly like core.FactWorkItem's own "the merge never deletes"
   rule (06_proc_merge_fact.sql).
   ===================================================================== */
IF OBJECT_ID('raw.WorkQueueItemRejected') IS NULL
BEGIN
    CREATE TABLE raw.WorkQueueItemRejected (
        ID               NVARCHAR(100)  NULL,
        KeyValue         NVARCHAR(400)  NULL,
        Priority         NVARCHAR(50)   NULL,
        Status           NVARCHAR(100)  NULL,
        Tags             NVARCHAR(1000) NULL,
        Resource         NVARCHAR(200)  NULL,
        Attempt          NVARCHAR(50)   NULL,
        LoadedDate       NVARCHAR(50)   NULL,
        LastUpdatedDate  NVARCHAR(50)   NULL,
        DeferredDate     NVARCHAR(50)   NULL,
        LockedDate       NVARCHAR(50)   NULL,
        CompletedDate    NVARCHAR(50)   NULL,
        Worktime         NVARCHAR(50)   NULL,
        ExceptionDate    NVARCHAR(50)   NULL,
        ExceptionReason  NVARCHAR(1000) NULL,
        QueueName        NVARCHAR(200)  NULL,
        SourceFile       NVARCHAR(400)  NULL,
        LoadBatchId      UNIQUEIDENTIFIER NULL,
        RejectReason     NVARCHAR(200)  NOT NULL,
        RunId            BIGINT         NULL,
        RejectedAt       DATETIME2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Id               BIGINT         NOT NULL IDENTITY(1,1) PRIMARY KEY
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_WorkQueueItemRejected_LoadBatchId' AND object_id = OBJECT_ID('raw.WorkQueueItemRejected')
)
    CREATE INDEX IX_WorkQueueItemRejected_LoadBatchId ON raw.WorkQueueItemRejected (LoadBatchId);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_WorkQueueItemRejected_RunId' AND object_id = OBJECT_ID('raw.WorkQueueItemRejected')
)
    CREATE INDEX IX_WorkQueueItemRejected_RunId ON raw.WorkQueueItemRejected (RunId);
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
