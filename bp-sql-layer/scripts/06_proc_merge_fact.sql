/* =====================================================================
   06_proc_merge_fact.sql
   ---------------------------------------------------------------------
   Procedure: core.usp_MergeFact
   The heart of the pipeline. Takes the typed staging rows and brings
   core.FactWorkItem into line with them:

     - NEW items (ID not seen before)        -> INSERT
     - CHANGED items (newer LastUpdatedDate)  -> UPDATE (overwrite)
     - UNCHANGED items                        -> left alone

   WHY ID + LastUpdatedDate, NOT CompletedDate:
   An item's identity is its ID. Whether it has changed since the last
   loaded it is told by LastUpdatedDate, which moves every time the row
   changes state (pending -> completed, pending -> exception, a retry,
   etc.). CompletedDate only exists for successful items, so keying on it
   would miss exceptions and in-progress work entirely. ID + a newer
   LastUpdatedDate is the robust "this case changed, overwrite it" rule.

   Outcome and ExceptionType are derived HERE and stored on the fact, so
   Power BI imports finished values and never computes anything.

   Safe to run on every pull. Idempotent: running twice with the same
   staging data changes nothing the second time.
   ===================================================================== */
USE BPAnalytics;
GO
CREATE OR ALTER PROCEDURE core.usp_MergeFact
AS
BEGIN
    SET NOCOUNT ON;

    /* -----------------------------------------------------------------
       Build a derived set from staging: resolve the process from the
       queue map, classify the exception type from the reason patterns,
       work out the outcome, and pin the outcome date to the calendar.
       ----------------------------------------------------------------- */
    /* -----------------------------------------------------------------
       Exception classification, in order of preference:

       1. EXPLICIT PREFIX (best practice). If the exception reason begins
          with a standard token the process emitted at source, trust it.
          Recognised prefixes (case-insensitive, optional trailing colon):
            "Business Exception"  -> Business
            "System Exception"    -> System
          This is deterministic and needs no pattern maintenance. New
          exception types classify correctly the moment the process emits
          the prefix. See runbook for the convention and how to retrofit
          existing processes / historic data.

       2. PATTERN FALLBACK. For exceptions not yet prefixed, match against
          core.RefExceptionType. This is the transitional mechanism; as
          processes adopt the prefix the patterns matter less and the list
          shrinks toward zero.

       3. DEFAULT. Anything still unclassified defaults to Business.
       ----------------------------------------------------------------- */
    ;WITH ExcPrefix AS (
        -- explicit prefix emitted at source (preferred)
        SELECT s.ID,
               CASE
                   WHEN s.ExceptionReason LIKE 'Business Exception%' THEN 'Business'
                   WHEN s.ExceptionReason LIKE 'System Exception%'   THEN 'System'
                   ELSE NULL
               END AS ExceptionType
        FROM staging.WorkQueueItem s
        WHERE s.ExceptionDate IS NOT NULL
    ),
    ExcClass AS (
        -- pattern fallback: highest-priority matching pattern per staging row
        SELECT s.ID,
               et.ExceptionType,
               ROW_NUMBER() OVER (
                   PARTITION BY s.ID
                   ORDER BY et.Priority DESC, LEN(et.MatchPattern) DESC
               ) AS rn
        FROM staging.WorkQueueItem s
        JOIN core.RefExceptionType et
          ON s.ExceptionDate IS NOT NULL
         AND s.ExceptionReason LIKE et.MatchPattern
    ),
    Derived AS (
        SELECT
            s.ID,
            s.QueueName,
            qm.ProcessId,
            s.KeyValue,
            s.Resource,
            s.Attempt,
            s.Tags,
            s.Priority,
            s.LoadedDate,
            s.LastUpdatedDate,
            s.CompletedDate,
            s.ExceptionDate,
            s.Worktime,
            CASE
                WHEN s.CompletedDate IS NOT NULL THEN 'Completed'
                WHEN s.ExceptionDate IS NOT NULL THEN 'Exception'
                ELSE 'Pending'
            END AS Outcome,
            CASE
                WHEN s.ExceptionDate IS NULL THEN NULL
                -- prefer explicit prefix, then pattern, then default Business
                ELSE COALESCE(ep.ExceptionType, ec.ExceptionType, 'Business')
            END AS ExceptionType,
            s.ExceptionReason,
            CONVERT(INT, FORMAT(
                COALESCE(s.CompletedDate, s.ExceptionDate, s.LoadedDate), 'yyyyMMdd'
            )) AS OutcomeDateKey
        FROM staging.WorkQueueItem s
        LEFT JOIN core.RefQueueMap qm ON qm.QueueName = s.QueueName
        LEFT JOIN ExcPrefix ep ON ep.ID = s.ID
        LEFT JOIN ExcClass ec ON ec.ID = s.ID AND ec.rn = 1
    )
    MERGE core.FactWorkItem AS tgt
    USING Derived AS src
       ON tgt.ID = src.ID

    WHEN MATCHED
         -- only overwrite when the incoming row is genuinely newer
         AND src.LastUpdatedDate > tgt.LastUpdatedDate
    THEN UPDATE SET
        tgt.QueueName       = src.QueueName,
        tgt.ProcessId       = src.ProcessId,
        tgt.KeyValue        = src.KeyValue,
        tgt.Resource        = src.Resource,
        tgt.Attempt         = src.Attempt,
        tgt.Tags            = src.Tags,
        tgt.Priority        = src.Priority,
        tgt.LoadedDate      = src.LoadedDate,
        tgt.LastUpdatedDate = src.LastUpdatedDate,
        tgt.CompletedDate   = src.CompletedDate,
        tgt.ExceptionDate   = src.ExceptionDate,
        tgt.Worktime        = src.Worktime,
        tgt.Outcome         = src.Outcome,
        tgt.ExceptionType   = src.ExceptionType,
        tgt.ExceptionReason = src.ExceptionReason,
        tgt.OutcomeDateKey  = src.OutcomeDateKey,
        tgt.LastMergedAt    = SYSUTCDATETIME()

    WHEN NOT MATCHED BY TARGET
    THEN INSERT (
        ID, QueueName, ProcessId, KeyValue, Resource, Attempt, Tags, Priority,
        LoadedDate, LastUpdatedDate, CompletedDate, ExceptionDate, Worktime,
        Outcome, ExceptionType, ExceptionReason, OutcomeDateKey,
        FirstLoadedAt, LastMergedAt
    )
    VALUES (
        src.ID, src.QueueName, src.ProcessId, src.KeyValue, src.Resource,
        src.Attempt, src.Tags, src.Priority, src.LoadedDate, src.LastUpdatedDate,
        src.CompletedDate, src.ExceptionDate, src.Worktime, src.Outcome,
        src.ExceptionType, src.ExceptionReason, src.OutcomeDateKey,
        SYSUTCDATETIME(), SYSUTCDATETIME()
    );
    -- NOTE: deliberately NO "WHEN NOT MATCHED BY SOURCE DELETE". A given
    -- pull may be one queue's file, so the absence of an item from this
    -- batch does not mean it's gone. The merge never deletes. Removal,
    -- if ever needed, is a separate, deliberate housekeeping job.

    RETURN;
END
GO
