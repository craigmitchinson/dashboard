/* =====================================================================
   08_report_views.sql
   ---------------------------------------------------------------------
   Everything Power BI (and the web dashboard's data API) connects to.
   ALL calculations live here, in SQL. Consumers import these and do
   nothing but filter, slice and display.

   THE CONTRACT: tools/build-dashboard-data.mjs in the dashboard repo
   ports these views 1:1 to JSON for the mock/demo path. Shapes and
   semantics must stay identical — a change here is a change there.

   HUB & SPOKE ECONOMICS (the two money rules everything hangs off):

   BENEFIT = SMV x the GRADE rate in force on the item's outcome date.
     A process carries the grade of colleague it automates against
     (RefProcess.GradeCode) and the SMV; core.RefGradeRate is the hub's
     date-effective rate card. Pay awards insert new rows; history is
     never re-valued; spokes automating different grades price
     differently with zero extra configuration.

   COST = worktime x ( hub £/bot-second + spoke infra £/bot-second ).
     Hub pool/day  = CoE team run-rate (RefPeopleCostHistory, OwnerId='HUB',
                     in force on the date — the SOLE source of hub people
                     cost; RefEstateCostHistory.TeamAnnualCostGBP is schema
                     parity only, see 03_core_dimensions.sql) + hub-owned
                     VDIs' per-day coverage-window cost (fn_VdiDailyCost),
                     apportioned by worktime across ALL work.
     Spoke infra/day = the spoke's own live VDIs' per-day coverage-window
                     cost (fn_VdiDailyCost — same renewal/expiry/retirement
                     semantics as the hub side), apportioned by worktime
                     WITHIN the spoke. Retiring/adding/renewing a VDI moves
                     that spoke's cost automatically; the class £ rates
                     (or a VDI's own AnnualCostGBP override) are universal.
     Idle time is never in a denominator: idle cost lands on work done.

   View inventory:
     report.fn_VdiDailyCost        Per-VDI, per-date coverage-window daily cost
     report.vw_DimSpoke            CoE spokes
     report.vw_DimGradeRate        the date-effective grade rate card
     report.vw_DimProcess          Process + proposition + spoke + SMV/grade
     report.vw_DimResource         Robot/VDI dimension (with owning spoke)
     report.vw_DimCalendar         Date dimension (with sortable labels)
     report.vw_EstateRateByDate    Hub team + infra pools in force per date
     report.vw_SpokeInfraRateByDate  Per-spoke infra pool per date
     report.vw_HubCostPerSecondByDate    Hub pool £ per bot-second per day
     report.vw_SpokeCostPerSecondByDate  Spoke infra £ per bot-second per day
     report.vw_FactItemEconomics   PER-ITEM benefit, rework value and cost
                                   (the single source for every £ below)
     report.vw_FactWorkItem        Enriched fact for the model (item grain)
     report.vw_FactItemCost        Per-case apportioned estate cost
     report.vw_DailyOutcomes       Daily outcome counts + worktime
     report.vw_MonthlyOutcomes     Monthly rollup with completion/exception %
     report.vw_ExceptionDetail     Exception reasons, volumes, time-to-fail
     report.vw_ExceptionCost       What exceptions cost (wasted bot + rework)
     report.vw_ResourceUtil        VDI utilisation and exception rate
     report.vw_Commercial          Per process: benefit, FTE, cost/task, net
     report.vw_CommercialBySpoke   The same rollup per spoke (spoke P&L)
     report.vw_CommercialMonthly   Monthly series with YTD + all-time cumulative
     report.vw_CommercialOverall   Whole-estate rollup
     report.vw_KPIHeadline         Single-row headline stat block
   ===================================================================== */
USE BPAnalytics;
GO

