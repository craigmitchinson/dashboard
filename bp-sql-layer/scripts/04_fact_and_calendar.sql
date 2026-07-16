/* =====================================================================
   04_fact_and_calendar.sql
   ---------------------------------------------------------------------
   The fact table (case grain) and the calendar populate.
   ===================================================================== */
USE BPAnalytics;
GO

/* =====================================================================
   FactWorkItem - one row per work queue item (per case). This is the
   single source of truth the MERGE keeps in step with the source.
   Outcome and ExceptionType are derived at merge time and stored, so
   Power BI never has to compute them.
   ===================================================================== */
IF OBJECT_ID('core.FactWorkItem') IS NOT NULL DROP TABLE core.FactWorkItem;
GO
CREATE TABLE core.FactWorkItem (
    ID               NVARCHAR(100) NOT NULL PRIMARY KEY,   -- BP item id = case identity
    QueueName        NVARCHAR(200) NOT NULL,
    ProcessId        INT           NULL,                    -- resolved via RefQueueMap
    KeyValue         NVARCHAR(400) NULL,
    Resource         NVARCHAR(200) NULL,
    Attempt          INT           NULL,
    Tags             NVARCHAR(1000) NULL,
    Priority         INT           NULL,

    LoadedDate       DATETIME2(0)  NULL,
    LastUpdatedDate  DATETIME2(0)  NULL,                    -- the merge change-detector
    CompletedDate    DATETIME2(0)  NULL,
    ExceptionDate    DATETIME2(0)  NULL,
    Worktime         INT           NULL,                    -- seconds

    -- derived and stored at merge time:
    Outcome          NVARCHAR(20)  NOT NULL,                -- Completed/Exception/Pending
    ExceptionType    NVARCHAR(20)  NULL,                    -- Business/System/NULL
    ExceptionReason  NVARCHAR(1000) NULL,
    OutcomeDateKey   INT           NULL,                    -- FK to DimCalendar.DateKey

    -- housekeeping
    FirstLoadedAt    DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    LastMergedAt     DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_Fact_ProcessId     ON core.FactWorkItem (ProcessId);
CREATE INDEX IX_Fact_OutcomeDateKey ON core.FactWorkItem (OutcomeDateKey);
CREATE INDEX IX_Fact_Outcome        ON core.FactWorkItem (Outcome);
GO

/* =====================================================================
   Build the calendar. Covers a fixed range; extend EndDate as needed.
   The two label/sort-key pairs (month and quarter) are the whole point:
   they make Power BI sort time chronologically instead of alphabetically.
   ===================================================================== */
DECLARE @StartDate DATE = '2023-01-01';
DECLARE @EndDate   DATE = '2027-12-31';

;WITH d AS (
    SELECT @StartDate AS dt
    UNION ALL
    SELECT DATEADD(DAY, 1, dt) FROM d WHERE dt < @EndDate
)
INSERT INTO core.DimCalendar (
    DateKey, [Date], DayOfMonth, DayName, WeekStart,
    MonthNumber, MonthName, MonthShort, MonthLabel, MonthSortKey,
    [Quarter], QuarterLabel, QuarterSortKey, [Year], IsWeekend
)
SELECT
    CONVERT(INT, FORMAT(dt, 'yyyyMMdd'))                       AS DateKey,
    dt                                                          AS [Date],
    DAY(dt)                                                     AS DayOfMonth,
    DATENAME(WEEKDAY, dt)                                       AS DayName,
    DATEADD(DAY, 1 - (((DATEPART(WEEKDAY, dt) + 5) % 7) + 1), dt) AS WeekStart, -- Monday
    MONTH(dt)                                                   AS MonthNumber,
    DATENAME(MONTH, dt)                                         AS MonthName,
    LEFT(DATENAME(MONTH, dt), 3)                                AS MonthShort,
    -- MonthLabel e.g. 'Jan-26'
    LEFT(DATENAME(MONTH, dt), 3) + '-' + RIGHT(CONVERT(VARCHAR, YEAR(dt)), 2) AS MonthLabel,
    -- MonthSortKey e.g. 202601
    YEAR(dt) * 100 + MONTH(dt)                                  AS MonthSortKey,
    DATEPART(QUARTER, dt)                                       AS [Quarter],
    'Q' + CONVERT(VARCHAR, DATEPART(QUARTER, dt)) + '-' + RIGHT(CONVERT(VARCHAR, YEAR(dt)), 2) AS QuarterLabel,
    YEAR(dt) * 10 + DATEPART(QUARTER, dt)                       AS QuarterSortKey,
    YEAR(dt)                                                    AS [Year],
    CASE WHEN DATENAME(WEEKDAY, dt) IN ('Saturday','Sunday') THEN 1 ELSE 0 END AS IsWeekend
FROM d
OPTION (MAXRECURSION 0);
GO
