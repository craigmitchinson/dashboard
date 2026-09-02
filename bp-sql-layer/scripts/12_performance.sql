/* =====================================================================
   12_performance.sql
   ---------------------------------------------------------------------
   Scale hardening for core.FactWorkItem at 50-100M rows, per
   PLAYBOOK.md section 8. Idempotent: every change below is guarded by
   an existence check, safe to re-run on a fresh 04_fact_and_calendar.sql
   table or on one that already has these objects.

   WHAT'S HERE, IN ORDER:
     1. A NONCLUSTERED COLUMNSTORE INDEX on core.FactWorkItem (the design
        decision, and why NOT a clustered columnstore, explained below).
     2. Supporting nonclustered ROWSTORE indexes for the report views'
        actual predicates/joins (Resource, LastUpdatedDate) that scripts
        01-04 didn't already cover.
     3. A review of core.usp_MergeFact (06_proc_merge_fact.sql) for
        function-wrapped join/filter columns -- the classic index-killing
        anti-pattern -- with the finding documented, not just asserted.
     4. OPTIONAL, COMMENTED-OUT partition function/scheme DDL for
        core.FactWorkItem, partitioned by OutcomeDateKey month, plus the
        migration path to actually apply it to a live, populated table.
     5. Statistics/maintenance notes (this file does not schedule
        anything -- Cloud SQL manages its own SQL Server Agent-equivalent
        differently, see the notes).

   ===================================================================== */
USE BPAnalytics;
GO

/* =====================================================================
   1. COLUMNSTORE INDEX -- design decision

   core.FactWorkItem's existing clustered index IS its PRIMARY KEY on ID
   (NVARCHAR(100), see 04_fact_and_calendar.sql) -- a natural-key rowstore
   clustered index. Two designs were considered for 50-100M rows:

     (a) CLUSTERED COLUMNSTORE INDEX (CCI), replacing the rowstore PK
         entirely. This gives the best possible compression and scan
         speed for the report.vw_* aggregation queries, but:
           - a table with a CCI cannot also have a traditional PRIMARY
             KEY / UNIQUE constraint enforced inline -- SQL Server allows
             a nonclustered rowstore index for uniqueness alongside a CCI,
             but core.usp_MergeFact's MERGE ... ON tgt.ID = src.ID upsert
             (the pipeline's single most latency-sensitive operation,
             run on EVERY pull) is a point-lookup/point-update workload --
             exactly what columnstore is worst at. Columnstore is
             optimized for bulk, batch-mode analytical scans; row-by-row
             (or small-batch) MERGE upserts against a CCI are markedly
             slower than against a rowstore B-tree, because an update to
             a compressed columnstore rowgroup does a delete-and-reinsert
             into the CCI's delta store, and delta-store fragmentation
             from many small merges then needs its own tuple-mover/
             REORGANIZE maintenance to control.
           - this pipeline's write pattern (a MERGE upsert every 15
             minutes, per PLAYBOOK.md section 5's scheduling guidance) is
             frequent small-batch OLTP-shaped writes, not a periodic bulk
             analytical load -- the opposite of a CCI's sweet spot.

     (b) KEEP the rowstore PK (fast MERGE upserts by ID unchanged) and ADD
         a NONCLUSTERED COLUMNSTORE INDEX (NCCI) covering the columns the
         report.vw_* views actually aggregate over. A NCCI supports
         real-time operational analytics: SQL Server maintains it
         incrementally alongside normal rowstore DML (the "delta store"
         absorbs new/changed rows and the columnstore compresses them in
         the background), so core.usp_MergeFact's upsert pattern is
         untouched, while report.vw_DailyOutcomes / vw_FactItemEconomics /
         vw_Commercial* and friends -- which scan and GROUP BY across
         millions of fact rows -- get columnstore batch-mode execution
         and compression on read.

   DECISION: (b), the pragmatic choice the task brief anticipated. This
   is the same trade-off Microsoft's own guidance describes for "hybrid
   transactional/analytical processing" (HTAP) tables: keep the rowstore
   clustered index for the OLTP-shaped write path, add a nonclustered
   columnstore index for the analytical read path. Re-evaluate a CCI only
   if the merge cadence moves to infrequent, large, batch-shaped loads
   (e.g. once-daily bulk loads instead of a 15-minute delta cadence).

   COLUMN LIST: every column report.vw_* actually reads from
   core.FactWorkItem (per 08_report_views.sql), EXCLUDING the two
   housekeeping timestamps (FirstLoadedAt/LastMergedAt) that no view
   selects, filters, or groups by -- narrower columnstore = better
   compression and fewer bytes scanned per query.
   ===================================================================== */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'NCCI_FactWorkItem_Report' AND object_id = OBJECT_ID('core.FactWorkItem')
)
BEGIN
    CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_FactWorkItem_Report
    ON core.FactWorkItem (
        ID, QueueName, ProcessId, KeyValue, Resource, Attempt, Tags, Priority,
        LoadedDate, LastUpdatedDate, CompletedDate, ExceptionDate, Worktime,
        Outcome, ExceptionType, ExceptionReason, OutcomeDateKey
    );
