/* =====================================================================
   13_api_model_views.sql
   ---------------------------------------------------------------------
   Views + tables that back the dashboard's PRODUCTION DATA API
   (server/ in the dashboard repo), on top of the views 08_report_views.sql
   already defines. Two things live here:

     1. The "vw_Model*" views — one per field of ModelJson's compact,
        client-aggregated shape (src/rpaData.ts) that ISN'T already
        served, verbatim, by an existing report.vw_Dim*/vw_EstateRateByDate
        view. shared/model-assembler.mjs is the single place that turns
        these rows (or their JSON fixture twins under
        public/data/views/vw_Model*.json) into the exact ModelJson the SPA
        consumes — a change to a derivation here is a change there.

     2. core.RefAppSettings / core.RefVersion / core.RefChangeLog — SQL
        homes for the four reference sections that have never had a table
        (targets, thresholdOverrides, exceptionDisplayCodes,
        vdiOperatingHoursPerDay — see src/reference/reference-store.ts's
        ReferenceJson) plus optimistic-concurrency + audit for the API's
        PUT /api/reference. UNLIKE every Ref* DIMENSION table in
        03_core_dimensions.sql (which the CSV pipeline fully DROPs and
        REBUILDs from data/reference/reference.json on every run), these
        three hold LIVE STATE the dashboard's own API server writes —
        re-running this script must never discard a hub lead's or admin's
        saved edit, so they use CREATE-IF-NOT-EXISTS + seed-IF-EMPTY
        instead of the pipeline's destructive DROP+CREATE pattern. This is
        a deliberate, necessary departure from this file's siblings, not
        an oversight.

   WHY THESE PARTICULAR ROWS AREN'T JUST NEW REPORT.VW_DIM* VIEWS: the
   ModelJson dimension arrays (spokes/propositions/processes/resources)
   carry a few fields the EXISTING report.vw_DimProcess/vw_DimResource
   views (08_report_views.sql, owned elsewhere, not edited here) don't
   expose — Queues on a process, RenewalDate/AnnualCostGBP/
   LicenseExpiryDate/Status on a resource (Icon/Tags on a process are now
   first-class core.RefProcess columns — see 03_core_dimensions.sql — but
   are still attached the same way, below, rather than added to
   vw_DimProcess, since that view is Power BI-facing and the API's
   dimension arrays are assembled from `reference`, not the dim views). The
   API server attaches these directly from core.RefProcess/
   core.RefQueueMap/core.RefResource alongside the existing dim views,
   exactly as tools/build-dashboard-data.mjs attaches them from
   reference.json's own processes/resources — see shared/model-
   assembler.mjs's header comment for the full contract and
   server/README.md for the server-side query shape. estateRateByDate
   needs no new view at all: report.vw_EstateRateByDate already carries
   everything (Date, EstateCostPerDayGBP, WorkingDaysPerYear,
   ProductiveHoursPerDay) that model.estateRateByDate needs.

   View inventory (new in this file):
     report.fn_ModelDisplayReason      strips the Business/System Exception:
                                        prefix from a raw ExceptionReason —
                                        twin of build-dashboard-data.mjs's
                                        displayReason()
     report.vw_ModelDayRows            -> ModelJson.dayRows      (d,p,c,b,s,n,w,cw,gb,ec)
     report.vw_ModelExcRows            -> ModelJson.excRows      (d,p,r,t,n,w)
     report.vw_ModelResRows            -> ModelJson.resRows      (d,r,p,n,e,w,ec)
     report.vw_ModelDayWorktimeTotals      -> ModelJson.dayWorktimeTotals       (d,w)
     report.vw_ModelSpokeDayWorktimeTotals -> ModelJson.spokeDayWorktimeTotals  (SpokeName,d,w)
     report.vw_ModelResourceActivity   -> ModelJson.resourceActivity  (ResourceName,FirstSeen,LastSeen,Items,SpokesServed)
     report.vw_ModelMeta               -> ModelJson.meta.{sourceRows,dateMin,dateMax}
     report.vw_ModelUnmappedQueues     -> ModelJson.meta.unmappedQueues
     report.vw_ModelExceptionReasons   -> ModelJson.exceptionReasons (Reason,ExceptionType; `code` is derived
                                          app-side from core.RefAppSettings's 'exceptionDisplayCodes' document)
     core.RefAppSettings               -> ModelJson.targets / .thresholdOverrides (via reference.thresholdOverrides)
                                          / .reference.exceptionDisplayCodes / .vdiOperatingHoursPerDay
     core.RefVersion                   optimistic-concurrency token for PUT /api/reference (If-Match)
     core.RefChangeLog                 -> reference.json's changelog (ChangelogEntry[] in reference-store.ts)
     report.vw_PipelineHealth          -> GET /api/health's `lastRun` (server/src/data/sql-model.ts's
                                          getLastRun()) -- the single most recent core.PipelineRun row
                                          (11_pipeline_ops.sql), whatever its Status.
   ===================================================================== */
