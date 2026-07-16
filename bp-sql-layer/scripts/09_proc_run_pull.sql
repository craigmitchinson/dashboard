/* =====================================================================
   09_proc_run_pull.sql
   ---------------------------------------------------------------------
   Procedure: core.usp_RunPull
   The single call made on every data pull. It runs staging load then
   the merge, in order, and reports what changed. The scheduled job
   (SQL Agent, ADF, or a manual run after dropping files) calls it.

   This procedure is ingest-agnostic. Whatever populated raw.WorkQueueItem
   (Path A: queue files loaded from the shared drive, or Path B: a pull
   from the Blue Prism work queue API), the steps from raw onward are the
   same. See the runbook, section 3, for both ingest paths.

   Sequence each pull:
     1. Populate raw.WorkQueueItem (Path A BULK INSERT of the queue files,
        or Path B API pull). QueueName must be set so the mapping resolves.
     2. EXEC core.usp_RunPull;   <-- this proc
   ===================================================================== */
USE BPAnalytics;
GO
CREATE OR ALTER PROCEDURE core.usp_RunPull
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @before INT = (SELECT COUNT(*) FROM core.FactWorkItem);

    EXEC staging.usp_LoadStaging;
    EXEC core.usp_MergeFact;

    DECLARE @after INT = (SELECT COUNT(*) FROM core.FactWorkItem);
    DECLARE @staged INT = (SELECT COUNT(*) FROM staging.WorkQueueItem);

    PRINT 'Pull complete.';
    PRINT '  staged rows this pull : ' + CONVERT(VARCHAR, @staged);
    PRINT '  new items inserted    : ' + CONVERT(VARCHAR, @after - @before);
    PRINT '  fact total now        : ' + CONVERT(VARCHAR, @after);

    -- flag any queue in the data that has no mapping, so it never silently
    -- drops out of the dashboard
    IF EXISTS (
        SELECT 1 FROM core.FactWorkItem f
        LEFT JOIN core.RefQueueMap qm ON qm.QueueName = f.QueueName
        WHERE qm.QueueName IS NULL
    )
    BEGIN
        PRINT '  WARNING: unmapped queues present, add them to core.RefQueueMap:';
        SELECT DISTINCT f.QueueName AS UnmappedQueue
        FROM core.FactWorkItem f
        LEFT JOIN core.RefQueueMap qm ON qm.QueueName = f.QueueName
        WHERE qm.QueueName IS NULL;
    END

    RETURN;
END
GO
