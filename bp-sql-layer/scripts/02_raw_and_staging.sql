/* =====================================================================
   02_raw_and_staging.sql
   ---------------------------------------------------------------------
   The landing zone (raw) and the typed copy (staging).

   WHY TWO LAYERS:
   The files pulled off the shared drive are messy: dates as text,
   everything as strings, possible blank rows. raw accepts them exactly
   as they are so a bad file never breaks a load. staging is where the data is
   convert to proper types ONCE, in one place, so nothing downstream has
   to worry about parsing dates or numbers again.

   COLUMN SHADOWING THE REAL BP SCHEMA:
   These columns are the BPAWorkQueueItem fields as they appear in a
   standard work queue export in Blue Prism 7.2:
     ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
     LoadedDate, LastUpdatedDate, DeferredDate, LockedDate,
     CompletedDate, Worktime, ExceptionDate, ExceptionReason
   plus QueueName, which is captured so the source queue of each file
   belongs to (the export is per queue).
   ===================================================================== */
USE BPAnalytics;
GO

/* ---------- RAW: everything text, nothing rejected ---------- */
IF OBJECT_ID('raw.WorkQueueItem') IS NOT NULL DROP TABLE raw.WorkQueueItem;
GO
CREATE TABLE raw.WorkQueueItem (
    ID               NVARCHAR(100)  NULL,
    KeyValue         NVARCHAR(400)  NULL,
    Priority         NVARCHAR(50)   NULL,
    Status           NVARCHAR(100)  NULL,
    Tags             NVARCHAR(1000) NULL,
    Resource         NVARCHAR(200)  NULL,
    Attempt          NVARCHAR(50)   NULL,
    LoadedDate       NVARCHAR(50)   NULL,
    LastUpdatedDate  NVARCHAR(50)   NULL,
    DeferredDate     NVARCHAR(50)   NULL,
    LockedDate       NVARCHAR(50)   NULL,
    CompletedDate    NVARCHAR(50)   NULL,
    Worktime         NVARCHAR(50)   NULL,
    ExceptionDate    NVARCHAR(50)   NULL,
    ExceptionReason  NVARCHAR(1000) NULL,
    QueueName        NVARCHAR(200)  NULL,   -- which queue this file came from
    -- load provenance, useful for debugging a bad pull
    SourceFile       NVARCHAR(400)  NULL,
    LoadBatchId      UNIQUEIDENTIFIER NULL
);
GO

/* ---------- STAGING: typed, cleaned, still item grain ---------- */
IF OBJECT_ID('staging.WorkQueueItem') IS NOT NULL DROP TABLE staging.WorkQueueItem;
GO
CREATE TABLE staging.WorkQueueItem (
    ID               NVARCHAR(100)  NOT NULL,
    KeyValue         NVARCHAR(400)  NULL,
    Priority         INT            NULL,
    Status           NVARCHAR(100)  NULL,
    Tags             NVARCHAR(1000) NULL,
    Resource         NVARCHAR(200)  NULL,
    Attempt          INT            NULL,
    LoadedDate       DATETIME2(0)   NULL,
    LastUpdatedDate  DATETIME2(0)   NULL,
    DeferredDate     DATETIME2(0)   NULL,
    LockedDate       DATETIME2(0)   NULL,
    CompletedDate    DATETIME2(0)   NULL,
    Worktime         INT            NULL,
    ExceptionDate    DATETIME2(0)   NULL,
    ExceptionReason  NVARCHAR(1000) NULL,
    QueueName        NVARCHAR(200)  NULL,
    LoadBatchId      UNIQUEIDENTIFIER NULL
);
GO
CREATE INDEX IX_staging_ID ON staging.WorkQueueItem (ID);
GO