USE BPAnalytics;
GO

/* =====================================================================
   fn_ModelDisplayReason — strips a leading "Business Exception"/"System
   Exception" prefix (optionally followed by ':' and/or whitespace, case-
   insensitive under the database's default CI collation) from a raw
   ExceptionReason, returning '(no reason recorded)' for a blank/NULL
   input or a reason that is ENTIRELY the prefix. Byte-for-byte twin of
   tools/build-dashboard-data.mjs's displayReason():
     (reason ?? "").replace(/^(business|system) exception:?\s*/i, "") || "(no reason recorded)"
   ===================================================================== */
CREATE OR ALTER FUNCTION report.fn_ModelDisplayReason (@Reason NVARCHAR(1000))
RETURNS NVARCHAR(1000)
AS
BEGIN
    DECLARE @r NVARCHAR(1000) = LTRIM(RTRIM(COALESCE(@Reason, N'')));
    IF @r LIKE N'business exception%'
        SET @r = LTRIM(STUFF(@r, 1, LEN(N'business exception'), N''));
    ELSE IF @r LIKE N'system exception%'
        SET @r = LTRIM(STUFF(@r, 1, LEN(N'system exception'), N''));
    IF LEFT(@r, 1) = N':'
        SET @r = LTRIM(STUFF(@r, 1, 1, N''));
    IF @r = N''
        RETURN N'(no reason recorded)';
    RETURN @r;
END;
GO

