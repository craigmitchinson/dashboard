/* =====================================================================
   10_bulk_load_csv.sql
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
