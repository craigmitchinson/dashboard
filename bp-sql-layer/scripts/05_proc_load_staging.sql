/* =====================================================================
   05_proc_load_staging.sql
   ---------------------------------------------------------------------
   Procedure: staging.usp_LoadStaging
   Takes whatever is in raw.WorkQueueItem and produces a typed, cleaned
   copy in staging.WorkQueueItem. This is the ONE place dates and numbers
   get parsed, so nothing downstream re-parses.

   It is safe to re-run. It clears staging and rebuilds it from raw.
   ===================================================================== */
USE BPAnalytics;
GO
CREATE OR ALTER PROCEDURE staging.usp_LoadStaging
AS
BEGIN
    SET NOCOUNT ON;

    TRUNCATE TABLE staging.WorkQueueItem;

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
    FROM raw.WorkQueueItem
    WHERE ID IS NOT NULL AND LTRIM(RTRIM(ID)) <> '';   -- drop junk/blank rows

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