/* =====================================================================
   vw_ModelDayRows — one row per (OutcomeDate, ProcessId): outcome counts,
   worktime, £gb (benefit), £ec (estate cost). Mapped items only (INNER
   JOINs all the way from vw_FactItemEconomics), matching
   build-dashboard-data.mjs's `items.filter(i => i.processId)`.
   PENDING SEMANTICS: n counts Outcome='Pending' rows (FactWorkItem items
   with neither a CompletedDate nor an ExceptionDate yet — see
   06_proc_merge_fact.sql) — NOT NULL/blank ProcessId, which is already
   excluded by the join. w is worktime over EVERY row in the group
   (Completed/Exception/Pending alike); cw is worktime over Completed rows
   only. gb/ec are rounded to 4dp, matching the Node build's `round(x,4)`.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelDayRows AS
SELECT
    cal.[Date]                                                     AS d,
    fe.ProcessId                                                   AS p,
    SUM(CASE WHEN fe.Outcome = 'Completed' THEN 1 ELSE 0 END)      AS c,
    SUM(CASE WHEN fe.ExceptionType = 'Business' THEN 1 ELSE 0 END) AS b,
    SUM(CASE WHEN fe.ExceptionType = 'System'   THEN 1 ELSE 0 END) AS s,
    SUM(CASE WHEN fe.Outcome = 'Pending' THEN 1 ELSE 0 END)        AS n,
    SUM(CAST(fe.Worktime AS BIGINT))                               AS w,
    SUM(CASE WHEN fe.Outcome = 'Completed' THEN CAST(fe.Worktime AS BIGINT) ELSE 0 END) AS cw,
    CAST(SUM(fe.BenefitGBP)    AS DECIMAL(18,4))                   AS gb,
    CAST(SUM(fe.EstateCostGBP) AS DECIMAL(18,4))                   AS ec
FROM report.vw_FactItemEconomics fe
JOIN core.DimCalendar cal ON cal.DateKey = fe.OutcomeDateKey
GROUP BY cal.[Date], fe.ProcessId;
GO

/* =====================================================================
   vw_ModelExcRows — one row per (OutcomeDate, ProcessId, display reason):
   exception volume + wasted worktime. Mapped items only, Outcome =
   'Exception' only — matches build-dashboard-data.mjs's
   `excItems.filter(i => i.processId)` grouped by date|processId|reason.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelExcRows AS
SELECT
    cal.[Date]                                AS d,
    fe.ProcessId                              AS p,
    report.fn_ModelDisplayReason(f.ExceptionReason) AS r,
    fe.ExceptionType                          AS t,
    COUNT(*)                                  AS n,
    SUM(CAST(fe.Worktime AS BIGINT))          AS w
FROM report.vw_FactItemEconomics fe
JOIN core.FactWorkItem f ON f.ID = fe.ID
JOIN core.DimCalendar cal ON cal.DateKey = fe.OutcomeDateKey
WHERE fe.Outcome = 'Exception'
GROUP BY cal.[Date], fe.ProcessId, report.fn_ModelDisplayReason(f.ExceptionReason), fe.ExceptionType;
GO

/* =====================================================================
   vw_ModelResRows — one row per (OutcomeDate, Resource, ProcessId):
   items processed, of which exceptions, worktime, apportioned estate
   cost. Mapped items with a non-blank Resource only, matching
   build-dashboard-data.mjs's `items.filter(i => i.resource && i.processId)`.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelResRows AS
SELECT
    cal.[Date]                                              AS d,
    fe.Resource                                             AS r,
    fe.ProcessId                                            AS p,
    COUNT(*)                                                AS n,
    SUM(CASE WHEN fe.Outcome = 'Exception' THEN 1 ELSE 0 END) AS e,
    SUM(CAST(fe.Worktime AS BIGINT))                        AS w,
    CAST(SUM(fe.EstateCostGBP) AS DECIMAL(18,4))            AS ec
FROM report.vw_FactItemEconomics fe
JOIN core.DimCalendar cal ON cal.DateKey = fe.OutcomeDateKey
WHERE fe.Resource IS NOT NULL AND fe.Resource <> ''
GROUP BY cal.[Date], fe.Resource, fe.ProcessId;
GO

/* =====================================================================
   vw_ModelDayWorktimeTotals — TRUE per-day worktime across ALL items,
   INCLUDING unmapped-queue rows (core.FactWorkItem raw grain, no join to
   RefProcess) — the client/API economics engine's hub-share denominator
   must match this, not a re-sum of vw_ModelDayRows, or unmapped-queue
   worktime silently inflates every mapped item's apportioned cost. See
   src/reference/economics.ts's buildRateTables and
   tools/verify-economics.mjs.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelDayWorktimeTotals AS
SELECT cal.[Date] AS d, SUM(CAST(f.Worktime AS BIGINT)) AS w
FROM core.FactWorkItem f
JOIN core.DimCalendar cal ON cal.DateKey = f.OutcomeDateKey
GROUP BY cal.[Date];
GO

/* =====================================================================
   vw_ModelSpokeDayWorktimeTotals — per-spoke daily worktime, MAPPED items
   only (a spoke can only be attributed via ProcessId -> PropositionId ->
   SpokeId), matching build-dashboard-data.mjs's `if (it.spokeId != null)`.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelSpokeDayWorktimeTotals AS
SELECT sp.SpokeName, cal.[Date] AS d, SUM(CAST(f.Worktime AS BIGINT)) AS w
FROM core.FactWorkItem f
JOIN core.RefQueueMap qm    ON qm.QueueName = f.QueueName
JOIN core.RefProcess pr     ON pr.ProcessId = qm.ProcessId
JOIN core.RefProposition pp ON pp.PropositionId = pr.PropositionId
JOIN core.RefSpoke sp       ON sp.SpokeId = pp.SpokeId
JOIN core.DimCalendar cal   ON cal.DateKey = f.OutcomeDateKey
GROUP BY sp.SpokeName, cal.[Date];
GO

/* =====================================================================
   vw_ModelResourceActivity — per-VDI FirstSeen/LastSeen/Items computed
   from ALL items (including unmapped-queue rows — a resource still "did
   work" even if its queue isn't mapped yet), deliberately NOT joined to
   core.RefResource (a resource with activity that isn't/isn't-yet a
   RefResource row still surfaces) — same convention as the existing
   report.vw_ResourceActivity in 08_report_views.sql. SpokesServed is
   every DISTINCT spoke that resource has ever served, ';'-delimited
   (spoke display names can contain a comma, e.g. "Insurance, Pensions &
   Investments", so ';' is the separator, not ','), alphabetically
   ordered by STRING_AGG's WITHIN GROUP so the API server never has to
   re-sort. Twin of build-dashboard-data.mjs's resourceActivityMap.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelResourceActivity AS
SELECT
    f.Resource AS ResourceName,
    MIN(cal.[Date]) AS FirstSeen,
    MAX(cal.[Date]) AS LastSeen,
    COUNT(*) AS Items,
    (
        SELECT STRING_AGG(x.SpokeName, ';') WITHIN GROUP (ORDER BY x.SpokeName)
        FROM (
            SELECT DISTINCT sp.SpokeName
            FROM core.FactWorkItem f2
            JOIN core.RefQueueMap qm    ON qm.QueueName = f2.QueueName
            JOIN core.RefProcess pr     ON pr.ProcessId = qm.ProcessId
            JOIN core.RefProposition pp ON pp.PropositionId = pr.PropositionId
            JOIN core.RefSpoke sp       ON sp.SpokeId = pp.SpokeId
            WHERE f2.Resource = f.Resource
        ) x
    ) AS SpokesServed
FROM core.FactWorkItem f
JOIN core.DimCalendar cal ON cal.DateKey = f.OutcomeDateKey
WHERE f.Resource IS NOT NULL AND f.Resource <> ''
GROUP BY f.Resource;
GO

/* =====================================================================
   vw_ModelMeta — single-row: total source rows and the outcome-date
   window, over ALL items (mapped + unmapped) — twin of
   build-dashboard-data.mjs's `items.length`/tsMin/tsMax.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelMeta AS
SELECT
    (SELECT COUNT(*) FROM core.FactWorkItem) AS SourceRows,
    (SELECT MIN(cal.[Date]) FROM core.FactWorkItem f JOIN core.DimCalendar cal ON cal.DateKey = f.OutcomeDateKey) AS DateMin,
    (SELECT MAX(cal.[Date]) FROM core.FactWorkItem f JOIN core.DimCalendar cal ON cal.DateKey = f.OutcomeDateKey) AS DateMax;
GO

/* =====================================================================
   vw_ModelUnmappedQueues — distinct raw queue names with no RefQueueMap
   row, i.e. queues the team hasn't mapped to a process yet. Twin of
   build-dashboard-data.mjs's `unmappedQueues` Set (and its startup
   WARNING log).
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelUnmappedQueues AS
SELECT DISTINCT f.QueueName
FROM core.FactWorkItem f
LEFT JOIN core.RefQueueMap qm ON qm.QueueName = f.QueueName
WHERE qm.QueueName IS NULL;
GO

/* =====================================================================
   vw_ModelExceptionReasons — distinct (display reason, type) pairs seen
   across EVERY exception in the estate, MAPPED OR NOT — twin of
   build-dashboard-data.mjs's reasonTypeSet, which is built by iterating
   ALL exception items with no ProcessId filter (deliberately broader than
   vw_ModelExcRows above, which IS mapped-only: an unmapped queue's
   exceptions still populate the exceptionReasons DIMENSION, just never
   an aggregated excRows fact row). `code` is NOT computed here — the API
   server/shared/model-assembler.mjs derives it from core.RefAppSettings's
   'exceptionDisplayCodes' document, falling back to an auto-generated
   3-letter initialism, exactly like the Node build.
   EDGE CASE (documented, not fixed): if the SAME display reason is ever
   raised as BOTH a Business and a System exception somewhere in the
   estate, the Node build keeps whichever type it saw FIRST in item order;
   this view (a plain DISTINCT) surfaces both pairs. In practice a display
   reason maps to exactly one type by construction (that's what the
   exception-classification patterns are for), so this has not been
   observed — flagged here rather than silently resolved one way.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ModelExceptionReasons AS
SELECT DISTINCT
    report.fn_ModelDisplayReason(f.ExceptionReason) AS Reason,
    f.ExceptionType AS ExceptionType
FROM core.FactWorkItem f
WHERE f.Outcome = 'Exception';
GO

/* =====================================================================
   core.RefAppSettings — JSON-document store for the reference sections
   that have never had a relational shape: targets, thresholdOverrides,
   exceptionDisplayCodes, vdiOperatingHoursPerDay (see
   src/reference/reference-store.ts's ReferenceJson — everything else in
   that interface already has a Ref* table from 03_core_dimensions.sql).
   One row per section; ValueJson is that section's value, JSON-encoded,
   parsed back into ReferenceJson.<key> by the API server. Seeded once
   from data/reference/reference.json's current values below; PUT
   /api/reference overwrites a row's ValueJson/UpdatedAt/UpdatedBy in
   place (no history kept — thresholdOverrides/targets edits are a
   config surface, not an audited rate card; core.RefChangeLog below is
   the audit trail of WHICH SECTION changed WHEN, not a value history).
   NOTE ON IDEMPOTENCY: CREATE-IF-NOT-EXISTS + seed-IF-EMPTY, not this
   file's usual DROP+CREATE — see the file header comment.
   ===================================================================== */