END
GO

/* =====================================================================
   2. SUPPORTING ROWSTORE INDEXES

   04_fact_and_calendar.sql already covers IX_Fact_ProcessId,
   IX_Fact_OutcomeDateKey and IX_Fact_Outcome. Two predicates the report
   views and the merge lean on are still unindexed:

     - Resource: report.vw_ResourceUtil and report.vw_ResourceActivity
       both filter/join on f.Resource (JOIN core.RefResource r ON
       r.ResourceName = f.Resource, and a non-blank filter). At 50-100M
       rows this is a full scan today.
     - LastUpdatedDate: not a report-view predicate (the views key off
       OutcomeDateKey, which is derived FROM LastUpdatedDate-adjacent
       columns at merge time, not the column itself) -- but it IS what a
       future incremental-refresh / "what changed since X" query against
       core.FactWorkItem would filter on (see PLAYBOOK.md section 8's
       "aggregate refresh today is a full rebuild" gap), and it costs
       little to add now while the table is still small.

   NOTE ON core.usp_MergeFact's MERGE join: ON tgt.ID = src.ID is already
   index-friendly (ID is the clustered PK on both sides conceptually --
   staging.WorkQueueItem has IX_staging_ID, core.FactWorkItem's PK IS its
   clustered index) and is NOT touched here; see section 3 below for the
   full anti-pattern review.
   ===================================================================== */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Fact_Resource' AND object_id = OBJECT_ID('core.FactWorkItem')
)
    CREATE INDEX IX_Fact_Resource ON core.FactWorkItem (Resource);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Fact_LastUpdatedDate' AND object_id = OBJECT_ID('core.FactWorkItem')
)
    CREATE INDEX IX_Fact_LastUpdatedDate ON core.FactWorkItem (LastUpdatedDate);
GO

/* =====================================================================
   3. core.usp_MergeFact ANTI-PATTERN REVIEW (06_proc_merge_fact.sql)

   Reviewed every join and filter predicate in the MERGE for a
   function-wrapped column (e.g. CONVERT(x) = y, or LTRIM(col) = value),
   which silently defeats an index by forcing a scan. Findings:

     - MERGE ... ON tgt.ID = src.ID                 -- bare column both
                                                        sides. CLEAN.
     - WHEN MATCHED AND src.LastUpdatedDate >
       tgt.LastUpdatedDate                          -- bare column
                                                        comparison, and it
                                                        only runs against
                                                        rows the join
                                                        ABOVE already
                                                        matched (one row
                                                        per staged ID, at
                                                        most one pull's
                                                        worth of rows) --
                                                        not a scan
                                                        predicate over the
                                                        whole fact table.
                                                        CLEAN.
     - LEFT JOIN core.RefQueueMap qm
         ON qm.QueueName = s.QueueName               -- bare column both
                                                        sides; RefQueueMap
                                                        is PK'd on
                                                        QueueName.
                                                        CLEAN.
     - s.ExceptionReason LIKE et.MatchPattern         -- NOT a
                                                        function-wrapped
                                                        column, but a
                                                        pattern match
                                                        where the pattern
                                                        itself is
                                                        data-driven
                                                        (core.RefExceptionType
                                                        .MatchPattern, a
                                                        '%wildcard%'
                                                        string), so no
                                                        index can seek it
                                                        regardless of how
                                                        it's written --
                                                        this is inherent
                                                        to "classify free
                                                        text by pattern",
                                                        not a fixable
                                                        anti-pattern. Its
                                                        cost is bounded by
                                                        staging row count
                                                        (one pull's worth,
                                                        truncated every
                                                        pull) x
                                                        RefExceptionType
                                                        row count (a small,
                                                        human-curated
                                                        table, per
                                                        03_core_dimensions.sql's
                                                        comment that this
                                                        list should shrink
                                                        toward zero as
                                                        processes adopt
                                                        the prefix
                                                        convention) --
                                                        negligible even at
                                                        50-100M fact rows,
                                                        because staging
                                                        (the left side of
                                                        this join) is
                                                        scoped to one
                                                        pull's file, never
                                                        the whole history.

   CONCLUSION: no function-wrapped join/filter column anti-pattern found.
   No change made to 06_proc_merge_fact.sql. Note that the two indexes
   added in section 2 (Resource, LastUpdatedDate) have nothing to do with
   the merge itself -- the merge's own join columns were already indexed
   correctly by 02/04.
   ===================================================================== */

