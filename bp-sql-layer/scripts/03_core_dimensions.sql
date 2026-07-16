/* =====================================================================
   03_core_dimensions.sql
   ---------------------------------------------------------------------
   The model's dimension and reference tables.

   The Ref* tables are the ones the team edits. They are deliberately
   small and human-owned. Everything else is derived by the pipeline.
   Where to add a new robot, change a cost, add a proposition, or map a
   queue is called out in each table's comment and in the runbook.
   ===================================================================== */
USE BPAnalytics;
GO

/* =====================================================================
   RefSpoke - the CoE spokes (hub & spoke operating model).
   The HUB owns this table, the grade rate card and the per-VDI class
   rates. Each SPOKE owns its propositions, processes and VDIs, and the
   dashboard's spoke slicer keys off this dimension so every spoke can
   self-serve its own slice of one universal model.
   EDIT THIS to onboard a new spoke.
   ===================================================================== */
IF OBJECT_ID('core.RefSpoke') IS NOT NULL DROP TABLE core.RefSpoke;
GO
CREATE TABLE core.RefSpoke (
    SpokeId          INT           NOT NULL PRIMARY KEY,
    SpokeName        NVARCHAR(100) NOT NULL,
    ShortName        NVARCHAR(10)  NULL,
    -- the spoke's accent colour per dashboard surface. The shipped set was
    -- validated for colour-vision-deficiency separation and contrast on both
    -- surfaces; if you change one, re-validate the whole set (see dashboard
    -- repo, data/reference/reference.json).
    ColorHexLight    CHAR(7)       NULL,
    ColorHexDark     CHAR(7)       NULL
);
GO

/* =====================================================================
   RefGradeRate - the date-effective GRADE RATE CARD (hub-owned).

   THE HUMAN COST / SMV MECHANISM: a process does not carry a hard-coded
   hourly rate. It carries the GRADE of the business colleague whose
   manual work it displaces (RefProcess.GradeCode) plus the SMV, and this
   table holds what an hour of each grade costs, date-effective. Benefit
   is valued at the rate IN FORCE ON THE ITEM'S OUTCOME DATE, so:
     - a pay award is a new row per grade; history is never re-valued
     - spokes that automate against different grades price differently
       with zero per-spoke configuration
     - one rate card, maintained once, universally true across the hub
   EDIT THIS on pay reviews: INSERT new rows with the new EffectiveFrom;
   never edit old rows.
   ===================================================================== */
IF OBJECT_ID('core.RefGradeRate') IS NOT NULL DROP TABLE core.RefGradeRate;
GO
CREATE TABLE core.RefGradeRate (
    GradeCode        NVARCHAR(10)  NOT NULL,
    GradeName        NVARCHAR(100) NOT NULL,
    EffectiveFrom    DATE          NOT NULL,
    HourlyCostGBP    DECIMAL(8,2)  NOT NULL,   -- fully loaded £/h for the grade
    CONSTRAINT PK_RefGradeRate PRIMARY KEY (GradeCode, EffectiveFrom)
);
GO

/* =====================================================================
   RefProposition - the business areas robots serve. Owned by a spoke.
   EDIT THIS to add or rename a proposition (e.g. a new product line).
   ===================================================================== */
IF OBJECT_ID('core.RefProposition') IS NOT NULL DROP TABLE core.RefProposition;
GO
CREATE TABLE core.RefProposition (
    PropositionId    INT          NOT NULL PRIMARY KEY,
    PropositionName  NVARCHAR(100) NOT NULL,
    SpokeId          INT          NOT NULL
        REFERENCES core.RefSpoke(SpokeId)
);
GO

/* =====================================================================
   RefProcess - the automated processes.
   A process can span MANY queues, so process sits ABOVE
   queue. EDIT THIS to add a new process or change which proposition a
   process belongs to.
   ===================================================================== */
IF OBJECT_ID('core.RefProcess') IS NOT NULL DROP TABLE core.RefProcess;
GO
CREATE TABLE core.RefProcess (
    ProcessId        INT           NOT NULL PRIMARY KEY,
    ProcessName      NVARCHAR(150) NOT NULL,   -- human-readable name shown in PBI
    ProcessAcronym   NVARCHAR(20)  NULL,        -- short code for compact labels/slicers
    ProcessDescription NVARCHAR(500) NULL,      -- what the process does; for tooltips/reference
    PropositionId    INT           NOT NULL
        REFERENCES core.RefProposition(PropositionId),
    -- the benefit inputs for valuing this process's output. IMPORTANT:
    -- SMVMinutes is the standard minutes value a BUSINESS OPERATIONAL
    -- colleague takes per case, and GradeCode is the grade of that
    -- colleague. The £/h comes from core.RefGradeRate, resolved at the
    -- rate IN FORCE on each item's outcome date. This is deliberately NOT
    -- the engineering/team cost of the estate (that lives in
    -- RefEstateCostHistory): benefit is valued at the displaced business
    -- colleague's grade rate, cost is the CoE team plus infrastructure.
    SMVMinutes       DECIMAL(8,2)  NOT NULL,   -- standard minutes value per case
    GradeCode        NVARCHAR(10)  NOT NULL,   -- grade automated against (see RefGradeRate)
    IsActive         BIT           NOT NULL DEFAULT 1
);
GO