IF OBJECT_ID('core.RefAppSettings') IS NULL
BEGIN
    CREATE TABLE core.RefAppSettings (
        SettingKey  NVARCHAR(64)  NOT NULL PRIMARY KEY,  -- 'targets' | 'thresholdOverrides' | 'exceptionDisplayCodes' | 'vdiOperatingHoursPerDay'
        ValueJson   NVARCHAR(MAX) NOT NULL,               -- the section's value, JSON-encoded
        UpdatedAt   DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy   NVARCHAR(200) NULL
    );
END
GO

-- Seed: reference.targets -> ModelJson.targets / reference.targets (TargetsRef)
IF NOT EXISTS (SELECT 1 FROM core.RefAppSettings WHERE SettingKey = 'targets')
INSERT INTO core.RefAppSettings (SettingKey, ValueJson, UpdatedBy) VALUES
(N'targets', N'{"completionPct":0.95,"exceptionRate":0.06,"systemRate":0.03,"costPerCase":9,"utilMin":0.15,"utilMax":0.6,"vdiStaleDays":14}', N'seed:13_api_model_views.sql');
GO

-- Seed: reference.thresholdOverrides -> reference.thresholdOverrides (ThresholdOverrideRef[]; optional/empty today)
IF NOT EXISTS (SELECT 1 FROM core.RefAppSettings WHERE SettingKey = 'thresholdOverrides')
INSERT INTO core.RefAppSettings (SettingKey, ValueJson, UpdatedBy) VALUES
(N'thresholdOverrides', N'[]', N'seed:13_api_model_views.sql');
GO

