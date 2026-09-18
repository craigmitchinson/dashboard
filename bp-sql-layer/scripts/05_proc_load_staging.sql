/* =====================================================================
   05_proc_load_staging.sql
   ---------------------------------------------------------------------
   Procedure: staging.usp_LoadStaging
   Takes whatever is in raw.WorkQueueItem and produces a typed, cleaned
   copy in staging.WorkQueueItem. This is the ONE place dates and numbers
   get parsed, so nothing downstream re-parses.

   It is safe to re-run. It clears staging and rebuilds it from raw.

   VALIDATION / QUARANTINE (see raw.WorkQueueItemRejected in
   11_pipeline_ops.sql): every raw row is judged against the checks below,
   IN ORDER, and gets exactly ONE outcome -- the FIRST matching reason it
   fails wins, and a row failing any check lands in
   raw.WorkQueueItemRejected instead of staging.WorkQueueItem (never both,
   never neither -- every raw row is accounted for in one place or the
   other). This replaces the previous behaviour of silently EXCLUDING a
   blank-ID row (a plain WHERE filter, no record kept of what was
   dropped or why) and silently ACCEPTING a row with an unparseable date/
   number as a quiet NULL (TRY_CONVERT's normal behaviour, kept for every
   OTHER column that was never validated -- see below).

     1. blank ID                    -- ID NULL or blank after trim
     2. unparseable LoadedDate      -- non-blank raw value, TRY_CONVERT NULL
     3. unparseable LastUpdatedDate -- ditto
     4. unparseable CompletedDate   -- ditto
     5. unparseable ExceptionDate   -- ditto
     6. unparseable DeferredDate    -- ditto
     7. unparseable LockedDate      -- ditto
     8. non-integer Worktime        -- non-blank raw value, TRY_CONVERT NULL
     9. negative Worktime           -- parses fine, but < 0
    10. non-integer Attempt         -- non-blank raw value, TRY_CONVERT NULL
    11. unknown Status              -- non-blank, not one of the known values

   A BLANK date/Worktime/Attempt/Status is NOT an error -- e.g. an item
   still in flight legitimately has no CompletedDate yet. Only a
   NON-BLANK value that fails to parse (or a negative Worktime) is a
   quarantine reason. Priority/KeyValue/Tags/Resource/QueueName/
   ExceptionReason are NOT validated here (as before) -- TRY_CONVERT-ing
   Priority still silently NULLs a bad value, matching the original,
   narrower contract; only the columns explicitly called out above gate
   whether the whole row is accepted.

   KNOWN STATUS VALUES: Blue Prism's WorkQueueItem.Status is optional/
   free text in general; this estate's processes only ever emit one of
   the values below (or leave it blank -- also fine, not "unknown").
   Extend this list (not the meaning of the reject reason) if a
   genuinely new status is adopted upstream.

   PARITY GUARANTEE: for every row that IS accepted, the exact same
   TRY_CONVERT/LTRIM/RTRIM/NULLIF expressions this procedure has always
   used are applied, unchanged -- validation only decides WHETHER a row
   reaches staging, never HOW its accepted values are computed.
   ===================================================================== */