/* =====================================================================
   RefQueueMap - maps each real Blue Prism QUEUE to a process.
   This is the join that turns a cryptic queue name into a process and
   proposition. Because many queues can map to one process, the mapping
   lives here at queue grain.
   EDIT THIS when a new queue appears in the exports, or when a queue's
   process assignment changes. The QueueName must match EXACTLY what the
   Blue Prism export carries.
   ===================================================================== */
IF OBJECT_ID('core.RefQueueMap') IS NOT NULL DROP TABLE core.RefQueueMap;
GO
CREATE TABLE core.RefQueueMap (
    QueueName        NVARCHAR(200) NOT NULL PRIMARY KEY,  -- raw BP queue name
    ProcessId        INT           NOT NULL
        REFERENCES core.RefProcess(ProcessId),
    -- optional: a process can have logical stages spread across queues.
    -- StageName labels a queue as a stage of its process
    -- (e.g. "Validation", "Submission"). NULL if the process is single-stage.
    StageName        NVARCHAR(100) NULL,
    StageOrder       INT           NULL          -- for sorting stages in sequence
);
GO

/* =====================================================================
   RefResource - the robots / runtime resources (VDIs).
   Distinguishes the VDI (the machine) from the runtime resource / bot
   identity, which in Blue Prism are related but distinct. The work queue
   item's Resource value is matched to ResourceName here.

   LIFECYCLE: each VDI has an ActiveFrom and ActiveTo date. ActiveTo NULL
   means still live. Retiring a VDI is setting ActiveTo to its retirement
   date (and IsActive = 0, Status = 'retired'), never deleting it, so its
   history and its past cost contribution are preserved.

   COST CLASS: each VDI is 'prod' or 'test'. The annual cost per class is
   held, date-effective, in RefVDICostHistory. AnnualCostGBP on this row
   OVERRIDES the class rate when set (e.g. a deliberately-negotiated rate
   for one VDI) — NULL means "use the class rate".

   RENEWAL / COVERAGE WINDOW (mirrors src/reference/economics.ts's D3
   algorithm byte-for-byte — see report.fn_VdiDailyCost in
   08_report_views.sql for the SQL twin): RenewalDate is the annual renewal
   anchor; coverage tiles in 365-day cycles from it, both forward and
   backward, so re-anchoring isn't needed every renewal. Within the cycle
   containing a given date:
     - a LicenseExpiryDate (if set) shortens that cycle: coverage stops the
       day AFTER LicenseExpiryDate, so the same annual figure is divided
       across fewer days (each covered day costs a bit more).
     - Status = 'retired' with ActiveTo ALSO cuts the cycle short at ActiveTo.
     - outside the resulting window a VDI costs £0 AND has zero available
       capacity that day, full stop, until covered again by a new renewal.
   EDIT THIS to add a VDI, retire one (set ActiveTo, IsActive = 0 and
   Status = 'retired'), record a renewal (bump RenewalDate), record a
   licence expiry (set LicenseExpiryDate), or change a VDI's class/rate.
   ===================================================================== */
IF OBJECT_ID('core.RefResource') IS NOT NULL DROP TABLE core.RefResource;
GO
CREATE TABLE core.RefResource (
    ResourceName     NVARCHAR(200) NOT NULL PRIMARY KEY,  -- matches item.Resource (raw value)
    BotName          NVARCHAR(200) NULL,   -- human-readable bot name shown in PBI
    BotAcronym       NVARCHAR(20)  NULL,    -- short code for compact labels
    VDIName          NVARCHAR(200) NULL,   -- the underlying virtual desktop machine
    CostClass        NVARCHAR(10)  NOT NULL DEFAULT 'prod', -- 'prod' or 'test'
    -- HUB & SPOKE: the spoke whose infra pool this VDI belongs to. The per-
    -- class £ rates (RefVDICostHistory) are hub-set and universally true;
    -- WHICH VDIs a spoke pays for is decided here. NULL = hub-owned (test/
    -- shared machines) — those land in the shared hub pool instead.
    SpokeId          INT           NULL
        REFERENCES core.RefSpoke(SpokeId),
    ActiveFrom       DATE          NOT NULL,                -- date the VDI entered service
    ActiveTo         DATE          NULL,                    -- retirement date; NULL = still live
    Notes            NVARCHAR(500) NULL,    -- optional, e.g. "shared with Finance batch"
    IsActive         BIT           NOT NULL DEFAULT 1,
    -- --- VDI renewal / coverage-window fields (see comment above) ---
    RenewalDate       DATE          NOT NULL,               -- annual-cycle anchor date
    AnnualCostGBP     DECIMAL(12,2) NULL,                   -- overrides the CostClass rate when set
    LicenseExpiryDate DATE          NULL,                   -- last day of licensed cover, if any
    Status            NVARCHAR(10)  NOT NULL DEFAULT 'active', -- 'active' or 'retired'
    CONSTRAINT CK_RefResource_CostClass CHECK (CostClass IN ('prod','test')),
    CONSTRAINT CK_RefResource_Status CHECK (Status IN ('active','retired'))
);
GO