-- Seed: reference.exceptionDisplayCodes -> reference.exceptionDisplayCodes (Record<reason,code>)
IF NOT EXISTS (SELECT 1 FROM core.RefAppSettings WHERE SettingKey = 'exceptionDisplayCodes')
INSERT INTO core.RefAppSettings (SettingKey, ValueJson, UpdatedBy) VALUES
(N'exceptionDisplayCodes', N'{"Application timeout waiting for core system":"TMO","Element not found on screen":"ENF","Login failed for credential vault account":"LGN","Citrix session disconnected mid-run":"CTX","Unexpected dialog window blocked automation":"DLG","Connection to mainframe lost during navigation":"CON","Timeout retrieving policy record":"TPR","Customer record not found in core system":"CNF","Case data invalid for processing":"INV","Documentation missing or incomplete":"DOC","Value outside tolerance - manual referral":"TOL","Duplicate case already processed":"DUP","Manual referral required - complex case":"MRC","Reference data mismatch between systems":"RDM"}', N'seed:13_api_model_views.sql');
GO

-- Seed: reference.vdiOperatingHoursPerDay -> ModelJson.vdiOperatingHoursPerDay / reference.vdiOperatingHoursPerDay
IF NOT EXISTS (SELECT 1 FROM core.RefAppSettings WHERE SettingKey = 'vdiOperatingHoursPerDay')
INSERT INTO core.RefAppSettings (SettingKey, ValueJson, UpdatedBy) VALUES
(N'vdiOperatingHoursPerDay', N'20', N'seed:13_api_model_views.sql');
GO

/* =====================================================================
   ONE-TIME MIGRATION: reclaim the retired 'processExtras' stopgap.

   Before core.RefProcess.Icon/Tags existed (03_core_dimensions.sql), the
   API server persisted a process's icon/tags as a FIFTH core.RefAppSettings
   JSON document under SettingKey = 'processExtras'
   ({[processId]: {icon, tags}}) — see server/src/data/sql-reference.ts's
   git history. That code path is now deleted; this block is what makes
   upgrading an already-deployed database LOSSLESS: if a processExtras
   document exists, copy each entry's icon/tags into the matching
   core.RefProcess row (Tags re-joined with ';', matching the column's
   delimiter) and delete the document. Safe to re-run: a no-op once the row
   is gone. On a fresh install there is no processExtras row, so this never
   fires.
   ===================================================================== */