/* =====================================================================
   4. PARTITIONING BY OutcomeDateKey MONTH -- OPTIONAL, NOT APPLIED

   VERIFIED: table partitioning (CREATE PARTITION FUNCTION/SCHEME) has
   been available in EVERY SQL Server edition (Standard, Web, Express, as
   well as Enterprise) since SQL Server 2016 SP1 -- it is no longer an
   Enterprise-only feature. Cloud SQL for SQL Server's supported engine
   versions (2017, 2019, 2022, 2025) are all >= 2016 SP1, and Cloud SQL's
   own Enterprise-tier "Standard"/"Web"/"Express" DB editions are all
   built on that same >=2016 SP1 codebase, so partitioning itself is not
   edition-gated here. (Sources: Microsoft's SQL Server 2016 SP1
   announcement of parity for previously Enterprise-only engine features
   including partitioning; Cloud SQL's documented supported SQL Server
   versions/editions.) The one edition-gated nuance that DOES survive
   post-2016-SP1: partitioned-table PARALLELISM (parallel query execution
   across partitions) is still an Enterprise-only optimization -- Standard/
   Web/Express partition correctly, just without that specific query
   speed-up. Cloud SQL's own storage ceiling (64 TB per instance) is the
   more binding scale constraint than partitioning-by-edition ever is.

   THIS IS STILL LEFT COMMENTED OUT AND UNAPPLIED, for a different reason
   than edition support: core.FactWorkItem is a LIVE, POPULATED table by
   the time you'd reach for this (the point of adding it is precisely
   when it's grown large), and partitioning an existing populated table
   is a real migration (create the partition function/scheme, then either
   rebuild every index WITH (DROP_EXISTING = ON, ...) against the new
   scheme, or -- cleaner at 50-100M rows -- build a new partitioned table
   and switch data in with SWITCH PARTITION), not a one-line ALTER. Also,
   the columnstore index from section 1 must be PARTITION-ALIGNED with
   the base table (same partitioning column, same scheme) once you
   partition -- rebuild NCCI_FactWorkItem_Report after partitioning, not
   before. Uncomment and adapt when core.FactWorkItem's row count and
   report-view query latency justify the migration effort (PLAYBOOK.md
   section 8's "signs you've outgrown static JSON" checklist is the
   trigger to reassess, not a fixed row-count number).

   -- Monthly ranges, RIGHT boundary (each boundary value is the FIRST
   -- day belonging to the NEXT partition) -- extend @Boundaries as your
   -- calendar grows, same pattern as DimCalendar's @EndDate.
   -- CREATE PARTITION FUNCTION PF_OutcomeDateKey_Monthly (INT)
   --     AS RANGE RIGHT FOR VALUES (
   --         20230201, 20230301, 20230401, 20230501, 20230601, 20230701,
   --         20230801, 20230901, 20231001, 20231101, 20231201,
   --         20240101, 20240201, 20240301, 20240401, 20240501, 20240601,
   --         20240701, 20240801, 20240901, 20241001, 20241101, 20241201,
   --         20250101, 20250201, 20250301, 20250401, 20250501, 20250601,
   --         20250701, 20250801, 20250901, 20251001, 20251101, 20251201,
   --         20260101, 20260201, 20260301, 20260401, 20260501, 20260601,
   --         20260701, 20260801, 20260901, 20261001, 20261101, 20261201,
   --         20270101
   --         -- extend one boundary per future month before it arrives;
   --         -- an unpartitioned "overflow" range beyond the last
   --         -- boundary still works, it just stops getting its own
   --         -- partition, so keep this ahead of DimCalendar's @EndDate.
   --     );
   -- GO
   -- -- All partitions on PRIMARY here for simplicity; a real deployment
   -- -- with per-partition backup/compression policies would use one
   -- -- filegroup per partition instead -- verify your Cloud SQL for SQL
   -- -- Server instance's filegroup/storage options before doing that
   -- -- (Cloud SQL manages the underlying storage; confirm custom
   -- -- filegroup-to-disk mapping is actually meaningful there before
   -- -- investing in it, rather than assuming on-prem SQL Server norms
   -- -- carry over unchanged).
   -- CREATE PARTITION SCHEME PS_OutcomeDateKey_Monthly
   --     AS PARTITION PF_OutcomeDateKey_Monthly ALL TO ([PRIMARY]);
   -- GO
   -- -- Applying this to the EXISTING core.FactWorkItem (populated table):
   -- --   1. CREATE TABLE core.FactWorkItem_Partitioned (same DDL as
   -- --      04_fact_and_calendar.sql) ON PS_OutcomeDateKey_Monthly
   -- --      (OutcomeDateKey);
   -- --   2. Rebuild its PK/indexes so the clustered PK includes
   -- --      OutcomeDateKey (a partitioned table's clustered index must
   -- --      contain the partitioning column) -- this changes the PK from
   -- --      ID alone to (ID, OutcomeDateKey) or moves to a nonclustered
   -- --      unique index on ID plus a clustered index on
   -- --      (OutcomeDateKey, ID); pick based on core.usp_MergeFact's
   -- --      lookup pattern (by ID) staying fast -- benchmark both before
   -- --      committing, this is the one step worth spending real time on.
   -- --   3. INSERT INTO core.FactWorkItem_Partitioned SELECT * FROM
   -- --      core.FactWorkItem (batched, not one giant transaction, at
   -- --      50-100M rows).
   -- --   4. Swap names (sp_rename or DROP + rename), recreate
   -- --      NCCI_FactWorkItem_Report against the new partitioned table
   -- --      (partition-aligned automatically since it's the same base
   -- --      table).
   -- --   5. Point every core.* / report.* / staging.* object that
   -- --      references core.FactWorkItem at the new table -- it's the
   -- --      same name after the swap, so nothing downstream should need
   -- --      editing, but verify with sys.sql_expression_dependencies
   -- --      before declaring victory.
   ===================================================================== */