/* =====================================================================
   Spoke and grade dimensions.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_DimSpoke AS
SELECT SpokeId, SpokeName, ShortName, ColorHexLight, ColorHexDark
FROM core.RefSpoke;
GO

CREATE OR ALTER VIEW report.vw_DimGradeRate AS
SELECT GradeCode AS Grade, GradeName, EffectiveFrom, HourlyCostGBP
FROM core.RefGradeRate;
GO

/* =====================================================================
   Process dimension: names, proposition, SPOKE, and the benefit inputs
   (SMV + grade). CurrentHourlyRateGBP is today's rate for display only;
   every £ in the fact views resolves the rate at the item's own date.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_DimProcess AS
SELECT
    pr.ProcessId,
    pr.ProcessName,
    pr.ProcessAcronym,
    pr.ProcessDescription,
    pr.IsActive,
    pp.PropositionId,
    pp.PropositionName,
    sp.SpokeId,
    sp.SpokeName,
    pr.SMVMinutes,
    pr.GradeCode AS Grade,
    gr.GradeName,
    gr.HourlyCostGBP AS CurrentHourlyRateGBP
FROM core.RefProcess pr
JOIN core.RefProposition pp ON pp.PropositionId = pr.PropositionId
JOIN core.RefSpoke sp ON sp.SpokeId = pp.SpokeId
CROSS APPLY (
    SELECT TOP 1 g.GradeName, g.HourlyCostGBP
    FROM core.RefGradeRate g
    WHERE g.GradeCode = pr.GradeCode AND g.EffectiveFrom <= CONVERT(DATE, SYSUTCDATETIME())
    ORDER BY g.EffectiveFrom DESC
) gr;
GO

/* =====================================================================
   Resource dimension: bot identity vs VDI, with the OWNING SPOKE.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_DimResource AS
SELECT r.ResourceName, r.BotName, r.BotAcronym, r.VDIName, r.CostClass,
       r.SpokeId, COALESCE(sp.SpokeName, 'Hub') AS SpokeName,
       r.ActiveFrom, r.ActiveTo, r.Notes, r.IsActive
FROM core.RefResource r
LEFT JOIN core.RefSpoke sp ON sp.SpokeId = r.SpokeId;
GO

/* =====================================================================
   Calendar dimension. Relate fact.OutcomeDateKey to DateKey.
   In Power BI: set MonthLabel "Sort by column" = MonthSortKey, and
   QuarterLabel "Sort by column" = QuarterSortKey. Done once, fixes all
   time sorting.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_DimCalendar AS
SELECT
    DateKey, [Date], DayOfMonth, DayName, WeekStart,
    MonthNumber, MonthName, MonthShort, MonthLabel, MonthSortKey,
    [Quarter], QuarterLabel, QuarterSortKey, [Year], IsWeekend
FROM core.DimCalendar;
GO

/* =====================================================================
   fn_VdiDailyCost — per-VDI, per-date coverage-window daily cost.

   Mirrors src/reference/economics.ts's vdiDailyCost() (D3 algorithm)
   byte-for-byte: renewal cycles tile every 365 days from RenewalDate, both
   forward and backward from that anchor. Within the cycle containing
   @AsOfDate:
     - the raw cycle end is CycleStart + 365 days
     - a LicenseExpiryDate (if set) pulls the end in to the day AFTER it
     - a 'retired' Status with an ActiveTo pulls the end in to the day
       AFTER ActiveTo too (whichever end constraint is earliest wins)
     - the window start is the LATER of CycleStart and ActiveFrom
   Outside [WindowStart, WindowEnd) the VDI costs (and — by construction,
   for anything that reuses this as an availability check — is available)
   £0. Inside it, the window's (possibly overridden, possibly shortened)
   annual figure is divided evenly across however many days the window
   actually covers, so a shortened cycle costs proportionally more per
   day, never less. AnnualCostGBP overrides the CostClass rate when set;
   the class rate itself is resolved AT THE CYCLE START date (not
   @AsOfDate), same as the TS twin.
   Used by vw_EstateRateByDate and vw_SpokeInfraRateByDate so infra cost
   reflects true coverage, not just the blunt ActiveFrom/ActiveTo lifecycle
   window.
   ===================================================================== */