IF EXISTS (SELECT 1 FROM core.RefAppSettings WHERE SettingKey = 'processExtras')
BEGIN
    DECLARE @processExtrasJson NVARCHAR(MAX) =
        (SELECT ValueJson FROM core.RefAppSettings WHERE SettingKey = 'processExtras');

    UPDATE p
    SET p.Icon = NULLIF(x.IconVal, N''),
        p.Tags = NULLIF(x.TagsVal, N'')
    FROM core.RefProcess p
    CROSS APPLY (
        SELECT
            JSON_VALUE(je.value, '$.icon') AS IconVal,
            (
                SELECT STRING_AGG(t.value, N';')
                FROM OPENJSON(je.value, '$.tags') t
            ) AS TagsVal
        FROM OPENJSON(@processExtrasJson) je
        WHERE je.[key] = CAST(p.ProcessId AS NVARCHAR(20))
    ) x;

    DELETE FROM core.RefAppSettings WHERE SettingKey = 'processExtras';
END
GO

/* =====================================================================
   core.RefVersion — a SINGLE-ROW optimistic-concurrency token for
   PUT /api/reference (the client sends If-Match: <Version>; the server
   rejects a stale write with 409 and bumps Version on every accepted
   write). Id is pinned to 1 by the CHECK constraint so there can only
   ever be exactly one row. NOTE ON IDEMPOTENCY: see RefAppSettings above
   — CREATE-IF-NOT-EXISTS + seed-IF-EMPTY, never dropped.
   ===================================================================== */
IF OBJECT_ID('core.RefVersion') IS NULL
BEGIN
    CREATE TABLE core.RefVersion (
        Id        INT          NOT NULL PRIMARY KEY CHECK (Id = 1),
        Version   INT          NOT NULL,
        UpdatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy NVARCHAR(200) NULL
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM core.RefVersion)
INSERT INTO core.RefVersion (Id, Version, UpdatedBy) VALUES (1, 1, N'seed:13_api_model_views.sql');
GO

/* =====================================================================
   core.RefChangeLog — append-only audit trail of reference-data writes,
   the SQL home for reference-store.ts's ChangelogEntry[] (ts/section/
   actor), capped client-side at 50 entries for DISPLAY (reference-
   store.ts's appendChangelog) but kept in FULL here for audit purposes.
   NOTE ON IDEMPOTENCY: see RefAppSettings above — CREATE-IF-NOT-EXISTS,
   never dropped (dropping this would destroy the audit history).
   ===================================================================== */
IF OBJECT_ID('core.RefChangeLog') IS NULL
BEGIN
    CREATE TABLE core.RefChangeLog (
        Id      INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
        Ts      DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
        Actor   NVARCHAR(200) NULL,
        Section NVARCHAR(100) NOT NULL   -- free-form: which reference section changed (e.g. "resources", "gradeRates")
    );
END
GO

/* =====================================================================
   vw_PipelineHealth — the single most recent core.PipelineRun row
   (11_pipeline_ops.sql), regardless of Status ('running'/'success'/
   'failed') — GET /api/health's `lastRun` reads THIS, not "the last
   successful run", because a failed or still-running run is exactly the
   condition the dashboard's Data health block (src/pages/admin/
   DataSyncSection.tsx) exists to surface; `lastPullAt` (server/src/data/
   sql-model.ts's existing getLastPullAt) remains the "last SUCCESSFUL
   pull" figure for the header freshness pill, unchanged.
   Depends on 11_pipeline_ops.sql having run first (same file-ordering
   assumption every other view in this file already makes about
   03_core_dimensions.sql/04_fact_and_calendar.sql).
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_PipelineHealth AS
SELECT TOP (1)
    RunId, Status, StartedAt, FinishedAt,
    RowsStaged, RowsMerged, RowsRejected, UnmappedQueues, WatermarkAgeMinutes,
    Error
FROM core.PipelineRun
ORDER BY StartedAt DESC;
GO
