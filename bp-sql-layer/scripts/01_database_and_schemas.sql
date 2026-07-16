/* =====================================================================
   01_database_and_schemas.sql
   ---------------------------------------------------------------------
   Creates the database and the schema layers. Run this first, once.

   The design uses four schemas so every object's job is obvious from its
   name. Data flows left to right through them:

     raw   ->  staging  ->  core (dim + fact)  ->  report (views)

   raw      Landing zone. Columns match the Blue Prism BPAWorkQueueItem
            export exactly, all text, no typing, no logic. Whatever the
            file/extract provides lands here untouched.
   staging  Typed and cleaned copy of raw. Dates become real dates,
            numbers become numbers, text is trimmed. Still item grain.
   core     The model. Dimension tables (process, proposition, resource,
            calendar, cost) and the fact table at case grain. This is the
            single source of truth the merge maintains.
   report   Views only. These are what Power BI connects to. No base
            tables here, just presentation-shaped queries over core.

   Naming conventions used throughout:
     - schemas lower case: raw, staging, core, report
     - tables PascalCase singular-ish: core.FactWorkItem, core.DimProcess
     - dimension tables prefixed Dim, fact tables prefixed Fact
     - views prefixed vw_ and live only in report
     - reference/lookup tables the team edits are in core, prefixed Ref
   ===================================================================== */

IF DB_ID('BPAnalytics') IS NULL
    CREATE DATABASE BPAnalytics;
GO
USE BPAnalytics;
GO

IF SCHEMA_ID('raw')     IS NULL EXEC('CREATE SCHEMA raw');
GO
IF SCHEMA_ID('staging') IS NULL EXEC('CREATE SCHEMA staging');
GO
IF SCHEMA_ID('core')    IS NULL EXEC('CREATE SCHEMA core');
GO
IF SCHEMA_ID('report')  IS NULL EXEC('CREATE SCHEMA report');
GO