/* =====================================================================
   RefVDICostHistory - date-effective annual cost per VDI cost class.
   Infrastructure cost derives from the VDIs live at a point in time,
   valued at the class rate in force then. Rates change over time, so
   this is a history table: one row per class per effective-from date.
   EDIT THIS when the per-VDI prod or test cost changes; insert a new row
   with the date the new rate took effect, do not edit old rows.
   Figures are blended ANNUALISED costs per single VDI of that class.
   ===================================================================== */
IF OBJECT_ID('core.RefVDICostHistory') IS NOT NULL DROP TABLE core.RefVDICostHistory;
GO
CREATE TABLE core.RefVDICostHistory (
    CostClass        NVARCHAR(10)  NOT NULL,   -- 'prod' or 'test'
    EffectiveFrom    DATE          NOT NULL,
    AnnualCostPerVDIGBP DECIMAL(12,2) NOT NULL,
    CONSTRAINT PK_RefVDICostHistory PRIMARY KEY (CostClass, EffectiveFrom),
    CONSTRAINT CK_RefVDICostHistory_Class CHECK (CostClass IN ('prod','test'))
);
GO

/* =====================================================================
   RefEstateCostHistory - time-varying WORKING ASSUMPTIONS (+ TeamAnnualCostGBP,
   retained for schema parity only — see the note below).

   Working days per year and productive hours per day change over time too,
   so this table holds a row PER COST PERIOD, each effective from a date
   until the next supersedes it, same effective-dating rule as every other
   Ref* history table.

   TeamAnnualCostGBP IS NO LONGER THE SOURCE OF HUB TEAM COST. It is kept
   here purely for backward-compatible schema parity with
   data/reference/reference.json's estateCostHistory[].teamAnnualCostGBP
   field (which is itself retained only for the same reason). The actual,
   SOLE source of truth for the hub's people run-rate is
   core.RefPeopleCostHistory (OwnerId = 'HUB') below — see
   report.vw_EstateRateByDate, which reads WorkingDaysPerYear /
   ProductiveHoursPerDay from THIS table but TeamAnnualCostGBP from
   RefPeopleCostHistory instead. Do not edit this table's TeamAnnualCostGBP
   expecting it to move the hub pool; edit RefPeopleCostHistory instead.

   INFRASTRUCTURE COST IS NOT HERE. It derives from the VDI estate that
   was live at the time (RefResource lifecycle/coverage-window +
   RefVDICostHistory class rates), so retiring or adding VDIs changes
   infra cost automatically. See report.vw_EstateRateByDate.

   SENSITIVITY: only BLENDED, AGGREGATE figures go in this table (and in
   RefPeopleCostHistory). Never enter individual people or their salaries.
   ===================================================================== */
IF OBJECT_ID('core.RefEstateCostHistory') IS NOT NULL DROP TABLE core.RefEstateCostHistory;
GO
CREATE TABLE core.RefEstateCostHistory (
    EffectiveFrom           DATE          NOT NULL PRIMARY KEY,
    TeamAnnualCostGBP       DECIMAL(14,2) NOT NULL,   -- schema parity only; NOT read for cost calc — see RefPeopleCostHistory
    WorkingDaysPerYear      INT           NOT NULL DEFAULT 252,
    ProductiveHoursPerDay   DECIMAL(5,2)  NOT NULL DEFAULT 7.5,
    Note                    NVARCHAR(300) NULL         -- optional, e.g. "two joiners in Pensions"
);
GO