/* =====================================================================
   5. STATISTICS / MAINTENANCE NOTES (informational -- nothing scheduled
   by this script)

   - Cloud SQL for SQL Server has AUTO_CREATE_STATISTICS and
     AUTO_UPDATE_STATISTICS on by default, same as any SQL Server
     database; at 50-100M rows with a 15-minute merge cadence, consider
     an explicit UPDATE STATISTICS ... WITH FULLSCAN on core.FactWorkItem
     on a slower cadence (e.g. nightly) once auto-stats' default sampling
     rate stops keeping the query optimizer's row estimates accurate for
     the report views' joins -- watch for this via
     sys.dm_db_stats_properties, not by guessing.
   - Cloud SQL for SQL Server does NOT expose SQL Server Agent (no
     traditional Agent jobs) -- there is no on-box scheduler to hang a
     maintenance job off. Two supported ways to run a periodic
     maintenance script (index REORGANIZE/REBUILD, UPDATE STATISTICS)
     against Cloud SQL for SQL Server: (a) the same Cloud Scheduler ->
     Cloud Run Job pattern this file's sibling ingest job uses, pointed
     at a maintenance .sql script instead of the pipeline, or (b) Cloud
     SQL's own built-in "maintenance window" setting only covers Cloud
     SQL's own OS/engine patching, NOT ad hoc index maintenance --
     verify current Cloud SQL for SQL Server documentation before relying
     on any built-in job runner beyond that, since this is exactly the
     kind of platform detail that changes between GA announcements.
   - A NONCLUSTERED COLUMNSTORE INDEX's delta store benefits from an
     explicit ALTER INDEX ... REORGANIZE periodically (compresses
     accumulated delta-store rowgroups into the compressed columnstore)
     rather than waiting solely on the automatic tuple-mover background
     thread, especially right after the initial historical backfill (see
     PLAYBOOK.md section 8's backfill guidance) lands a very large batch
     into the delta store at once.
   ===================================================================== */
