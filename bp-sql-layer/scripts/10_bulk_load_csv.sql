/* =====================================================================
   10_bulk_load_csv.sql
   ---------------------------------------------------------------------
   ON-PREM / SELF-MANAGED SQL SERVER ALTERNATIVE -- NOT FOR CLOUD SQL.

   BULK INSERT ... FROM '<path>' below requires the SQL Server ENGINE
   PROCESS ITSELF to read that path off a filesystem it can see (a local
   disk, or a UNC/mapped network share reachable from the server). Cloud
   SQL for SQL Server gives you no such filesystem access -- there is no
   server-local disk to point @File at, and no way to mount a network
   share to it. VERIFIED (Google Cloud's own Cloud SQL for SQL Server
   import/export documentation, docs.cloud.google.com/sql/docs/sqlserver/
   import-export, and the built-in msdb.dbo.gcloudsql_bulk_insert stored
   procedure it documents): Cloud SQL's own answer to "BULK INSERT" is
   that stored procedure, which reads the source file from a GOOGLE CLOUD
   STORAGE bucket (via HMAC-key-authenticated access to Cloud Storage's
   interoperable API) rather than a local path -- a materially different
   shape of BULK INSERT than the one in this script (different parameter
   set: @database/@schema/@object/@file/@formatfile/@fieldterminator/
   @rowterminator/@fieldquote/@batchsize/@tablock/@ordercolumnsjson/
   @errorfile/@datasource, not a bare FROM '<path>'), and its own docs
   warn that a mid-batch failure with @batchsize set can leave partially
   loaded data -- i.e. it is not itself resumable/idempotent the way this
   script's TRUNCATE-then-reload pattern is.

   Rather than adapt this script to that Cloud-Storage-shaped stored
   procedure (which would need every adapter to also stage its CSV output
   into a GCS bucket, and would inherit gcloudsql_bulk_insert's partial-
   batch-on-failure caveat), Cloud SQL for SQL Server production
   deployments of this pipeline use bp-sql-layer/ingest/load_to_sql.py
   instead: it loads the CSV directly from the ingest container's own
   filesystem into raw.WorkQueueItem using the driver's own batched,
   parameterized insert path (pyodbc fast_executemany), in batches with a
   transaction per batch, then calls core.usp_RunPull exactly as this
   script does below -- see deploy/gcp.md and deploy/cloudsql.md for the
   production runbook, and bp-sql-layer/ingest/README.md for load_to_sql.py's
   env vars. THIS SCRIPT (10_bulk_load_csv.sql) remains the correct,
   fully supported choice for an on-prem or self-managed SQL Server
   instance where the server process CAN see a local path or network
   share -- keep using it there; it is not deprecated, only inapplicable
   to Cloud SQL.

   ---------------------------------------------------------------------
   Path A ingest: load a work-queue CSV into raw.WorkQueueItem and run
   the pull. The CSV can come from anywhere that honours the schema:
     - a Blue Prism work queue export off the shared drive
     - ingest/elastic_to_csv.py (Blue Prism API -> Elastic -> CSV)
     - the dashboard repo's mock generator (for rehearsal/demo)

   The columns must be, in order:
     ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
     LoadedDate, LastUpdatedDate, DeferredDate, LockedDate,
     CompletedDate, Worktime, ExceptionDate, ExceptionReason, QueueName

   EDIT the file path below, then run the whole script. FORMAT='CSV'
   (SQL Server 2017+) handles RFC-4180 quoting. raw is cleared per pull;
   the fact table never is (the merge is incremental and never deletes).
   ===================================================================== */
USE BPAnalytics;
GO

/* The CSV carries 16 columns; raw.WorkQueueItem has two extra provenance
   columns (SourceFile, LoadBatchId). BULK INSERT through this view so the
   column counts line up; provenance is stamped right after. */
CREATE OR ALTER VIEW raw.vw_WorkQueueItemLoad AS
SELECT ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
       LoadedDate, LastUpdatedDate, DeferredDate, LockedDate,
       CompletedDate, Worktime, ExceptionDate, ExceptionReason, QueueName
FROM raw.WorkQueueItem;
GO

DECLARE @File NVARCHAR(400) = N'C:\Data\workqueueitems.csv';   -- <-- EDIT

TRUNCATE TABLE raw.WorkQueueItem;

DECLARE @sql NVARCHAR(MAX) = N'
BULK INSERT raw.vw_WorkQueueItemLoad
FROM ''' + @File + '''
WITH (
    FORMAT          = ''CSV'',
    FIRSTROW        = 2,            -- skip the header row
    FIELDTERMINATOR = '','',
    ROWTERMINATOR   = ''0x0a'',
    CODEPAGE        = ''65001'',    -- UTF-8
    TABLOCK
);';
EXEC sys.sp_executesql @sql;

-- the file has no SourceFile/LoadBatchId columns; stamp provenance now
UPDATE raw.WorkQueueItem
SET SourceFile  = @File,
    LoadBatchId = NEWID()
WHERE SourceFile IS NULL;

PRINT 'raw rows loaded: ' + CONVERT(VARCHAR, @@ROWCOUNT);

-- type, clean, merge, report — the one call per pull
EXEC core.usp_RunPull;
GO