CREATE OR ALTER FUNCTION report.fn_VdiDailyCost (@ResourceName NVARCHAR(200), @AsOfDate DATE)
RETURNS TABLE
AS
RETURN (
    SELECT
        CASE
            WHEN @AsOfDate < win.WindowStart OR @AsOfDate >= win.WindowEnd THEN 0
            WHEN DATEDIFF(DAY, win.WindowStart, win.WindowEnd) <= 0 THEN 0
            ELSE COALESCE(r.AnnualCostGBP, vr.AnnualCostPerVDIGBP)
                 / CAST(DATEDIFF(DAY, win.WindowStart, win.WindowEnd) AS DECIMAL(14,6))
        END AS DailyCostGBP
    FROM core.RefResource r
    CROSS APPLY (
        -- the 365-day renewal cycle (tiled forward/backward from RenewalDate)
        -- that contains @AsOfDate
        SELECT DATEADD(
                   DAY,
                   CAST(FLOOR(DATEDIFF(DAY, r.RenewalDate, @AsOfDate) / 365.0) AS INT) * 365,
                   r.RenewalDate
               ) AS CycleStart
    ) cyc
    CROSS APPLY (
        -- the window is the cycle, cut short by whichever of licence expiry
        -- or retirement bites first, and never starting before ActiveFrom
        SELECT
            (SELECT MIN(d) FROM (VALUES
                (DATEADD(DAY, 365, cyc.CycleStart)),
                (CASE WHEN r.LicenseExpiryDate IS NOT NULL THEN DATEADD(DAY, 1, r.LicenseExpiryDate) END),
                (CASE WHEN r.Status = 'retired' AND r.ActiveTo IS NOT NULL THEN DATEADD(DAY, 1, r.ActiveTo) END)
            ) AS x(d)) AS WindowEnd,
            (SELECT MAX(d) FROM (VALUES (cyc.CycleStart), (r.ActiveFrom)) AS x(d)) AS WindowStart
    ) win
    CROSS APPLY (
        -- CostClass rate in force AT THE CYCLE START date (only used if
        -- AnnualCostGBP doesn't override it) — matches the TS twin exactly
        SELECT TOP 1 v.AnnualCostPerVDIGBP
        FROM core.RefVDICostHistory v
        WHERE v.CostClass = r.CostClass AND v.EffectiveFrom <= CAST(cyc.CycleStart AS DATE)
        ORDER BY v.EffectiveFrom DESC
    ) vr
    WHERE r.ResourceName = @ResourceName
);
GO

/* =====================================================================
   TIME-VARYING COST POOLS — resolution layer.

   vw_EstateRateByDate: per calendar date, the hub team pool, hub-owned
   infra, and the total spoke infra in force (annualised) plus working
   assumptions. HubPoolPerDayGBP = (team + hub infra) / 365.25.
   TeamAnnualCostGBP comes from RefPeopleCostHistory (OwnerId='HUB'), the
   sole source of hub people cost; WorkingDaysPerYear/ProductiveHoursPerDay
   still come from RefEstateCostHistory. HubInfraAnnualGBP/SpokeInfraAnnualGBP
   are the SUM of each VDI's own coverage-window daily cost
   (fn_VdiDailyCost), annualised back (x365.25) purely so this column keeps
   reading as an annual figure — the /365.25 in HubPoolPerDayGBP/
   EstateCostPerDayGBP below undoes that and yields the true daily pool.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_EstateRateByDate AS
SELECT
    c.DateKey,
    c.[Date],
    people.TeamAnnualCostGBP,
    hub.HubInfraAnnualGBP,
    spk.SpokeInfraAnnualGBP,
    team.WorkingDaysPerYear,
    team.ProductiveHoursPerDay,
    (people.TeamAnnualCostGBP + hub.HubInfraAnnualGBP) / 365.25 AS HubPoolPerDayGBP,
    (people.TeamAnnualCostGBP + hub.HubInfraAnnualGBP + spk.SpokeInfraAnnualGBP) / 365.25 AS EstateCostPerDayGBP
FROM core.DimCalendar c
CROSS APPLY (
    -- working-day/hours assumptions in force on this date (TeamAnnualCostGBP
    -- itself now comes from RefPeopleCostHistory — see `people` below;
    -- RefEstateCostHistory's own TeamAnnualCostGBP is schema parity only)
    SELECT TOP 1 h.WorkingDaysPerYear, h.ProductiveHoursPerDay
    FROM core.RefEstateCostHistory h
    WHERE h.EffectiveFrom <= c.[Date]
    ORDER BY h.EffectiveFrom DESC
) team
CROSS APPLY (
    -- hub team run-rate in force on this date — SOLE source of hub people cost
    SELECT TOP 1 p.AnnualCostGBP AS TeamAnnualCostGBP
    FROM core.RefPeopleCostHistory p
    WHERE p.OwnerId = 'HUB' AND p.EffectiveFrom <= c.[Date]
    ORDER BY p.EffectiveFrom DESC
) people
CROSS APPLY (
    -- hub-owned (SpokeId NULL) VDIs' coverage-window cost on this date, summed
    -- then annualised (x365.25) for this column's label only
    SELECT COALESCE(SUM(dc.DailyCostGBP), 0) * 365.25 AS HubInfraAnnualGBP
    FROM core.RefResource r
    CROSS APPLY report.fn_VdiDailyCost(r.ResourceName, c.[Date]) dc
    WHERE r.SpokeId IS NULL
) hub
CROSS APPLY (
    -- all spoke-owned VDIs' coverage-window cost on this date (total across
    -- spokes), summed then annualised (x365.25) for this column's label only
    SELECT COALESCE(SUM(dc.DailyCostGBP), 0) * 365.25 AS SpokeInfraAnnualGBP
    FROM core.RefResource r
    CROSS APPLY report.fn_VdiDailyCost(r.ResourceName, c.[Date]) dc
    WHERE r.SpokeId IS NOT NULL
) spk;
GO

/* Per-spoke infra pool in force per date: the spoke's own live VDIs' coverage-
   window cost (fn_VdiDailyCost). Retire/renew/add a VDI in RefResource and
   this moves automatically. */
CREATE OR ALTER VIEW report.vw_SpokeInfraRateByDate AS
SELECT
    c.DateKey,
    c.[Date],
    s.SpokeId,
    s.SpokeName,
    COALESCE(inf.InfraAnnualGBP, 0) AS InfraAnnualGBP,
    COALESCE(inf.InfraAnnualGBP, 0) / 365.25 AS InfraPerDayGBP
FROM core.DimCalendar c
CROSS JOIN core.RefSpoke s
OUTER APPLY (
    SELECT SUM(dc.DailyCostGBP) * 365.25 AS InfraAnnualGBP
    FROM core.RefResource r
    CROSS APPLY report.fn_VdiDailyCost(r.ResourceName, c.[Date]) dc
    WHERE r.SpokeId = s.SpokeId
) inf;
GO

/* Hub pool £ per bot-second per day: the shared pool over the WHOLE day's
   worktime (all spokes). Idle time is not in the denominator. */
CREATE OR ALTER VIEW report.vw_HubCostPerSecondByDate AS
SELECT
    rd.DateKey,
    rd.[Date],
    rd.HubPoolPerDayGBP,
    COALESCE(SUM(CAST(f.Worktime AS BIGINT)), 0) AS DayTotalWorktimeSec,
    CASE WHEN COALESCE(SUM(CAST(f.Worktime AS BIGINT)), 0) = 0 THEN 0
         ELSE rd.HubPoolPerDayGBP / SUM(CAST(f.Worktime AS BIGINT))
    END AS HubCostPerSecGBP
FROM report.vw_EstateRateByDate rd
LEFT JOIN core.FactWorkItem f ON f.OutcomeDateKey = rd.DateKey
GROUP BY rd.DateKey, rd.[Date], rd.HubPoolPerDayGBP;
GO

/* Spoke infra £ per bot-second per day: the spoke's infra pool over the
   spoke's OWN worktime that day. */
CREATE OR ALTER VIEW report.vw_SpokeCostPerSecondByDate AS
SELECT
    sr.DateKey,
    sr.[Date],
    sr.SpokeId,
    sr.SpokeName,
    sr.InfraPerDayGBP,
    COALESCE(wt.SpokeWorktimeSec, 0) AS SpokeWorktimeSec,
    CASE WHEN COALESCE(wt.SpokeWorktimeSec, 0) = 0 THEN 0
         ELSE sr.InfraPerDayGBP / wt.SpokeWorktimeSec
    END AS SpokeCostPerSecGBP
FROM report.vw_SpokeInfraRateByDate sr
OUTER APPLY (
    SELECT SUM(CAST(f.Worktime AS BIGINT)) AS SpokeWorktimeSec
    FROM core.FactWorkItem f
    JOIN core.RefQueueMap qm ON qm.QueueName = f.QueueName
    JOIN core.RefProcess pr ON pr.ProcessId = qm.ProcessId
    JOIN core.RefProposition pp ON pp.PropositionId = pr.PropositionId
    WHERE f.OutcomeDateKey = sr.DateKey
      AND pp.SpokeId = sr.SpokeId
) wt;
GO

/* =====================================================================
   PER-ITEM ECONOMICS — the single source for every £ downstream.
     BenefitGBP  SMV x grade rate in force on the outcome date (completed)
     ReworkGBP   same valuation for excepted items (rework upper bound)
     EstateCostGBP  worktime x (hub £/sec + spoke infra £/sec) of that day
     FTESaved    SMV / working minutes/year in force (completed)
   Summing any of these at ANY grain gives the correct time-correct figure.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_FactItemEconomics AS
SELECT
    f.ID,
    f.ProcessId,
    pp.SpokeId,
    f.OutcomeDateKey,
    f.Outcome,
    f.ExceptionType,
    f.KeyValue,
    f.Resource,
    f.Worktime,
    CASE WHEN f.Outcome = 'Completed'
         THEN pr.SMVMinutes * (gr.HourlyCostGBP / 60.0) ELSE 0 END AS BenefitGBP,
    CASE WHEN f.Outcome = 'Exception'
         THEN pr.SMVMinutes * (gr.HourlyCostGBP / 60.0) ELSE 0 END AS ReworkGBP,
    CAST(CAST(f.Worktime AS FLOAT)
         * (hub.HubCostPerSecGBP + COALESCE(spk.SpokeCostPerSecGBP, 0))
         AS DECIMAL(14,6)) AS EstateCostGBP,
    CASE WHEN f.Outcome = 'Completed'
         THEN pr.SMVMinutes
              / NULLIF(rd.WorkingDaysPerYear * rd.ProductiveHoursPerDay * 60.0, 0)
         ELSE 0 END AS FTESaved
FROM core.FactWorkItem f
JOIN core.RefProcess pr ON pr.ProcessId = f.ProcessId
JOIN core.RefProposition pp ON pp.PropositionId = pr.PropositionId
JOIN report.vw_EstateRateByDate rd ON rd.DateKey = f.OutcomeDateKey
JOIN report.vw_HubCostPerSecondByDate hub ON hub.DateKey = f.OutcomeDateKey
LEFT JOIN report.vw_SpokeCostPerSecondByDate spk
       ON spk.DateKey = f.OutcomeDateKey AND spk.SpokeId = pp.SpokeId
CROSS APPLY (
    -- grade rate in force on the item's outcome date
    SELECT TOP 1 g.HourlyCostGBP
    FROM core.RefGradeRate g
    WHERE g.GradeCode = pr.GradeCode
      AND g.EffectiveFrom <= CONVERT(DATE, CONVERT(CHAR(8), f.OutcomeDateKey), 112)
    ORDER BY g.EffectiveFrom DESC
) gr;
GO

/* =====================================================================
   Enriched fact for the model. One row per case, every code resolved.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_FactWorkItem AS
SELECT
    f.ID,
    f.QueueName,
    f.ProcessId,
    pp.SpokeId,
    f.KeyValue,
    f.Resource,
    f.Attempt,
    f.Tags,
    f.Priority,
    f.LoadedDate,
    f.CompletedDate,
    f.ExceptionDate,
    f.Worktime,
    f.Outcome,
    f.ExceptionType,
    f.ExceptionReason,
    f.OutcomeDateKey,
    qm.StageName,
    qm.StageOrder
FROM core.FactWorkItem f
LEFT JOIN core.RefQueueMap qm ON qm.QueueName = f.QueueName
LEFT JOIN core.RefProcess pr ON pr.ProcessId = f.ProcessId
LEFT JOIN core.RefProposition pp ON pp.PropositionId = pr.PropositionId;
GO

/* Back-compat: per-case apportioned estate cost. */
CREATE OR ALTER VIEW report.vw_FactItemCost AS
SELECT ID, ProcessId, SpokeId, OutcomeDateKey, Outcome, Worktime,
       CAST(EstateCostGBP AS DECIMAL(14,4)) AS ApportionedEstateCostGBP
FROM report.vw_FactItemEconomics;
GO

/* =====================================================================
   Daily outcomes: the case-flow backbone.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_DailyOutcomes AS
SELECT
    f.OutcomeDateKey,
    c.[Date],
    c.MonthLabel,
    c.MonthSortKey,
    p.SpokeName,
    p.ProcessName,
    p.PropositionName,
    f.Outcome,
    f.ExceptionType,
    COUNT(*)                          AS ItemCount,
    SUM(CAST(f.Worktime AS BIGINT))   AS TotalWorktimeSec,
    AVG(CAST(f.Worktime AS FLOAT))    AS AvgWorktimeSec
FROM core.FactWorkItem f
JOIN core.DimCalendar c ON c.DateKey = f.OutcomeDateKey
LEFT JOIN report.vw_DimProcess p ON p.ProcessId = f.ProcessId
GROUP BY f.OutcomeDateKey, c.[Date], c.MonthLabel, c.MonthSortKey,
         p.SpokeName, p.ProcessName, p.PropositionName, f.Outcome, f.ExceptionType;
GO

/* =====================================================================
   Monthly outcomes with completion and exception percentages.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_MonthlyOutcomes AS
WITH m AS (
    SELECT
        c.MonthLabel, c.MonthSortKey,
        p.SpokeName, p.ProcessName, p.PropositionName,
        SUM(CASE WHEN f.Outcome = 'Completed' THEN 1 ELSE 0 END) AS Completed,
        SUM(CASE WHEN f.Outcome = 'Exception' THEN 1 ELSE 0 END) AS Exceptions,
        SUM(CASE WHEN f.ExceptionType = 'Business' THEN 1 ELSE 0 END) AS BusinessExc,
        SUM(CASE WHEN f.ExceptionType = 'System'   THEN 1 ELSE 0 END) AS SystemExc,
        COUNT(*) AS TotalItems
    FROM core.FactWorkItem f
    JOIN core.DimCalendar c ON c.DateKey = f.OutcomeDateKey
    LEFT JOIN report.vw_DimProcess p ON p.ProcessId = f.ProcessId
    GROUP BY c.MonthLabel, c.MonthSortKey, p.SpokeName, p.ProcessName, p.PropositionName
)
SELECT *,
    CAST(100.0 * Completed  / NULLIF(TotalItems, 0) AS DECIMAL(5,1)) AS CompletionPct,
    CAST(100.0 * Exceptions / NULLIF(TotalItems, 0) AS DECIMAL(5,1)) AS ExceptionPct
FROM m;
GO

/* =====================================================================
   Exception detail: reasons, volumes, share of total, avg time-to-fail.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ExceptionDetail AS
WITH e AS (
    SELECT
        p.SpokeName, p.PropositionName, p.ProcessName,
        f.ExceptionType, f.ExceptionReason,
        COUNT(*)                        AS Volume,
        AVG(CAST(f.Worktime AS FLOAT))  AS AvgTimeToFailSec,
        SUM(CAST(f.Worktime AS BIGINT)) AS TotalTimeToFailSec
    FROM core.FactWorkItem f
    LEFT JOIN report.vw_DimProcess p ON p.ProcessId = f.ProcessId
    WHERE f.Outcome = 'Exception'
    GROUP BY p.SpokeName, p.PropositionName, p.ProcessName, f.ExceptionType, f.ExceptionReason
)
SELECT *,
    CAST(100.0 * Volume / NULLIF(SUM(Volume) OVER (), 0) AS DECIMAL(5,2)) AS PctOfAllExceptions
FROM e;
GO

/* =====================================================================
   Exception cost: wasted bot time + rework valued at the grade rate in
   force when each item failed (an UPPER BOUND — see runbook: retries that
   later completed mean no human actually reworked some of these).
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ExceptionCost AS
SELECT
    p.SpokeName,
    p.PropositionName,
    p.ProcessName,
    e.ExceptionType,
    COUNT(*)                                                   AS ExceptionCount,
    SUM(CAST(e.Worktime AS BIGINT))                            AS WastedBotSeconds,
    CAST(SUM(CAST(e.Worktime AS BIGINT)) / 3600.0 AS DECIMAL(12,2)) AS WastedBotHours,
    CAST(SUM(e.ReworkGBP) AS DECIMAL(14,2))                    AS ReworkCostGBP
FROM report.vw_FactItemEconomics e
JOIN report.vw_DimProcess p ON p.ProcessId = e.ProcessId
WHERE e.Outcome = 'Exception'
GROUP BY p.SpokeName, p.PropositionName, p.ProcessName, e.ExceptionType;
GO

/* =====================================================================
   Resource (VDI) utilisation, with owning spoke.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_ResourceUtil AS
SELECT
    r.ResourceName,
    r.BotName,
    r.VDIName,
    COALESCE(sp.SpokeName, 'Hub')     AS SpokeName,
    COUNT(*)                          AS ItemsProcessed,
    SUM(CAST(f.Worktime AS BIGINT))   AS ProductiveSeconds,
    SUM(CASE WHEN f.Outcome = 'Exception' THEN 1 ELSE 0 END) AS Exceptions,
    CAST(100.0 * SUM(CASE WHEN f.Outcome = 'Exception' THEN 1 ELSE 0 END)
         / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS ExceptionRatePct
FROM core.FactWorkItem f
JOIN core.RefResource r ON r.ResourceName = f.Resource
LEFT JOIN core.RefSpoke sp ON sp.SpokeId = r.SpokeId
GROUP BY r.ResourceName, r.BotName, r.VDIName, sp.SpokeName;
GO

/* =====================================================================
   Commercial: the headline value story per process. All £ come from
   vw_FactItemEconomics, so benefit is grade-rate-correct and cost is the
   hub+spoke apportionment — at the rates in force when the work happened.
   A TASK is one completed queue item; a CASE is a distinct business key
   (one case may span several tasks/stages).
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_Commercial AS
SELECT
    p.SpokeName,
    p.PropositionName,
    p.ProcessName,
    SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END)        AS CompletedTasks,
    COUNT(DISTINCT CASE WHEN e.Outcome = 'Completed' THEN e.KeyValue END) AS CompletedCases,
    CAST(SUM(e.BenefitGBP) AS DECIMAL(14,2))                        AS GrossBenefitGBP,
    CAST(SUM(e.FTESaved) AS DECIMAL(10,2))                          AS FTEEquivalentSaved,
    CAST(SUM(e.EstateCostGBP) AS DECIMAL(14,2))                     AS ApportionedEstateCostGBP,
    CAST(SUM(e.EstateCostGBP)
         / NULLIF(SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END), 0)
         AS DECIMAL(10,2))                                          AS CostPerCompletedTaskGBP,
    CAST(SUM(e.EstateCostGBP)
         / NULLIF(COUNT(DISTINCT CASE WHEN e.Outcome = 'Completed' THEN e.KeyValue END), 0)
         AS DECIMAL(10,2))                                          AS CostPerCompletedCaseGBP,
    CAST(SUM(e.BenefitGBP) - SUM(e.EstateCostGBP) AS DECIMAL(14,2)) AS NetBenefitGBP
FROM report.vw_FactItemEconomics e
JOIN report.vw_DimProcess p ON p.ProcessId = e.ProcessId
GROUP BY p.SpokeName, p.PropositionName, p.ProcessName;
GO

/* =====================================================================
   The same rollup per SPOKE — each spoke's P&L on one row.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_CommercialBySpoke AS
SELECT
    sp.SpokeId,
    sp.SpokeName,
    SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END)        AS CompletedTasks,
    COUNT(DISTINCT CASE WHEN e.Outcome = 'Completed' THEN e.KeyValue END) AS CompletedCases,
    CAST(SUM(e.BenefitGBP) AS DECIMAL(14,2))                        AS GrossBenefitGBP,
    CAST(SUM(e.FTESaved) AS DECIMAL(10,2))                          AS FTEEquivalentSaved,
    CAST(SUM(e.EstateCostGBP) AS DECIMAL(14,2))                     AS ApportionedEstateCostGBP,
    CAST(SUM(e.EstateCostGBP)
         / NULLIF(SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END), 0)
         AS DECIMAL(10,2))                                          AS CostPerCompletedTaskGBP,
    CAST(SUM(e.BenefitGBP) - SUM(e.EstateCostGBP) AS DECIMAL(14,2)) AS NetBenefitGBP
FROM report.vw_FactItemEconomics e
JOIN core.RefSpoke sp ON sp.SpokeId = e.SpokeId
GROUP BY sp.SpokeId, sp.SpokeName;
GO

/* =====================================================================
   Commercial monthly time series with YTD and all-time cumulative.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_CommercialMonthly AS
WITH monthly AS (
    SELECT
        c.[Year],
        c.MonthLabel,
        c.MonthSortKey,
        SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END) AS CompletedTasks,
        COUNT(DISTINCT CASE WHEN e.Outcome = 'Completed' THEN e.KeyValue END) AS CompletedCases,
        SUM(e.BenefitGBP)    AS GrossBenefitGBP,
        SUM(e.EstateCostGBP) AS EstateCostGBP
    FROM report.vw_FactItemEconomics e
    JOIN core.DimCalendar c ON c.DateKey = e.OutcomeDateKey
    GROUP BY c.[Year], c.MonthLabel, c.MonthSortKey
)
SELECT
    [Year],
    MonthLabel,
    MonthSortKey,
    CompletedTasks,
    CompletedCases,
    CAST(GrossBenefitGBP AS DECIMAL(14,2))                          AS GrossBenefitGBP,
    CAST(EstateCostGBP AS DECIMAL(14,2))                            AS EstateCostGBP,
    CAST(GrossBenefitGBP - EstateCostGBP AS DECIMAL(14,2))          AS NetBenefitGBP,
    CAST(SUM(GrossBenefitGBP) OVER (
            PARTITION BY [Year] ORDER BY MonthSortKey
            ROWS UNBOUNDED PRECEDING) AS DECIMAL(14,2))             AS YTDGrossBenefitGBP,
    CAST(SUM(GrossBenefitGBP - EstateCostGBP) OVER (
            PARTITION BY [Year] ORDER BY MonthSortKey
            ROWS UNBOUNDED PRECEDING) AS DECIMAL(14,2))             AS YTDNetBenefitGBP,
    SUM(CompletedTasks) OVER (
            PARTITION BY [Year] ORDER BY MonthSortKey
            ROWS UNBOUNDED PRECEDING)                               AS YTDCompletedTasks,
    CAST(SUM(GrossBenefitGBP) OVER (
            ORDER BY MonthSortKey
            ROWS UNBOUNDED PRECEDING) AS DECIMAL(14,2))             AS AllTimeGrossBenefitGBP,
    CAST(SUM(GrossBenefitGBP - EstateCostGBP) OVER (
            ORDER BY MonthSortKey
            ROWS UNBOUNDED PRECEDING) AS DECIMAL(14,2))             AS AllTimeNetBenefitGBP,
    SUM(CompletedTasks) OVER (
            ORDER BY MonthSortKey
            ROWS UNBOUNDED PRECEDING)                               AS AllTimeCompletedTasks
FROM monthly;
GO

/* =====================================================================
   Overall commercial rollup: one row, whole-estate totals.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_CommercialOverall AS
SELECT
    SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END)        AS TotalCompletedTasks,
    COUNT(DISTINCT CASE WHEN e.Outcome = 'Completed' THEN e.KeyValue END) AS TotalCompletedCases,
    CAST(SUM(e.BenefitGBP) AS DECIMAL(14,2))                        AS OverallGrossBenefitGBP,
    CAST(SUM(e.EstateCostGBP) AS DECIMAL(14,2))                     AS OverallEstateCostGBP,
    CAST(SUM(e.BenefitGBP) - SUM(e.EstateCostGBP) AS DECIMAL(14,2)) AS OverallNetBenefitGBP,
    CAST(SUM(e.EstateCostGBP)
         / NULLIF(SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END), 0)
         AS DECIMAL(10,2))                                          AS BlendedCostPerTaskGBP,
    CAST(SUM(e.EstateCostGBP)
         / NULLIF(COUNT(DISTINCT CASE WHEN e.Outcome = 'Completed' THEN e.KeyValue END), 0)
         AS DECIMAL(10,2))                                          AS BlendedCostPerCaseGBP
FROM report.vw_FactItemEconomics e;
GO

/* =====================================================================
   Headline KPI block: one row, the numbers for the top of the dashboard.
   All £ time-correct via vw_FactItemEconomics.
   ===================================================================== */
CREATE OR ALTER VIEW report.vw_KPIHeadline AS
SELECT
    SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END)        AS TotalCompleted,
    SUM(CASE WHEN e.Outcome = 'Exception' THEN 1 ELSE 0 END)        AS TotalExceptions,
    SUM(CASE WHEN e.ExceptionType = 'Business' THEN 1 ELSE 0 END)   AS BusinessExceptions,
    SUM(CASE WHEN e.ExceptionType = 'System'   THEN 1 ELSE 0 END)   AS SystemExceptions,
    CAST(100.0 * SUM(CASE WHEN e.Outcome = 'Completed' THEN 1 ELSE 0 END)
         / NULLIF(COUNT(*), 0) AS DECIMAL(5,1))                     AS CompletionPct,
    CAST(SUM(CASE WHEN e.Outcome = 'Completed'
             THEN p.SMVMinutes ELSE 0 END) / 60.0 AS DECIMAL(14,1)) AS ColleagueHoursSaved,
    CAST(SUM(e.BenefitGBP) AS DECIMAL(14,2))                        AS GrossBenefitGBP,
    CAST(SUM(e.FTESaved) AS DECIMAL(10,1))                          AS FTEEquivalentSaved,
    CAST(SUM(e.EstateCostGBP) AS DECIMAL(14,2))                     AS EstateCostGBP,
    CAST(SUM(e.BenefitGBP) - SUM(e.EstateCostGBP) AS DECIMAL(14,2)) AS NetBenefitGBP
FROM report.vw_FactItemEconomics e
JOIN report.vw_DimProcess p ON p.ProcessId = e.ProcessId;
GO