/* =====================================================================
   RefPeopleCostHistory - date-effective people run-rate, per owner.

   OwnerId = 'HUB' is the SOLE source of truth for the hub CoE team's
   people cost used in the cost engine (report.vw_EstateRateByDate reads
   it, in-force by EffectiveFrom, exactly like every other rate table
   here). A pay award or headcount change is a NEW row with the new
   EffectiveFrom; history is never re-valued by editing an old row.

   OwnerId can ALSO be a spoke id (as a string, e.g. '1'), carried purely
   as INFORMATIONAL reference data for a spoke's own reporting — spoke
   people cost is NEVER charged into estate economics (only a spoke's VDI
   infra cost is; see RefResource.SpokeId). Do not join spoke rows here
   into any cost view.

   SENSITIVITY: only BLENDED, AGGREGATE figures go in this table, same as
   RefEstateCostHistory. Never enter individual people or their salaries.
   EDIT THIS on a hire, leaver or pay award: insert a new row with the new
   EffectiveFrom; never edit an old row's figures.
   ===================================================================== */
IF OBJECT_ID('core.RefPeopleCostHistory') IS NOT NULL DROP TABLE core.RefPeopleCostHistory;
GO
CREATE TABLE core.RefPeopleCostHistory (
    OwnerId          NVARCHAR(20)  NOT NULL,   -- 'HUB', or a spokeId as a string (informational only)
    Headcount        INT           NOT NULL,
    AnnualCostGBP    DECIMAL(14,2) NOT NULL,   -- blended, pooled, never per-person
    EffectiveFrom    DATE          NOT NULL,
    Note             NVARCHAR(300) NULL,
    CONSTRAINT PK_RefPeopleCostHistory PRIMARY KEY (OwnerId, EffectiveFrom)
);
GO

/* =====================================================================
   RefExceptionType - classifies an exception reason as Business or
   System. Blue Prism does NOT store this split natively.

   PREFERRED APPROACH (best practice): processes should prefix the
   exception detail at source with a standard token, "Business Exception"
   or "System Exception", e.g. "System Exception: timeout waiting for
   mainframe". The merge reads that prefix first and classifies
   deterministically, with no pattern maintenance. This table is the
   TRANSITIONAL FALLBACK for exceptions that are not yet prefixed.

   As processes adopt the prefix convention (new builds as standard,
   existing ones retrofitted), the patterns here matter less and the list
   should shrink toward zero. See the runbook for the convention and how
   to retrofit processes and historic data.

   EDIT THIS to refine fallback classification: add a pattern, point it at
   a type. Patterns are matched with LIKE, so use % wildcards. Longer /
   more specific patterns should have higher Priority so they win.
   ===================================================================== */
IF OBJECT_ID('core.RefExceptionType') IS NOT NULL DROP TABLE core.RefExceptionType;
GO
CREATE TABLE core.RefExceptionType (
    PatternId        INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    MatchPattern     NVARCHAR(200) NOT NULL,   -- e.g. '%timeout%'
    ExceptionType    NVARCHAR(20)  NOT NULL,   -- 'System' or 'Business'
    Priority         INT           NOT NULL DEFAULT 100  -- higher wins on ties
);
GO

/* =====================================================================
   DimCalendar - a proper date dimension.
   THIS IS WHERE THE MONTH-SORTING PROBLEM IS SOLVED. Power BI sorts text
   alphabetically, so "Apr-26" lands before "Jan-26". The fix is to give
   PBI a label column (MonthLabel, e.g. 'Jan-26') AND a numeric sort key
   (MonthSortKey, e.g. 202601) in the same table. In Power BI, set the
   label's "Sort by column" to the sort key, once, and every visual then
   orders months chronologically forever.
   Built by 04_build_calendar.sql.
   ===================================================================== */
IF OBJECT_ID('core.DimCalendar') IS NOT NULL DROP TABLE core.DimCalendar;
GO
CREATE TABLE core.DimCalendar (
    DateKey          INT          NOT NULL PRIMARY KEY,   -- yyyymmdd, e.g. 20260131
    [Date]           DATE         NOT NULL,
    DayOfMonth       INT          NOT NULL,
    DayName          NVARCHAR(10) NOT NULL,
    WeekStart        DATE         NOT NULL,                -- Monday of that week
    MonthNumber      INT          NOT NULL,                -- 1..12
    MonthName        NVARCHAR(10) NOT NULL,                -- 'January'
    MonthShort       NVARCHAR(3)  NOT NULL,                -- 'Jan'
    MonthLabel       NVARCHAR(7)  NOT NULL,                -- 'Jan-26'  <-- display
    MonthSortKey     INT          NOT NULL,                -- 202601    <-- sort by
    [Quarter]        INT          NOT NULL,                -- 1..4
    QuarterLabel     NVARCHAR(7)  NOT NULL,                -- 'Q1-26'
    QuarterSortKey   INT          NOT NULL,                -- 20261
    [Year]           INT          NOT NULL,
    IsWeekend        BIT          NOT NULL
);
GO