USE BPAnalytics;
GO
CREATE OR ALTER PROCEDURE staging.usp_LoadStaging
AS
BEGIN
    SET NOCOUNT ON;

    TRUNCATE TABLE staging.WorkQueueItem;

    DECLARE @KnownStatus TABLE (Status NVARCHAR(100) NOT NULL PRIMARY KEY);
    INSERT INTO @KnownStatus (Status) VALUES
        (N'Pending'), (N'Locked'), (N'Completed'), (N'Exception'), (N'Deferred'), (N'Skipped');

    -- Materialised once (not re-declared per statement) so both the reject
    -- insert and the accepted-row insert below see IDENTICAL RejectReason
    -- values for each raw row -- a temp table, not a CTE, because a CTE's
    -- scope ends with the single statement that follows it in T-SQL.
    IF OBJECT_ID('tempdb..#Validated') IS NOT NULL DROP TABLE #Validated;

    SELECT
        r.ID, r.KeyValue, r.Priority, r.Status, r.Tags, r.Resource, r.Attempt,
        r.LoadedDate, r.LastUpdatedDate, r.DeferredDate, r.LockedDate,
        r.CompletedDate, r.Worktime, r.ExceptionDate, r.ExceptionReason,
        r.QueueName, r.SourceFile, r.LoadBatchId,
        CASE
            WHEN r.ID IS NULL OR LTRIM(RTRIM(r.ID)) = N''
                THEN N'blank ID'
            WHEN NULLIF(LTRIM(RTRIM(r.LoadedDate)), N'') IS NOT NULL
                 AND TRY_CONVERT(DATETIME2(0), r.LoadedDate) IS NULL
                THEN N'unparseable LoadedDate'
            WHEN NULLIF(LTRIM(RTRIM(r.LastUpdatedDate)), N'') IS NOT NULL
                 AND TRY_CONVERT(DATETIME2(0), r.LastUpdatedDate) IS NULL
                THEN N'unparseable LastUpdatedDate'
            WHEN NULLIF(LTRIM(RTRIM(r.CompletedDate)), N'') IS NOT NULL
                 AND TRY_CONVERT(DATETIME2(0), r.CompletedDate) IS NULL
                THEN N'unparseable CompletedDate'
            WHEN NULLIF(LTRIM(RTRIM(r.ExceptionDate)), N'') IS NOT NULL
                 AND TRY_CONVERT(DATETIME2(0), r.ExceptionDate) IS NULL
                THEN N'unparseable ExceptionDate'
            WHEN NULLIF(LTRIM(RTRIM(r.DeferredDate)), N'') IS NOT NULL
                 AND TRY_CONVERT(DATETIME2(0), r.DeferredDate) IS NULL
                THEN N'unparseable DeferredDate'
            WHEN NULLIF(LTRIM(RTRIM(r.LockedDate)), N'') IS NOT NULL
                 AND TRY_CONVERT(DATETIME2(0), r.LockedDate) IS NULL
                THEN N'unparseable LockedDate'
            WHEN NULLIF(LTRIM(RTRIM(r.Worktime)), N'') IS NOT NULL
                 AND TRY_CONVERT(INT, r.Worktime) IS NULL
                THEN N'non-integer Worktime'
            WHEN TRY_CONVERT(INT, r.Worktime) < 0
                THEN N'negative Worktime'
            WHEN NULLIF(LTRIM(RTRIM(r.Attempt)), N'') IS NOT NULL
                 AND TRY_CONVERT(INT, r.Attempt) IS NULL
                THEN N'non-integer Attempt'
            WHEN NULLIF(LTRIM(RTRIM(r.Status)), N'') IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM @KnownStatus k WHERE k.Status = LTRIM(RTRIM(r.Status)))
                THEN N'unknown Status'
            ELSE NULL
        END AS RejectReason
    INTO #Validated
    FROM raw.WorkQueueItem r;

    INSERT INTO raw.WorkQueueItemRejected (
        ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
        LoadedDate, LastUpdatedDate, DeferredDate, LockedDate,
        CompletedDate, Worktime, ExceptionDate, ExceptionReason,
        QueueName, SourceFile, LoadBatchId, RejectReason
    )
    SELECT
        ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
        LoadedDate, LastUpdatedDate, DeferredDate, LockedDate,
        CompletedDate, Worktime, ExceptionDate, ExceptionReason,
        QueueName, SourceFile, LoadBatchId, RejectReason
    FROM #Validated
    WHERE RejectReason IS NOT NULL;

    INSERT INTO staging.WorkQueueItem (
        ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
        LoadedDate, LastUpdatedDate, DeferredDate, LockedDate,
        CompletedDate, Worktime, ExceptionDate, ExceptionReason,
        QueueName, LoadBatchId
    )
    SELECT
        LTRIM(RTRIM(ID)),
        NULLIF(LTRIM(RTRIM(KeyValue)), ''),
        TRY_CONVERT(INT, Priority),
        NULLIF(LTRIM(RTRIM(Status)), ''),
        NULLIF(LTRIM(RTRIM(Tags)), ''),
        NULLIF(LTRIM(RTRIM(Resource)), ''),
        TRY_CONVERT(INT, Attempt),
        -- TRY_CONVERT returns NULL on a bad date rather than failing the load.
        -- style 120/121 handles 'yyyy-mm-dd hh:mi:ss'. If the export uses
        -- UK 'dd/mm/yyyy', change these to style 103/105 (see runbook).
        TRY_CONVERT(DATETIME2(0), LoadedDate),
        TRY_CONVERT(DATETIME2(0), LastUpdatedDate),
        TRY_CONVERT(DATETIME2(0), DeferredDate),
        TRY_CONVERT(DATETIME2(0), LockedDate),
        TRY_CONVERT(DATETIME2(0), CompletedDate),
        TRY_CONVERT(INT, Worktime),
        TRY_CONVERT(DATETIME2(0), ExceptionDate),
        NULLIF(LTRIM(RTRIM(ExceptionReason)), ''),
        NULLIF(LTRIM(RTRIM(QueueName)), ''),
        LoadBatchId
    FROM #Validated
    WHERE RejectReason IS NULL;

    DROP TABLE #Validated;

    -- A row with no LastUpdatedDate can't be change-detected. Fall back to
    -- the most recent meaningful timestamp so the merge still works.
    UPDATE staging.WorkQueueItem
    SET LastUpdatedDate = COALESCE(
        LastUpdatedDate, CompletedDate, ExceptionDate, LockedDate, LoadedDate
    )
    WHERE LastUpdatedDate IS NULL;

    RETURN;
END
GO
