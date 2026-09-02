<!-- GENERATED FILE — do not hand-edit. Edit src/pages/playbook-content.ts (or its data module) and run "npm run docs:playbook" to regenerate. -->

# Operational Playbook — Intelligent Automation — Performance

How to run, extend and troubleshoot this dashboard, in plain English. Every section below also renders as an in-app page (Playbook, in the Reference group) — both come from the same content module, so they never drift apart.

## Contents

- [1. What this is](#1-what-this-is)
- [2. Plugging in your Elastic (and Blue Prism) APIs](#2-plugging-in-your-elastic-and-blue-prism-apis)
- [3. The SQL layer](#3-the-sql-layer)
- [4. The data API (server/)](#4-the-data-api-server)
- [5. Deploying to GCP](#5-deploying-to-gcp)
- [6. Reference data lifecycle](#6-reference-data-lifecycle)
- [7. Adding a new hub/spoke (squad)](#7-adding-a-new-hubspoke-squad)
- [8. Users, roles & sign-in](#8-users-roles-sign-in)
- [9. How data reaches each visual](#9-how-data-reaches-each-visual)
- [10. Performance & scale (50-100M rows)](#10-performance-scale-50-100m-rows)
- [11. Accessibility & personalisation](#11-accessibility-personalisation)
- [12. Tests & CI](#12-tests-ci)
- [13. Runbook & troubleshooting](#13-runbook-troubleshooting)
- [14. Thresholds & alerting](#14-thresholds-alerting)

## 1. What this is

This is Intelligent Automation — Performance: the hub-and-spoke Intelligent Automation Centre of Excellence's (IA CoE) monitoring dashboard, a React single-page app built with Vite. Every number on every page traces back through a fixed pipeline — nothing is invented in the browser.

### Data lineage

- Elastic / Kibana (log/event store) — the preferred ingestion route: Blue Prism ships queue activity here via Data Gateways, and pulling from Elastic has no further impact on the Blue Prism production database
- Blue Prism work queue API — the documented alternative route, used when the estate doesn't ship Blue Prism activity to Elastic; a direct pull hits the live BP estate itself, and REST paging is impractical for large backfills
- CSV in the BPAWorkQueueItem 16-column schema — the universal swap point between everything upstream and everything downstream; both adapters write the identical contract
- SQL warehouse (raw → staging → core → report schemas) — where every dollar/rate/date calculation actually happens
- Two final hops, both built from the exact same code: in production, the SQL warehouse is read live by the data API (server/, see section 4) over the report.vw_Model*/report.vw_Dim*/report.vw_EstateRateByDate views; for local development and the demo, tools/build-dashboard-data.mjs bakes the same CSV + reference data straight into a static model.json instead. Either path's very last step is shared/model-assembler.mjs — the one function that turns "rowsets" into the exact ModelJson the dashboard reads — so the live-API path and the static-JSON path cannot quietly diverge. A CI test (server/test/assembler.test.ts) proves this on every push: it replays the static build's own view-port fixtures through that same assembler and asserts the result is byte-for-byte identical to public/data/model.json.
- This dashboard's visuals — charts and tables that only sum and display what already arrived pre-resolved

> **Info:** The browser client only ever aggregates (sums) numbers and reads pre-resolved rates — all benefit/cost/rate math happens upstream in the pipeline (the Node build script or the SQL views), never in the browser. The client also never sees the full set of raw item-level rows at once — only day×process aggregates. Section 8 has the real row counts.

## 2. Plugging in your Elastic (and Blue Prism) APIs

There are two adapters under bp-sql-layer/ingest/, both writing the same 16-column BPAWorkQueueItem CSV — the universal swap point. Which one you run depends on how your estate is set up; many teams only ever need the first.

> **Info:** Preferred route: bp-sql-layer/ingest/elastic_to_csv.py pulls from Elastic — the Kibana-backed store Blue Prism already ships queue activity into via Data Gateways — so it has no further impact on the Blue Prism production database. Documented alternative: bp-sql-layer/ingest/bp_api_to_csv.py, which pulls directly from the Blue Prism work queue REST API for estates that don't ship activity to Elastic (or that need authoritative current item state); that path adds direct load to the live BP environment. Both write the identical CSV contract, so everything downstream — the SQL load, the merge, the report views, the dashboard — is unaffected by which one you run.

### Preferred: the Elastic / Kibana adapter (elastic_to_csv.py)

elastic_to_csv.py queries your Elasticsearch cluster for Blue Prism work-queue-item documents — the same activity Blue Prism ships there via Data Gateways — and writes them out as the same 16-column CSV. This is the preferred route because it only ever reads from Elastic: it has no further impact on the Blue Prism production database, unlike a direct pull against the live BP API/database. It's also the route to use when Elastic is the longer-retention copy of history (Blue Prism's own database purges/archives completed items faster than your pull cadence).

| Env var | Purpose |
| --- | --- |
| ELASTIC_URL | Elasticsearch/Kibana cluster URL |
| ELASTIC_INDEX | index pattern to query, e.g. bp-workqueueitems-* |
| ELASTIC_API_KEY | ApiKey auth (preferred) |
| ELASTIC_USER / ELASTIC_PASSWORD | Basic auth alternative if no API key |
| ELASTIC_VERIFY_TLS | set "false" to skip TLS cert verification (default true — leave it alone unless you know why) |
| FROM_DATE / TO_DATE | ISO date bounds filtering on lastupdateddate — this is the watermark |
| FIELD_MAP_JSON | optional JSON object to override source field names if your Elastic documents use different field names than the script expects |
| OUT_CSV | output CSV path (default ./workqueueitems.csv) |
| PAGE_SIZE | Elastic search_after page size (default 5000) |
| BP_WORKTIME_UNIT | Unit of the Elastic index's Worktime field: "ms" or "s", converted to whole seconds before writing (default "s" — verify which unit your Elastic index actually stores; this default differs from bp_api_to_csv.py's default of "ms") |

Authentication: the script uses ApiKey header auth if ELASTIC_API_KEY is set, otherwise it falls back to Basic auth built from ELASTIC_USER / ELASTIC_PASSWORD. Running it stand-alone (no SQL_* env vars set) has no built-in overlap-window knob — schedule pulls with deliberate overlap yourself (see section 10). Running it as part of the Cloud SQL pipeline job (section 2's "Cloud SQL for SQL Server" subsection) does add one — ELASTIC_WATERMARK_OVERLAP_HOURS — once SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD are all set. The two things to get right before trusting this path either way: confirm the Data Gateways event-stream shipping Blue Prism activity into Elastic is actually configured and current (it can lag or drop events if misconfigured), and confirm BP_WORKTIME_UNIT matches what your index really stores.

### Alternative: the Blue Prism API adapter (bp_api_to_csv.py)

Logs in to the Blue Prism Authentication Server ("Hub") with OAuth2 client-credentials, asks the Blue Prism 7.x Web API for the list of work queues, then pulls the items on each queue directly — no Elastic in the loop. Use this when your estate doesn't ship activity to Elastic via Data Gateways, or when you specifically need authoritative current item state without a Data Gateways dependency in the way. It pulls directly against the live Blue Prism environment, so — unlike the Elastic route — it does add load to the BP estate itself, and its history depth is limited to whatever the BP database hasn't yet purged. Each queue keeps its own watermark (the last-seen LastUpdatedDate) in a small JSON state file, and every run re-checks a rolling overlap window behind that watermark — not just "since last time" — because a work queue item keeps mutating in place (Pending → Locked → Completed/Exception, sometimes across retried attempts) and a mutation landing right at the edge of a narrow window could otherwise be missed forever.

| Env var | Purpose | Required? |
| --- | --- | --- |
| BP_AUTH_URL | OAuth2 token endpoint on the Blue Prism Authentication Server (Hub) | Yes |
| BP_CLIENT_ID / BP_CLIENT_SECRET | OAuth2 client-credentials for the pull | Yes |
| BP_API_URL | Base URL of the Blue Prism 7.x Web API (e.g. https://bp.corp/api) | Yes |
| BP_OAUTH_SCOPE | OAuth2 scope to request, only if your Auth Server needs one | No |
| BP_QUEUE_NAMES | Comma-separated queue names to pull; empty/unset = every queue the API returns | No |
| BP_PAGE_SIZE | Items requested per page (default 1000) | No |
| BP_STATE_FILE | Path to the JSON watermark state file (default ./bp_api_watermark.json) — this is where each queue's "last seen" point actually lives | No |
| WATERMARK_OVERLAP_HOURS | Hours to re-pull behind each queue's stored watermark on every run (default 24) | No |
| BP_SINCE | ISO-8601 floor date, used only on the very first run (no state file yet) so it doesn't default to pulling all history | No |
| BP_OUTPUT_CSV | Output CSV path (default ./workqueueitems_api.csv; overridden by --output) | No |
| BP_WORKTIME_UNIT | Unit of the API's Worktime field: "ms" or "s", converted to whole seconds before writing (default "ms" — differs from elastic_to_csv.py's default of "s") | No |
| BP_FIELD_MAP_JSON | JSON overriding the default API-field → CSV-column map (see the caveat below) | No |
| BP_REQUEST_TIMEOUT / BP_MAX_RETRIES / BP_VERIFY_TLS | HTTP timeout (default 30s), retry attempts on 429/5xx (default 5), and TLS verification (default true) | No |

> **Note:** The script's own docstring is explicit that it was written without access to a live Blue Prism 7.x Web API / Swagger document: every entry in its API-field-to-CSV-column mapping is marked ASSUMPTION (e.g. whether the queue-item id field is really called "id", whether Worktime is really milliseconds, whether pagination really uses skip/take). Before relying on this in production, check your own instance's Swagger/OpenAPI page (typically {BP_API_URL}/swagger) and correct any mismatches via BP_FIELD_MAP_JSON — no code changes needed. Run it with --dry-run first: it prints the resolved config and which queues it would pull without fetching a single item.

On a queue's very first pull (no state file yet), if BP_SINCE isn't set the script pulls that queue's entire history through the REST API — and prints a loud warning to say so. Don't let that happen at real scale: REST paging is impractical for large backfills — see section 10's backfill guidance.

### Landing the CSV: two different targets

Neither adapter writes straight into SQL — that's the next stage, and which mechanism you use depends on where your SQL Server actually lives. For the demo dashboard, the equivalent path is simply data/mock/BPAWorkQueueItem.csv feeding npm run data:build.

On-prem or self-managed SQL Server (the SQL Server engine's own process can see a local disk or network share): edit the @File path near the top of bp-sql-layer/scripts/10_bulk_load_csv.sql to point at the adapter's CSV, then run the whole script — it clears raw.WorkQueueItem, BULK INSERTs the file, stamps provenance, and calls core.usp_RunPull automatically. Nothing else in this subsection applies to that path.

> **Note:** Cloud SQL for SQL Server (the GCP production target): BULK INSERT ... FROM '<path>' is NOT viable — the SQL Server engine process itself has no filesystem to read a local or UNC path from on Cloud SQL (verified against Google Cloud's own Cloud SQL for SQL Server import/export documentation; Cloud SQL's own answer, the msdb.dbo.gcloudsql_bulk_insert stored procedure, reads from a Google Cloud Storage bucket instead — a materially different shape this pipeline doesn't adopt). Cloud SQL production deployments use bp-sql-layer/ingest/run_pipeline.py instead of 10_bulk_load_csv.sql — see below. 10_bulk_load_csv.sql itself is not deprecated, only inapplicable to Cloud SQL; keep using it for the on-prem path above.

### Cloud SQL for SQL Server: the pipeline job (run_pipeline.py)

run_pipeline.py is what the ingest Cloud Run Job's container runs on every scheduled pull. It orchestrates one full pull end to end: BP_ADAPTER selects elastic_to_csv.py or bp_api_to_csv.py, which writes CSV_PATH; then bp-sql-layer/ingest/load_to_sql.py's load_and_merge() reads that CSV itself — over the ODBC driver's own batched, parameterized insert path (pyodbc's fast_executemany, 5,000 rows per batch/transaction by default) — TRUNCATEs and reloads raw.WorkQueueItem, calls the same core.usp_RunPull the on-prem path calls, verifies row counts, and writes a core.PipelineRun row recording the outcome (see section 3's 11_pipeline_ops.sql).

| Env var | Purpose | Default |
| --- | --- | --- |
| BP_ADAPTER | 'elastic' or 'api' — which adapter run_pipeline.py runs | elastic |
| CSV_PATH | Where the adapter writes and the loader reads (the ingest container sets this to /app/work/workqueueitems.csv) | ./workqueueitems.csv |
| IN_FLIGHT_STALE_MINUTES | A Status='running' core.PipelineRun row older than this is presumed crashed, not blocking | 30 |
| LOAD_BATCH_SIZE | Rows per INSERT batch / per transaction, passed to load_to_sql.py | 5000 |
| SQL_SERVER / SQL_PORT / SQL_DATABASE / SQL_USER / SQL_PASSWORD | Cloud SQL private-IP connection — required unless --dry-run; SQL_PASSWORD is Secret Manager-backed in production | — |
| SQL_ENCRYPT / SQL_TRUST_SERVER_CERTIFICATE / SQL_CA_CERT_PATH / SQL_CONNECT_TIMEOUT_SECONDS | TDS encryption, certificate validation and timeout tuning — see bp-sql-layer/ingest/sqlconn.py | yes / no / — / 30 |

Durable watermark, not a local file: a Cloud Run Job's container filesystem does not survive between executions, so when the SQL_* vars above are all set, both adapters read/write their "how far have we pulled" marker from core.IngestWatermark (one row per source/queue) instead of a local JSON file or a manually-set FROM_DATE/TO_DATE — see section 3's 11_pipeline_ops.sql. Every pull still re-checks a deliberate overlap window behind that stored value (WATERMARK_OVERLAP_HOURS for the Blue Prism API adapter, ELASTIC_WATERMARK_OVERLAP_HOURS for the Elastic adapter), for the same reason as always: a work item mutating in place near the edge of a narrow window could otherwise be missed forever. Without SQL_* configured (a manual run on a laptop, or against an on-prem/self-managed SQL Server), both adapters fall straight back to their local JSON state file / FROM_DATE-TO_DATE behaviour — nothing changes for that path.

Overlap guard: before doing anything else, run_pipeline.py checks core.usp_GetInFlightRun and exits cleanly (not a failure — this is a deliberate no-op) if another run is already Status='running' and started less than IN_FLIGHT_STALE_MINUTES ago. This sits on top of — not instead of — Cloud Scheduler's own cadence and the Cloud Run Job's own --max-retries=0 --task-count=1 --parallelism=1 settings, because neither of those is a hard guarantee against a manual gcloud run jobs execute racing a scheduled run, or a Scheduler retry racing a slow-to-fail trigger.

Container and cadence: bp-sql-layer/ingest/Dockerfile builds a python:3.12-slim image with the Microsoft ODBC Driver 18 for SQL Server installed, non-root, ENTRYPOINT ["python", "run_pipeline.py"]. Cloud Scheduler triggers one execution of the bp-ingest-pull Cloud Run Job on a cron schedule (default every 15 minutes) by calling the Cloud Run Admin API's :run method directly, because Cloud Run Jobs — unlike services — have no HTTPS invocation URL of their own to hit. See section 5 (Deploying to GCP) for the full deploy sequence and section 10 for what to check after a run.

Demo-vs-production swap: today the repo runs on tools/generate-mock-data.mjs (deterministic, ~231,660 mock queue items, run via npm run data:mock). A real deployment replaces this entirely with elastic_to_csv.py (or bp_api_to_csv.py as the alternative) writing a real CSV in the same 16-column schema, which then flows into the exact same SQL/build pipeline. The schema is the contract: nothing else has to change.

### First real data pull checklist

- [ ] Decide which adapter you actually need: Elastic (elastic_to_csv.py) by default — it only reads from Elastic, so it has no further impact on the Blue Prism production database — unless your estate doesn't ship activity to Elastic via Data Gateways, or you specifically need authoritative current item state, in which case use the Blue Prism API adapter (bp_api_to_csv.py)
- [ ] If using the Elastic adapter: confirm your Elastic index actually contains Blue Prism work-queue-item documents (check field names against the 16-column contract; use FIELD_MAP_JSON if they differ) and confirm BP_WORKTIME_UNIT matches what the index actually stores; set ELASTIC_URL, ELASTIC_INDEX, and either ELASTIC_API_KEY or ELASTIC_USER/ELASTIC_PASSWORD
- [ ] If using the Blue Prism API adapter (the alternative): run it with --dry-run first to confirm the OAuth client-credentials work against BP_AUTH_URL and the queues it lists are the ones you expect; set BP_API_URL, BP_CLIENT_ID/BP_CLIENT_SECRET, BP_QUEUE_NAMES, and a BP_SINCE floor for the first real run
- [ ] Run a small, bounded pull first: a short recent date/watermark window and a small output path — don't pull your entire history through either adapter on the first try (see section 10 on backfill: history should come from a bulk export, not the REST API)
- [ ] Open the resulting CSV and check it has exactly the 16 expected columns in a sane state (no everything-blank rows)
- [ ] Point bp-sql-layer/scripts/10_bulk_load_csv.sql's @File path at the CSV and run it (or run npm run data:build path/to/that.csv for the demo pipeline)
- [ ] Check the core.usp_RunPull output (or the build script's console output) for any "unmapped queue" warnings — this means a queue in your data has no entry in RefQueueMap / reference.json's queueMap, so its activity won't show up anywhere until you map it
- [ ] Compare row counts: source CSV rows vs. what landed in core.FactWorkItem (or model.json's manifest sourceRows) — they should reconcile
- [ ] Only once that's clean, widen the pull window to your real desired ongoing delta and re-run

## 3. The SQL layer

Every script below lives under bp-sql-layer/scripts/ and is meant to be run in order the first time you stand up the warehouse. Scripts 01-10 are the core warehouse and apply everywhere; 11-13 are additive — run them too if you're standing up the production data API (section 4) and/or the Cloud SQL pipeline job (section 2), and 12 specifically as you approach real scale (section 10).

### 01_database_and_schemas.sql

Creates the BPAnalytics database and four schemas: raw (landing zone, everything as text), staging (typed and cleaned), core (the actual model: dimensions + fact table), report (read-only views for BI tools and the dashboard). Idempotent, safe to re-run any time (e.g. fresh environment setup).

### 02_raw_and_staging.sql

Creates raw.WorkQueueItem (all columns NVARCHAR, nothing cast) and staging.WorkQueueItem (typed: dates as DATETIME2(0), numbers as INT, etc.), both following the 16-column BPAWorkQueueItem schema. Re-run if you need to reset the landing/staging tables.

### 03_core_dimensions.sql

Creates the reference ("Ref") tables — RefSpoke, RefGradeRate, RefProposition, RefProcess, RefQueueMap, RefResource, RefVDICostHistory, RefEstateCostHistory, RefPeopleCostHistory, RefExceptionType — plus DimCalendar (2023-01-01 to 2027-12-31, extend the @EndDate variable if you need more years). Re-run when onboarding a new spoke, adding a process, retiring a VDI, or recording a pay review — it drops and repopulates the Ref tables but never touches the fact table.

- RefPeopleCostHistory (OwnerId, Headcount, AnnualCostGBP, EffectiveFrom, Note — PK is OwnerId+EffectiveFrom) is the SOLE source of the hub CoE team's people run-rate used in the cost engine (OwnerId = "HUB"); a spoke id as OwnerId is charged into that spoke's own pool alongside its VDI infra (apportioned within the spoke by worktime, same as infra). RefEstateCostHistory.TeamAnnualCostGBP is retained only for schema parity with data/reference/reference.json's own legacy field of the same name — it is NOT read for cost calculation; RefEstateCostHistory still supplies WorkingDaysPerYear and ProductiveHoursPerDay, just not the team cost figure. Both the SQL views and the JS/Node pipeline (economics.ts, build-dashboard-data.mjs) now agree: hub team cost always comes from RefPeopleCostHistory/peopleCostHistory (ownerId="HUB"), and each spoke's own OwnerId=<spokeId> record feeds that spoke's pool.
- RefResource carries the VDI renewal/coverage-window fields — RenewalDate (annual-cycle anchor), AnnualCostGBP (per-VDI override of the class rate), LicenseExpiryDate, and Status ("active"/"retired") — alongside the older ActiveFrom/ActiveTo lifecycle columns.

### 04_fact_and_calendar.sql

Creates core.FactWorkItem (one row per case — the single source of truth) and populates DimCalendar. Safe to re-run (rebuilds the calendar, leaves the fact table alone); normally only needed once, or to extend the calendar's date range.

### 05_proc_load_staging.sql

Creates the stored procedure staging.usp_LoadStaging, which clears and rebuilds staging.WorkQueueItem from raw.WorkQueueItem: parses dates/numbers leniently (bad values become NULL rather than failing the whole load), trims text, drops junk rows with a blank ID, and if LastUpdatedDate is missing, falls back to the most recent of CompletedDate/ExceptionDate/LockedDate/LoadedDate. Runs automatically every pull (via usp_RunPull) — you don't normally call it directly.

### 06_proc_merge_fact.sql

Creates core.usp_MergeFact, the procedure that actually merges staging into the fact table (see the dedicated explanation below — this is the important one). Runs automatically every pull.

### 07_seed_reference.sql

Inserts the team-owned reference data into all the Ref tables (spokes, grade rates, propositions, processes, queue mappings, VDIs/resources, VDI cost history, estate/team cost history, exception patterns). This is the SQL twin of data/reference/reference.json — see section 6. Re-run whenever reference data changes (this is how a DBA applies the Administration panel's exported "Download SQL sync script"). Safe to re-run — it clears and repopulates.

### 08_report_views.sql

Creates 20+ read-only views under the report schema (e.g. report.vw_DailyOutcomes, report.vw_Commercial, report.vw_KPIHeadline, report.vw_ExceptionDetail, report.vw_ResourceUtil, and more) — all money/rate calculations happen here in SQL, so nothing downstream ever recomputes them. tools/build-dashboard-data.mjs is a byte-for-byte-equivalent Node port of these views for the demo pipeline; if you ever change a view's logic here, the Node build script needs the matching change (and vice versa) or the two will disagree. Re-run only when fixing a view's logic.

This script also creates report.fn_VdiDailyCost, an inline table-valued function that replicates the client engine's VDI coverage-window algorithm byte-for-byte: 365-day renewal cycles tiled from RenewalDate, a licence expiry or retirement cutting that cycle's coverage short, the class rate (or a per-VDI AnnualCostGBP override) resolved at the cycle's start date, and the resulting annual figure divided evenly across however many days the (possibly shortened) window actually covers. vw_EstateRateByDate and vw_SpokeInfraRateByDate both call fn_VdiDailyCost per VDI per date rather than summing a naive ActiveFrom/ActiveTo lifecycle window, so SQL and the JS/Node pipeline compute identical hub and spoke infra pools.

### 09_proc_run_pull.sql

Creates core.usp_RunPull, the orchestration procedure (see below). This is the one thing you call after every data landing.

### 10_bulk_load_csv.sql

A one-off script (not a stored procedure): clears raw.WorkQueueItem, bulk-inserts your CSV, stamps provenance (source filename, load batch id), then calls core.usp_RunPull for you. Edit the @File path near the top before running. Run this once per data pull if you're loading via file rather than a custom API push.

### core.usp_RunPull — what it orchestrates

1. Snapshots the fact table's row count
2. Runs staging.usp_LoadStaging (raw → staging)
3. Runs core.usp_MergeFact (staging → fact)
4. Snapshots the row count again and prints a summary (rows staged, new rows inserted, new fact total)
5. Flags any queues present in the data but absent from RefQueueMap with a warning — so an unmapped queue never silently vanishes from the dashboard, it makes noise instead

Call sequence for every pull: load raw.WorkQueueItem (via 10_bulk_load_csv.sql or a custom API load), then EXEC core.usp_RunPull; — nothing else.

### Merge / delta semantics (core.usp_MergeFact)

The merge matches rows on ID. A matched row is only overwritten if the incoming row's LastUpdatedDate is strictly newer than what's already stored — so re-sending an unchanged or stale row is a safe no-op. An unmatched row (new ID) is inserted. The merge never deletes rows — there is deliberately no "delete rows missing from this batch" logic, because any single pull might only cover one queue's worth of data, and the absence of an item from today's file doesn't mean it stopped existing. This is why the fact table only ever grows or updates in place — never shrinks — and why it's always safe to re-pull overlapping date windows.

### 11_pipeline_ops.sql

Creates core.PipelineRun (one row per pipeline execution: start/finish timestamps, which adapter ran, rows staged/merged, the newest LastUpdatedDate seen, and success/failure status) and core.IngestWatermark (a durable per-source/per-queue "how far have we pulled" marker). Both exist for a specific reason: a Cloud Run Job's container filesystem doesn't survive between executions, so the JSON watermark file and FROM_DATE/TO_DATE env vars that work fine for a manual run on a laptop can't work for a scheduled Cloud Run pull — the pipeline job (section 2) reads and writes these two tables instead whenever SQL connection env vars are present, falling back to local-file/env-var behaviour otherwise. core.PipelineRun is an API contract: the production data API's GET /api/health reads it for lastPullAt, so its columns shouldn't be renamed without updating that endpoint too. Unlike scripts 01-08, this one does NOT drop and recreate on re-run — these two tables hold live operational history that must survive a re-run of this script. Run once when standing up Cloud SQL for the production pipeline; not needed for the on-prem/self-managed BULK INSERT path.

### 12_performance.sql

Scale-hardening for core.FactWorkItem at the 50-100M-row range section 10 has always flagged as the point you outgrow static JSON. Adds a nonclustered columnstore index over every column the report views actually read — deliberately keeping the existing rowstore primary key on ID rather than replacing it with a clustered columnstore index, because that would make core.usp_MergeFact's per-pull upsert (a point-lookup/point-update workload) markedly slower — plus two supporting rowstore indexes (Resource, LastUpdatedDate) the report views and a future incremental refresh both lean on. Also documents, but leaves commented out, a monthly partitioning scheme for core.FactWorkItem by outcome date, with the full migration path written down for when the table is actually populated and large enough to justify that work (table partitioning itself needs no Enterprise-tier SQL Server edition — verified since SQL Server 2016 SP1 — so this is a genuine "apply when you need it" choice, not one gated by licensing). Safe to run at any scale; only apply the commented-out partitioning DDL once you've actually reached the point section 10's checklist describes.

### 13_api_model_views.sql

Adds the SQL layer the production data API (section 4) reads from. Two things live here. First, one "vw_Model*" view per ModelJson field the existing report.vw_Dim*/vw_EstateRateByDate views don't already cover verbatim — vw_ModelDayRows, vw_ModelExcRows, vw_ModelResRows, vw_ModelDayWorktimeTotals, vw_ModelSpokeDayWorktimeTotals, vw_ModelResourceActivity, vw_ModelMeta and vw_ModelUnmappedQueues feed the app's day×process/exception/resource grain, vdiOperatingHoursPerDay/targets, and manifest fields; vw_ModelExceptionReasons feeds the exception-reason dimension; report.fn_ModelDisplayReason strips a leading "Business Exception:"/"System Exception:" prefix from a raw reason, byte-for-byte matching the Node build's own displayReason(). shared/model-assembler.mjs (section 1) is the one place these rows turn into the app's actual fields, so a change to a view's logic here needs the matching change there, and vice versa.

Second, three small tables give the reference sections that never had one a real home in SQL: core.RefAppSettings (one row per JSON-document section — targets, thresholdOverrides, exceptionDisplayCodes, vdiOperatingHoursPerDay — each seeded once from data/reference/reference.json's current values), core.RefVersion (a single-row optimistic-concurrency token the API's PUT /api/reference checks against an If-Match header), and core.RefChangeLog (an append-only audit trail of which section changed, when, and by whom). Unlike every Ref* dimension table in 03_core_dimensions.sql — which the CSV pipeline fully drops and rebuilds from reference.json on every run — these three are CREATE-IF-NOT-EXISTS and seed-IF-EMPTY only, and are never dropped: re-running this script must never wipe out a hub lead's or admin's saved edit, or destroy the audit trail. Run once when standing up the production data API; not needed if you're only running the static-JSON demo pipeline.

## 4. The data API (server/)

The dashboard's browser is never meant to talk to SQL Server directly — a small data API under server/ is the only thing designed to read or write the warehouse on the app's behalf. server/README.md is this API's own detailed contract; this section is the operational summary for running and troubleshooting it.

### What it serves

| Endpoint | Returns | Auth required |
| --- | --- | --- |
| GET /api/health | { ok, dataThrough, lastPullAt, dbOk, version } | None — a liveness/monitoring endpoint |
| GET /api/model | the exact ModelJson shape the dashboard's src/rpaData.ts expects, gzip'd and ETag-aware | Any signed-in user |
| GET /api/reference | { reference, version, updatedAt, updatedBy } | Any signed-in user |
| PUT /api/reference | the same shape on success (200); see below for 400/409/403 | admin, or hub_lead scoped to their own spoke(s) |

GET /api/model and this repo's static public/data/model.json are the same shape by construction, not by convention — see section 1's lineage: both are produced by feeding "rowsets" through the one shared/model-assembler.mjs function. In DATA_SOURCE=sql mode the API builds those rowsets live from report.vw_Model*/report.vw_Dim*/report.vw_EstateRateByDate against Cloud SQL (section 3's 13_api_model_views.sql); in DATA_SOURCE=fixtures mode it builds them from the same JSON files tools/build-dashboard-data.mjs already writes to public/data/views/.

### Auth modes (AUTH_MODE)

| Mode | Behaviour | Allowed with NODE_ENV=production? |
| --- | --- | --- |
| entra | Validates a Bearer JWT against the Entra ID tenant's JWKS (issuer/audience/expiry/signature), then maps its groups claim to a role + spokeIds using shared/auth-mappings.mjs — the server's own copy of src/auth/entra-provider.ts's GROUP_ROLE_MAPPINGS. Requires ENTRA_TENANT_ID and ENTRA_AUDIENCE. | Yes — the only mode allowed |
| dev | Trusts an X-Dev-User header verbatim: a JSON object {id,name,email,roles,spokeIds} — no signature, no verification of any kind. | No |
| none | Every request is treated as an anonymous business_user. | No |

> **Note:** The server refuses to even start with AUTH_MODE=dev or AUTH_MODE=none when NODE_ENV=production — a hard guard in server/src/config.ts, not a convention to remember. dev/none exist purely for local development and fixture-mode CI. Note also that shared/auth-mappings.mjs is a hand-kept copy of src/auth/entra-provider.ts's own group-mapping logic (this API can't import across into src/** directly) — a change to one must be mirrored in the other until the SPA is updated to import the shared copy instead; that's a known, flagged drift risk, not an oversight.

### Reference writes: If-Match, what a 409 means, and who's allowed to write what

PUT /api/reference requires an If-Match header carrying the current numeric version, taken from a prior GET /api/reference. A 409 response, with body { error, current }, means someone else's edit landed first — the version you sent is stale. The fix for whoever hits this: refetch GET /api/reference, reapply your change on top of the current snapshot it returns, and retry with the new version. A 400 means the payload itself failed shape validation (checked before the version or role checks, so a malformed body never masquerades as a conflict or a permissions problem). A 403 means the signed-in user isn't allowed to make this particular change: admin can change anything; hub_lead can only write rows that belong to their own spoke(s) and only if the edit doesn't touch anything estate-wide (the spokes list itself, grade definitions, exception patterns, estate cost history, targets, exception display codes, VDI operating hours, or any universal/hub-scoped rate row) — anyone else is refused outright. Every accepted write is recorded in core.RefChangeLog (who, when, which section changed) — the SQL home for the same changelog the Administration panel already shows.

### Cache, ETag, and what X-Data-Stale means

GET /api/model is cached in memory, keyed on a cheap fingerprint (in SQL mode: the latest pipeline run plus the reference-data version, so either a new data pull or a reference edit invalidates the cache). A matching If-None-Match returns 304 with no body before the API even attempts a rebuild. If computing that fingerprint or rebuilding the model fails — most likely because the database is unreachable — but a previous successful build is still cached, the API serves that last-good model anyway, with the response header X-Data-Stale: true, rather than showing a blank dashboard. Only if nothing has ever been built successfully does it respond 503. In practice: if a response carries X-Data-Stale: true, the numbers on screen are real but not current — check GET /api/health's dbOk field and the core.PipelineRun table (section 3) for why, rather than doubting the figures themselves.

> **Info:** This is currently the API-level behaviour only. The dashboard's own on-screen handling of a stale/degraded response — a banner, a header API-status indicator, and the equivalent for a 409 reference-save conflict or a failed sign-in — is SPA-side UX still landing; see next revision of this playbook.

### Fixture mode — running the API with zero infrastructure

This is the primary way to run and test the API locally or in CI: it serves the real ModelJson, through the real assembler, from the same static JSON view files tools/build-dashboard-data.mjs already writes.

```bash
cd server
npm ci
DATA_SOURCE=fixtures FIXTURES_DIR=../public/data/views AUTH_MODE=dev PORT=8080 npm run dev
```

FIXTURES_DIR is relative to server/, so ../public/data/views resolves to this repo's own public/data/views — run npm run data:build at the repo root first if that directory doesn't exist yet or is stale. The reference-data seed (data/reference/reference.json) is located automatically, three levels above FIXTURES_DIR; override with FIXTURES_REFERENCE_PATH if your checkout is laid out differently. One real limitation, documented in src/data/fixtures.ts's own header comment: in fixture mode the fact-based rowsets (day/exception/resource rows, worktime totals, resource activity) are a frozen snapshot from the last npm run data:build — there's no live warehouse to re-run the cost engine against. A PUT /api/reference edit in fixture mode DOES update the dimension data (spokes/propositions/processes/resources) and the reference object immediately (an in-memory store, reset on process restart) — it just can't re-cost the frozen fact snapshot against that edit the way a real SQL Server-backed run would.

### Testing the API in isolation, locally

```bash
cd server
DATA_SOURCE=fixtures FIXTURES_DIR=../public/data/views AUTH_MODE=dev PORT=8080 npm run dev

# in a second terminal
curl http://localhost:8080/api/health
curl -H "X-Dev-User: {\"id\":\"1\",\"name\":\"Test\",\"email\":\"t@example.com\",\"roles\":[\"admin\"],\"spokeIds\":[]}" http://localhost:8080/api/model
```

> **Note:** Verified against the code, and worth being direct about: pointing the SPA's own dev server at this API (VITE_API_URL=http://localhost:8080 npm run dev, as deploy/gcp.md's "local end-to-end" recipe describes) starts both processes fine, but the dashboard will NOT actually call this API today. src/data/client.ts — the module built to read VITE_API_URL and fetch from it (fetchModel(), DATA_MODE, putReferenceApi()) — exists and is fully implemented, but src/main.tsx's boot sequence still does a bare fetch against VITE_DATA_URL only, and nothing in the Administration panel calls the reference-write functions either. Its own code comment says so plainly: "mode behaviour must not change when main.tsx is wired to call fetchModel()". Until that wiring lands (SPA-side work still landing — see section 10's note), test this API on its own with curl/Postman/the browser devtools, as above, rather than expecting the SPA to visibly use it.

### Running against a real SQL Server

```bash
DATA_SOURCE=sql
SQL_SERVER=<host>
SQL_DATABASE=BPAnalytics
SQL_USER=<user>
SQL_PASSWORD=<password>
SQL_ENCRYPT=true
SQL_TRUST_CERT=false
```

Requires bp-sql-layer/scripts/13_api_model_views.sql to have been run against the target database, on top of 08_report_views.sql/03_core_dimensions.sql/04_fact_and_calendar.sql, and — for the production pipeline job to have somewhere to write to — 11_pipeline_ops.sql and 12_performance.sql as well (section 3).

### Env var reference

| Var | Default | Notes |
| --- | --- | --- |
| PORT | 8080 |  |
| NODE_ENV | development | production enables the dev/none auth-mode guard |
| CORS_ORIGIN | reflect all | passed straight to the CORS middleware |
| LOG_LEVEL | info |  |
| AUTH_MODE | none | entra \| dev \| none |
| ENTRA_TENANT_ID / ENTRA_AUDIENCE | — | required for AUTH_MODE=entra |
| DATA_SOURCE | sql | sql \| fixtures |
| FIXTURES_DIR | — | required for DATA_SOURCE=fixtures |
| FIXTURES_REFERENCE_PATH | derived | override the fixture-mode reference.json path |
| SQL_SERVER / SQL_PORT / SQL_DATABASE / SQL_USER / SQL_PASSWORD | — | SQL_PASSWORD is Secret Manager-backed in production |
| SQL_ENCRYPT | true |  |
| SQL_TRUST_CERT | false |  |

### Resilience, briefly

The SQL connection pool retries with exponential backoff (capped at 30 seconds) on startup and never blocks the process from listening — GET /api/health's dbOk field reflects the live connection state independently of whether a model is currently cached. A route-handler error never crashes the process (Fastify's own error handler, plus a belt-and-braces unhandledRejection/uncaughtException logger).

## 5. Deploying to GCP

deploy/gcp.md is the single entry point for this — read it for the exact gcloud commands and scripts (deploy/scripts/01 through 10) and the fuller Cloud SQL reference at deploy/cloudsql.md. This section is the map: what exists, the order to stand it up in, and the two decisions you actually have to make.

### The services

- Cloud SQL for SQL Server — the warehouse (bp-sql-layer's schemas), private-IP only, always-on (the one fixed cost regardless of traffic)
- Cloud Run Job: bp-ingest-pull — runs bp-sql-layer/ingest/run_pipeline.py on a schedule (section 2)
- Cloud Scheduler — triggers one bp-ingest-pull execution per pull by calling the Cloud Run Admin API's :run method directly, because Cloud Run Jobs have no HTTPS URL of their own
- Cloud Run service: bp-api — the data API from section 4 (server/Dockerfile), AUTH_MODE=entra, kept at --min-instances=1 to limit cold-start latency on top of Direct VPC egress's own cost
- Cloud Run service: bp-dashboard — this SPA, built in "api mode" (VITE_API_URL set) rather than the static demo bake
- Secret Manager — SQL_PASSWORD and each adapter's own credential (the Elastic API key, or the Blue Prism OAuth2 client secret)
- Artifact Registry — holds both container images

### Verified Cloud SQL constraints (why the architecture looks the way it does)

- No IAM database authentication for SQL Server — Cloud SQL's IAM support covers instance/backup operations only, not database logins, so SQL_USER/SQL_PASSWORD (Secret Manager-backed) is the only login path.
- No public-IP path from Cloud Run to Cloud SQL for SQL Server, and no Unix-socket proxy the way Postgres/MySQL get on Cloud Run — the ingest job and the API both need Direct VPC egress onto the instance's VPC and connect over plain TCP:1433 straight to its private IP.
- BULK INSERT ... FROM '<path>' is not viable against Cloud SQL, which is why the production pipeline uses run_pipeline.py rather than 10_bulk_load_csv.sql (section 2 has the full explanation).

### Two topologies for the frontend + API — pick one

| Topology | How it works | Choose it when |
| --- | --- | --- |
| nginx-proxy (default) | bp-dashboard's own nginx reverse-proxies /api/* to bp-api's public *.run.app URL at request time; bp-api is technically reachable directly too, but every request still needs a valid Entra JWT to get past AUTH_MODE=entra — "exposed at the network layer, closed at the application layer." | You want the fewest moving parts: one gcloud run deploy per service, no domain or managed certificate to provision |
| Load Balancer (production recommendation) | one external HTTPS Load Balancer, two Serverless NEG backends, one domain, one Google-managed TLS certificate; both Cloud Run services stop accepting public traffic directly — a platform-level boundary on top of the same Entra check, not instead of it. | You want a single domain for the whole app, room to add Cloud Armor or Identity-Aware Proxy later, and a platform-level (not just application-level) network guarantee — costs more to provision (a static IP, two backend services, a URL map, a domain you control) |

### First production deploy — order of operations

1. Provision Cloud SQL + the warehouse schema: deploy/scripts/01_enable_apis.sh through 05_bootstrap_schema.sh, in order (copy env.sh.example to env.sh and fill it in first) — this runs bp-sql-layer/scripts/01 through 12 for you (10_bulk_load_csv.sql is skipped; it doesn't apply to Cloud SQL, section 2)
2. Deploy the ingest job: deploy/scripts/06_deploy_ingest_job.sh, then test it once manually (gcloud run jobs execute bp-ingest-pull --wait) before scheduling it — see the first-real-data-pull runbook below
3. Schedule it: deploy/scripts/07_scheduler.sh (default cadence: every 15 minutes)
4. Deploy the data API: deploy/scripts/08_deploy_api.sh — fill in ENTRA_TENANT_ID/ENTRA_AUDIENCE in env.sh first; smoke-test with curl against .../api/health (no auth needed)
5. Deploy the frontend: deploy/scripts/09_deploy_frontend.sh (nginx-proxy) or 10_deploy_loadbalancer.sh (Load Balancer) — either way this builds the SPA in api mode
6. Optional: connect Power BI directly to report.vw_* (bypassing bp-api entirely) via an on-prem gateway or a temporary authorized-network IP on the Cloud SQL instance

### First real data pull — do this before scheduling

1. Dry-run the pipeline config with no network or SQL calls at all: python run_pipeline.py --dry-run, every env var set — confirms env-var presence and the CSV-shape contract only
2. Run the job once manually with a narrow FROM_DATE/TO_DATE or BP_SINCE — never pull full history through either adapter's REST/Elastic path on the first try (section 10 on backfill)
3. Check core.PipelineRun for Status='success' and sane RowsStaged/RowsMerged/MaxLastUpdated values
4. Check the job's logs for unmapped-queue warnings and map them (section 7) before widening the pull window
5. Reconcile row counts — source CSV rows vs. staging vs. net new fact rows, all visible on the core.PipelineRun row — then widen the window, remove any temporary date override, and schedule it for real

### Rollback

Both Cloud Run services keep every old revision; the fastest fix for a bad deploy is a traffic shift, not a rebuild: gcloud run services update-traffic bp-api --to-revisions=REVISION_NAME=100 (the same command shape works for bp-dashboard). The ingest job isn't revisioned the same way — pin INGEST_IMAGE to a specific digest (not :latest) in env.sh if you want a one-line image rollback for it. None of the SQL scripts (01-12) are written as down-migrations — reversing a schema change means writing the inverse DDL by hand. Reference-data writes are versioned (If-Match, section 4) but there's no undo endpoint — data/reference/reference.json's git history is the practical audit trail until one exists.

### Testing without GCP

No GCP project, Cloud SQL, or Entra tenant needed to exercise the real API contract — see section 4's fixture-mode subsections for the exact commands. Note the caveat in section 4/section 10: as of this revision, the SPA itself doesn't yet call this (or any) API — src/main.tsx hasn't been wired to src/data/client.ts — so this tests server/ in isolation, not a working SPA-plus-API loop. CI (section 12) exercises the fixture-mode API's own test suite before any image is built, but does not spin up the SPA against it either.

## 6. Reference data lifecycle

How an Administration-panel edit actually gets saved is different in production from local/demo mode. The business rules in this section (the role matrix, effective-dating, the people-cost and VDI worked examples) are identical either way — only the storage mechanism differs.

### Production: writes go straight to SQL, via the API

In a real deployment, every Administration-panel save is a PUT /api/reference call to the data API (section 4), inside a database transaction, in the same FK-safe order the local export already used (server/test/reference-order.test.ts proves the two orderings stay identical). Each write is optimistic-concurrency checked (an If-Match header against a version token in core.RefVersion — a stale version is rejected with 409, not silently overwritten) and permission-checked server-side (admin, or hub_lead scoped to their own spoke(s) — see section 4), and every accepted write is appended to core.RefChangeLog (who, when, which section) — an audit trail that survives independently of any one person's browser. There is no separate "sync loop" to run in production: the write IS the sync, the moment it's accepted.

The four sections that were always plain JSON with no relational table of their own — targets, thresholdOverrides, exceptionDisplayCodes, and vdiOperatingHoursPerDay — now live in core.RefAppSettings (one JSON-document row per section; section 3's 13_api_model_views.sql). The Administration panel doesn't need to know or care which of its sections are relational tables versus a RefAppSettings document — the API presents the same single reference object either way.

> **Note:** Known stopgap, flagged plainly rather than worked around: core.RefProcess has no Icon/Tags columns (and neither does the local exporter, so this is a pre-existing gap, not something this task introduced). In production, a process's icon and tags are persisted as a fifth core.RefAppSettings document (processExtras: {[processId]: {icon, tags}}) instead of real columns on core.RefProcess. This works today, but the clean fix is an Icon/Tags column migration on core.RefProcess in a future revision, at which point the processExtras handling can be deleted. If you're the one adding that migration, update server/src/data/sql-reference.ts's read/write of processExtras in the same change.

### Local / demo mode: the two twins

Without a production API behind it (npm run dev against the static baked model.json, or fixture mode), the Administration panel falls back to two sources of truth that must be kept in step by hand.

- data/reference/reference.json — the base reference data, committed to git. Structure (real field names): spokes[] (spokeId, spokeName, shortName, colorLight, colorDark), gradeRates[] (grade, gradeName, effectiveFrom, hourlyCostGBP), propositions[], processes[] (processId, processName, processAcronym, processDescription, propositionId, smvMinutes, grade, isActive, icon, tags), queueMap[] (queueName, processId, stageName, stageOrder), resources[] (VDI records: resourceName, botName, botAcronym, vdiName, costClass, spokeId, activeFrom, activeTo, renewalDate, annualCostGBP, licenseExpiryDate, status, notes), vdiCostHistory[] (costClass, effectiveFrom, annualCostPerVDIGBP), estateCostHistory[], peopleCostHistory[] (ownerId — "HUB" or a spokeId as a string — headcount, annualCostGBP, effectiveFrom, note), exceptionPatterns[], exceptionDisplayCodes, targets.
- The in-app Administration panel, which — ONLY when there's no production API behind it — stores edits as a localStorage overlay on top of that base JSON (key holds a versioned snapshot with a schema version, an edit counter, who/when, and a changelog of the last 50 edits). The overlay wins wholesale when present (a full replacement of the reference object, not a field-by-field patch) — so exporting and syncing regularly matters. This overlay is a local-mode convenience only; it is never the production data store.

The "Download reference.json" and "Download SQL sync script" buttons in Administration → Data & sync still exist in production, but their job changes: they're no longer how an edit reaches the warehouse (the API write already did that) — they're for keeping the git-committed reference.json in step for local/demo use, and for producing an offline audit snapshot or a DR/rebuild script on demand.

### Role matrix — who edits what (same rules, either mode)

| Admin section | Who can edit |
| --- | --- |
| Squads | admin only |
| Grade rate card | admin (grade definitions and universal rates); a hub_lead can add/edit spoke-scoped override rates for their own assigned spoke(s) — universal rows stay read-only to them |
| Exception patterns | admin only |
| Users & roles | admin only |
| Propositions & processes | admin, or a hub_lead for their own assigned spoke(s) |
| People costs | admin, or a hub_lead for their own assigned spoke(s) |
| VDI estate | admin, or a hub_lead for their own assigned spoke(s) |
| Data & sync | visible to everyone; the "discard local edits" action needs edit rights on at least one of the above |

### Effective-dating rule

Every rate table (grade rates, VDI cost-class rates, estate/team cost history, people cost history) is looked up by "the record with the latest effectiveFrom that is on or before the date in question wins" — there's no future-dating and no averaging across records. Practically: don't edit an old dated record's rate to "fix" it retroactively — that would silently change historical benefit/cost figures for every day that record was in force. Instead, always add a new record with today's (or a chosen future) date as its effectiveFrom; the old record stays exactly as it was for every day up to that point. This is what "history is locked" means in practice — it's a discipline the team needs to follow in the Administration panel, since it determines whether yesterday's numbers stay honest.

### People cost worked example

The hub's people cost is a peopleCostHistory record with ownerId = "HUB", charged into the HUB pool exactly as before. Each spoke's own peopleCostHistory record (ownerId set to a spoke id) is ALSO charged — into that spoke's own pool, alongside its VDI infra, apportioned within the spoke by worktime. The real data today (data/reference/reference.json) has two HUB records: the original is 14 people at £780,000/year effective from 2023-01-01 (the engine divides that by 365.25 for a daily hub cost of about £2,135.52), superseded by a second record of 16 people at £860,000/year effective from 2025-04-01 (about £2,354.55/day) — that second record is the one in force today. Every day from 2025-04-01 onward uses the newer daily rate; every day before it correctly still used the 2023 rate.

If the team now hires a 17th person effective 1 September 2026, the correct edit is: add a new HUB record — headcount 17, the new annual cost total, effectiveFrom = "2026-09-01" — leaving the headcount-16/£860,000 record untouched. From 1 September 2026 onward, every day uses the new record's daily rate; every day before it keeps using the 16-person record.

> **Note:** Important nuance: there's no partial-day proration on the hire date itself — the switch is a hard boundary at midnight on effectiveFrom, not a blend. If you want the cost to reflect a mid-month hire more precisely, set effectiveFrom to the actual hire date and let the day-boundary rule do the rest — don't try to average two records into one.

### VDI semantics

Each VDI/resource record carries a renewalDate (an annual-cycle anchor — coverage tiles in 365-day blocks from that date, both forward and backward), an optional licenseExpiryDate, and a status of "active" or "retired".

- A renewal (booking a new renewalDate) buys a full 365-day coverage window at the class's (or the record's overridden) annual cost — not pro-rated; the full annual figure is simply divided evenly across however many days that cycle actually covers.
- A licence expiry shortens the current cycle: coverage stops the day after licenseExpiryDate, so the same annual cost gets divided across fewer days (each covered day effectively costs a bit more) and there is zero cost and zero available capacity for any day past expiry until a new renewal is booked.
- Retiring a VDI (status = "retired" with an activeTo date) also cuts the coverage window short at that date — from then on the VDI contributes zero cost and zero capacity.

### The sync loop — local/demo mode only

If you're running the static-JSON demo (no production API behind it), do this every time reference data changes in the Administration panel:

1. Edit in the UI
2. Open Administration → Data & sync
3. Click "Download reference.json" and replace data/reference/reference.json in the repo with it, then commit
4. Click "Download SQL sync script" and hand it to your DBA to run against the SQL warehouse (it's generated to match bp-sql-layer/scripts/07_seed_reference.sql exactly — same DELETE+INSERT pattern, same columns)
5. The next npm run data:build (or the next scheduled production data build) picks up the committed JSON

> **Note:** This is the only way the two local-mode twins — the JSON and 07_seed_reference.sql — stay in step; skipping either half of the export means the dashboard and the warehouse quietly disagree. In production this loop doesn't apply: the API write already reached SQL directly (see "Production: writes go straight to SQL" above) — use the download buttons there for an audit snapshot or a DR script, not to propagate the edit itself.

## 7. Adding a new hub/spoke (squad)

A plug-and-play checklist, using the Administration panel's actual tabs:

- [ ] Administration → Squads → add the new squad (spokeName, shortName, colorLight, colorDark) — admin role required
- [ ] Administration → Propositions & processes → select the new squad → add its propositions, then add processes under each proposition (set the SMV in minutes and the grade it automates against for each process)
- [ ] Still in Propositions & processes → map each Blue Prism queue name to the process it feeds (and a stage name/order if the process runs in multiple stages)
- [ ] Administration → VDI estate → add the squad's VDI/bot records (set cost class, renewal date, and owner = the new spoke)
- [ ] Administration → People costs → add a people-cost record for the squad (this IS charged into estate economics — it feeds the squad's own pool alongside its VDI infra, apportioned within the squad by worktime)
- [ ] Check the spoke slicer at the top of every dashboard page — the new squad appears there immediately, no rebuild needed (it's reading the live reference overlay)
- [ ] Assign a hub_lead for the squad: today, that's Administration → Users & roles, editing a user's role to hub_lead and adding the new spoke's id to their spokeIds; in production this instead comes from an Entra ID (Azure AD) group — see section 8
- [ ] Remember: the squad's activity (case volumes, outcomes, exceptions) won't show up until the next data build (npm run data:build, or the next scheduled production pull) actually ingests queue data tagged with that squad's mapped queues — adding the squad in the Administration panel only wires up the reference side instantly

### What the hub_lead can then manage

Once assigned: everything spoke-gated for their own spoke(s) — propositions & processes, queue mappings, VDI estate, people costs — but not the squads list, the grade rate card, exception patterns, or user management, all of which stay admin-only.

## 8. Users, roles & sign-in

The four roles: admin, hub_lead, hub_member, business_user.

### Permission matrix (from src/auth/auth-context.tsx's can() function)

| Permission | Who has it |
| --- | --- |
| view_dashboards | every signed-in user |
| view_admin | admin, hub_lead, hub_member |
| edit_spoke_reference | admin (always); hub_lead (only for the spoke ids assigned to them) |
| edit_global_reference | admin only |
| manage_users | admin only |

### Dev sign-in today

A demo directory of 6 seeded users, all sharing the passphrase "demo" (fine for a prototype — never do this in production):

| Name | Role | Spoke(s) |
| --- | --- | --- |
| Nigel Spriggs | admin | — |
| Callum Ferris | hub_lead | Insurance, Pensions & Investments |
| Naomi Whitfield | hub_lead | Risk |
| Dev Kapoor | hub_member | — |
| Sian Roberts | business_user | Commercial |
| Marcus Delaney | business_user | Consumer Lending |

Manage this directory at Administration → Users & roles — add, edit, reset passphrase, or remove a user. This screen carries an explicit banner: "In production this is managed via AD group membership… this screen is a working stand-in for the demo directory only."

### Production: Entra ID (Azure AD)

> **Note:** Be honest — src/auth/entra-provider.ts is currently a non-functional stub, and its own header comment says so explicitly: it exists to show the shape of real SSO, but every method (signIn, signOut, getSession) just throws an error today. The one genuinely working piece is mapClaimsToUser() — real logic that turns an Entra ID token's claims (an AD groups array plus standard claims) into this app's User object; it's ready to receive real claims once wired up.

### Ask your IT/identity team for

- An app registration in your Entra ID tenant for this dashboard
- A redirect URI for the app once it's hosted (matching wherever it's deployed)
- Group claims turned on in the token, so AD group membership shows up as a groups array the app can read

### How AD groups map to roles/spokes (GROUP_ROLE_MAPPINGS in entra-provider.ts)

| AD group | Maps to |
| --- | --- |
| SG-RPA-Admins | role: admin |
| SG-RPA-IPI-Lead | role: hub_lead, spoke taken from the group name |
| SG-RPA-RSK-Lead | role: hub_lead, spoke taken from the group name |
| SG-RPA-COM-Lead | role: hub_lead, spoke taken from the group name |
| SG-RPA-CLD-Lead | role: hub_lead, spoke taken from the group name |
| SG-RPA-HubMembers | role: hub_member |
| SG-RPA-BusinessUsers | role: business_user |

Set up your real AD groups to match this naming pattern (or edit the mapping table to match your naming) and membership changes then flow straight into the app's roles once wired up.

### What's genuinely NOT built yet — the honest gap list

- @azure/msal-browser / @azure/msal-react are not installed (check package.json — only react/react-dom are dependencies today); wiring real sign-in means adding one of these.
- The three EntraAuthProvider methods need to actually call MSAL instead of throwing.
- A real Bearer token still needs to reach the API on every call. server/'s AUTH_MODE=entra (section 4) already validates a Bearer JWT and serves data scoped to the caller's role/spokes — that part is built. What's flagged as a known gap in deploy/gcp.md: src/auth/entra-provider.ts today requests no API-scoped permission and neither it nor src/data/client.ts attaches an Authorization header to any /api/* call, so a real Entra sign-in authenticates in the browser but every API call still 401s until that wiring lands — see deploy/gcp.md section 7's "known gap" note for the exact three-part fix.
- Threshold alerts (section 14) are in-app only — the bell has no email/Teams/webhook push. The data API (section 4) has no alert-evaluation or notification code of its own today; it's the right place to add scheduled evaluation + outbound notification once that's built.

## 9. How data reaches each visual

The general split: pipeline = SQL views (report.vw_*) / the equivalent Node build script (tools/build-dashboard-data.mjs) — this is where every rate is resolved and every sum is pre-computed once. Engine = the client-side code in src/reference/economics.ts and src/filters-context.tsx — this only re-sums the pipeline's pre-computed numbers according to whatever slicers (spoke/proposition/process/queue/tags/date range) the user currently has selected, and (for the Commercial page's rate-override slider) recomputes a what-if benefit using a flat rate instead of the grade-rate card. The client never re-derives Outcome, ExceptionType, or the base rate tables from raw items — it only slices and sums what the pipeline already resolved.

| Page | Primary aggregates/views | Computed in pipeline | Computed/aggregated in client |
| --- | --- | --- | --- |
| Overview | vw_KPIHeadline, vw_DailyOutcomes/vw_MonthlyOutcomes | outcome counts, worktime, benefit, cost per day×process | KPI totals summed for the current slicer selection; watchlist thresholds compared client-side |
| Input & Outcome | vw_DailyOutcomes, vw_MonthlyOutcomes | completed/business-exception/system-exception counts and worktime per day×process | daily/monthly toggle and slicer-scoped summing |
| Process Analysis | vw_DailyOutcomes joined to vw_DimProcess | completion time, throughput, exception counts per process per day | grouping/summing by process for the selected date range |
| Exceptions | vw_ExceptionDetail (day × process × reason grain) | exception classification (Business/System) and reason text, pre-joined to process/spoke | heatmap binning and free-text search over the (already small, ~148-row) exception-detail rows |
| Process detail | vw_DailyOutcomes filtered to one process | same as Process Analysis | client filters the shared day×process rows down to the one process drilled into |
| VDI & Capacity | vw_ResourceUtil, resource rows in model.json | per-VDI utilisation and daily cost from the VDI coverage-window algorithm | idle-time and cost roll-ups for the current slicer scope; the economics.ts rate-table logic mirrors this for any what-if |
| Commercial | vw_Commercial, vw_CommercialBySpoke, vw_CommercialMonthly, vw_CommercialOverall | benefit = SMV × grade rate in force on the outcome date; cost = worktime × (hub £/bot-second + spoke pool £/bot-second, where the spoke pool is VDI infra + that spoke's own people cost); zero-worktime-day pool cost recorded separately (not folded into cost-per-case) | cost-per-case, ROI, and cumulative totals summed for the current slicer scope; the rate-override slider recomputes benefit with economics.ts's benefitForRow() using a flat rate instead of the grade card |

### The economics engine mechanics, precisely

Rate tables are built once per reference change (buildRateTables()), walking every calendar day to sum worktime by spoke and across the whole estate, and computing the hub pool and each spoke's infra pool per day. benefitForRow() = (completed × process.smvMinutes / 60) × grade rate in force on that row's date. costForRow() = row.worktimeSec × (hub £/bot-second share + spoke £/bot-second share), where each share is that day's pool cost divided by the worktime it's spread across (hub pool spread across all worktime that day, spoke pool spread across just that spoke's worktime that day). On a day with zero worktime, both shares collapse to zero and that day's pool cost is instead recorded in a separate "unattributed" figure used only for P&L reconciliation, never charged to any case.

## 10. Performance & scale (50-100M rows)

Real numbers from public/data/manifest.json (as of the last build): 231,660 source queue items over 2025-01-01 to 2026-07-14 — about 18.5 months. The browser never sees those 231,660 raw rows — it sees the pre-aggregated model.json, whose day×process grain (vw_DailyOutcomes) is 17,531 rows, exception-detail grain (vw_ExceptionDetail) is 148 rows, and resource/VDI grain (vw_ResourceUtil) is 11 rows. model.json is about 4.5 MB; the full set of public/data/views/vw_*.json files adds roughly another 5.8 MB. Raw, item-level rows live only in SQL, in core.FactWorkItem (and upstream in staging/raw) — never in anything the browser downloads.

### Delta at every hop

- Elastic pull (preferred): elastic_to_csv.py's FROM_DATE/TO_DATE act as a watermark. Run stand-alone (no SQL_* env vars), there is no built-in overlap window — schedule pulls with deliberate overlap yourself (e.g. re-pull the last several days every run, not just "since the last run's end date"). Run as part of the Cloud SQL pipeline job (section 2), ELASTIC_WATERMARK_OVERLAP_HOURS does this for you against the durable core.IngestWatermark table. Either way, confirm the Data Gateways event-stream shipping activity into Elastic hasn't lagged or dropped anything in that window.
- Blue Prism API pull (alternative): bp_api_to_csv.py's lastUpdated watermark is paired with an explicit WATERMARK_OVERLAP_HOURS knob, precisely because a work-queue item mutates through several states (pending → completed, or pending → exception, or a retry) and its last-updated timestamp only advances when that happens — an item that was mid-flight right at the edge of a narrow window would otherwise be missed permanently. Set that overlap generously enough to cover your slowest-moving items.
- SQL merge: safe to re-pull overlapping windows either way, because core.usp_MergeFact matches on ID and only overwrites when the incoming LastUpdatedDate is strictly newer — so re-sending the same or older data is a harmless no-op, and re-sending a now-completed item that was previously "pending" correctly updates it in place.
- Aggregate refresh today is a full rebuild, not incremental: tools/build-dashboard-data.mjs reprocesses the entire CSV every time it runs, and report.vw_* are plain SQL views recomputed on every query — there's no incremental-aggregate-table layer yet. This is fine at ~230k rows; it will not be fine at 50-100M rows (see below).

### Backfilling initial history

> **Note:** Paginating 50-100M rows of history through a REST API is impractical — don't try it. Get the initial backfill from a bulk export, Elastic (the preferred path, if it holds the history), or a direct query against the Blue Prism production database, loaded straight into raw.WorkQueueItem. Once that backfill is in and merged, switch to a scheduled Elastic pull (or the Blue Prism API adapter as the alternative) for ongoing deltas only — small, frequent, watermark-driven pulls, never a full-history re-pull through the REST API.

### Production serving — the API side is built; the frontend wiring isn't, yet

The small API this section used to describe as a future migration now exists: server/ (section 4) reads report.vw_Model*/report.vw_Dim*/report.vw_EstateRateByDate live from SQL Server and serves the exact ModelJson shape over GET /api/model. The response shapes are still defined 1:1 through shared/model-assembler.mjs (section 1), so once the frontend does call it, the app's own code genuinely won't need to change, only where it fetches from — exactly as this section originally predicted.

> **Note:** Verified gap, not yet fixed: src/data/client.ts already contains the intended swap logic (fetchModel(), DATA_MODE driven by VITE_API_URL, putReferenceApi() with retry/backoff and typed errors) — but nothing calls it yet. src/main.tsx's boot sequence still does a bare fetch against VITE_DATA_URL only (a separate, older, local-mode-only setting), and no Administration-panel code calls putReferenceApi() either. Building the SPA with VITE_API_URL set does not yet make it talk to the API — that wiring is SPA-side work still landing; see next revision of this playbook.

### SQL Server guidance at 50-100M-row scale — what's done, what's still pending

- DONE (bp-sql-layer/scripts/12_performance.sql, section 3): a NONCLUSTERED columnstore index on core.FactWorkItem covering every column the report views read, plus supporting rowstore indexes on Resource and LastUpdatedDate. Deliberately nonclustered, not clustered — the rowstore primary key on ID stays in place so core.usp_MergeFact's per-pull upsert (a point-lookup workload columnstore is poor at) is unaffected.
- DONE (bp-sql-layer/scripts/11_pipeline_ops.sql, section 3): a proper watermark table, core.IngestWatermark, one row per source/queue, read and written by the Cloud SQL pipeline job instead of manually-set FROM_DATE/TO_DATE env vars — incremental pulls are self-driving and safe to automate on a schedule.
- STILL PENDING, DOCUMENTED BUT NOT APPLIED: partitioning core.FactWorkItem by outcome-date month. 12_performance.sql writes the full partition function/scheme DDL and migration steps but leaves them commented out deliberately — applying them to an already-populated table is a real migration (rebuild indexes against the new scheme, or build a new table and switch data in), worth doing only once the table has actually grown large enough to justify it. Re-evaluate against the checklist below, not a fixed row-count guess.
- STILL PENDING: server-side top-N / paging for any row-level detail view (like the Exceptions page's searchable detail) — the production data API today serves pre-aggregated day×process×reason grain, same as the static build; never ship 50-100M rows, or even a few hundred thousand, to the browser for client-side filtering once that view needs true item-level search.

### Signs you need the partitioning migration

- [ ] model.json (plus the views files) is climbing past tens of MB — today's ~10MB combined baked output is already worth watching
- [ ] Initial dashboard load time is creeping past 2-3 seconds on a typical connection
- [ ] The day×process row count (today 17,531) is heading into the hundreds of thousands
- [ ] You need a filter or search that doesn't fit the pre-aggregated day×process×reason grain (true item-level search across all raw rows) — this is also the trigger for the still-pending server-side paging item above
- [ ] Different spokes want different refresh cadences, or you need closer-to-real-time data than a scheduled batch bake can give you
- [ ] report.vw_* query latency is visibly degrading, or sys.dm_db_stats_properties shows the optimizer's row estimates drifting from reality faster than auto-stats keeps up (12_performance.sql's own maintenance notes)

## 11. Accessibility & personalisation

What exists today (all in src/a11y/, driven by useDisplayPrefs() / DisplayPrefsProvider in prefs-context.tsx, persisted per signed-in user in localStorage): theme switching between light, dark, and a high-contrast theme; a dyslexia-friendly font toggle; a reading ruler (ReadingRuler.tsx) that tracks the line you're reading; bionic reading (Bionic.tsx) which bolds roughly the first 40% of each word in wrapped prose text to help the eye anchor faster — deliberately never applied to chart axis labels, legends, or numeric values, only descriptive prose; a colour-vision-deficiency-safe (CVD-safe) palette swap (the Okabe-Ito palette) for anyone who turns it on; a text-scale control (100% / 115% / 130%); a reduced-motion setting; and lighter personalisation touches — a time-of-day greeting with a seasonal accent icon (suppressed automatically in high-contrast mode), and live UK/India clocks in the header. Everything persists per signed-in user (namespaced localStorage key), so different people sharing a machine keep their own preferences.

Standards intent: WCAG 2.2 AA.

### Keyboard shortcuts (from the registry in src/App.tsx)

| Keys | Action |
| --- | --- |
| ? | Show the keyboard shortcuts list |
| Shift+A | Open Accessibility & display settings |
| / | Focus the first slicer (Spoke) |
| [ | Toggle navigation collapse |
| Esc | Close the shortcuts overlay |
| Alt+1 … Alt+9 | Jump straight to page 1 through 9 (in nav order) |

### How to test with keyboard only

Unplug the mouse (or just don't touch it) and Tab through the page — every interactive element (nav links, slicers, buttons) should show a visible focus outline; confirm Alt+1…Alt+9 jump between pages; confirm ? opens and Esc closes the shortcuts overlay; confirm Shift+A opens the display-settings panel and every toggle in it (theme, dyslexia mode, reading ruler, bionic reading, CVD-safe, text scale, reduced motion) is reachable and operable by keyboard alone.

## 12. Tests & CI

Two independent test suites — the dashboard's own (tests/, run from the repo root) and the data API's (server/test/) — plus a data-pipeline parity script, all gated in CI on every push. Nothing here needs a real database or a real Blue Prism/Elastic connection; everything runs against the mock dataset and fixture files already checked in.

### npm test (repo root) — what it proves

| Test file | What it proves |
| --- | --- |
| tests/economics.test.ts | Encodes the real business rules from src/reference/economics.ts and ARCHITECTURE.md's "Hub & spoke economics" section (rate-in-force lookup, VDI coverage-window/renewal/expiry arithmetic, benefit and cost formulas) — a rule regression fails a test here, this isn't a shape/smoke check. |
| tests/reference-store.test.ts | The overlay-merge semantics (a present overlay replaces the base wholesale, not field-by-field), SCHEMA_VERSION rejection of a stale overlay, the FK-safe statement ordering and SQL-escaping of exportReferenceSql(), and resolveThreshold()'s process-then-spoke-then-global precedence rule. |
| tests/alerts-engine.test.ts | evaluateAlerts()'s warn/breach/no-alert classification and the minimum-volume guard, exercised through its estate-scope output (the real classify()/pushRateAlerts() internals aren't exported, so this is the only way to reach their branches without a src change). |
| tests/alerts-format.test.ts | Direction symbols, headline phrasing per classify()'s real branches (min/max × warn/breach), the omitSpoke option, and the staleVdi headline — src/alerts/format.ts. |
| tests/mock-stale-vdi.test.ts | Loads the ACTUAL built public/data/model.json (not a synthetic fixture) and asserts the mock estate's one deliberately-idled VDI (VDI-RPA-PROD-06, idled ~30 days before data-through by tools/generate-mock-data.mjs) yields exactly one staleVdi alert — proof the stale-VDI alert path has a real, working signal to fire on, not just unit-level plumbing. |
| tests/parity.test.ts | Shells out to tools/verify-economics.mjs against the currently built public/data/model.json and asserts it reports PARITY OK — a regression trip-wire on the whole data pipeline (not just the pure functions the other tests exercise), fast enough to run as part of the default npm test. |

tests/mock-stale-vdi.test.ts and tests/parity.test.ts both skip gracefully (it.skipIf) if public/data/model.json doesn't exist yet — run npm run data:all first (or just npm run data:verify, section 3) if you want them to actually assert something rather than skip.

### server/ tests — what they prove

| Test file | What it proves |
| --- | --- |
| server/test/assembler.test.ts | The parity guarantee at the heart of this whole architecture (section 1): assembleModel() fed the fixture rowsets under public/data/views/vw_Model*.json (+ vw_EstateRateByDate.json and data/reference/reference.json), via the same FixtureModelSource the server uses in DATA_SOURCE=fixtures mode, deep-equals public/data/model.json exactly (module the two fields that are legitimately caller-supplied — meta.generatedAt, meta.source). |
| server/test/reference-order.test.ts | data/table-order.ts's DELETE_ORDER/INSERT_ORDER (what the real SQL-backed reference store uses) equal the SPA's own exportReferenceSql() order exactly — a divergence here is a data-corrupting bug waiting to happen the moment someone edits one exporter without the other. |
| server/test/auth.test.ts | AUTH_MODE=dev is refused when NODE_ENV=production; a hub_lead's PUT /api/reference touching a spoke outside their own spokeIds (or anything global) is rejected with 403, while the same hub_lead editing their own spoke succeeds; a stale If-Match version yields the documented 409 { error, current } shape. Runs the real Fastify app via app.inject() — no network listener, no real database. |
| server/test/health.test.ts | GET /api/health's response shape, in fixture mode (no auth, no database). |

### The parity script (data pipeline)

npm run data:verify (tools/verify-economics.mjs) reloads public/data/model.json, re-runs the same rate-table and per-row benefit/cost math the client's economics.ts uses, and checks the recomputed totals match the pipeline-baked totals to within 0.5%. A pass prints PARITY OK with baked-vs-recomputed figures side by side; a fail prints a PARITY FAILED table and exits non-zero. tests/parity.test.ts (above) runs this same script as part of the default test pass; running it standalone is useful right after npm run data:all, before a full test run.

### CI gate order (.github/workflows/ci.yml)

1. npm ci (repo root)
2. npx tsc --noEmit — type-check the dashboard
3. npx vite build — production build
4. npm test — the repo-root suite above
5. npm run data:all — rebuild the mock CSV and public/data/model.json + views from scratch
6. npm run data:verify — economics parity against that freshly rebuilt model
7. npm run docs:playbook — regenerate PLAYBOOK.md from this file
8. git diff --exit-code PLAYBOOK.md — fails the build if PLAYBOOK.md doesn't match what src/pages/playbook-content.ts generates; this is the drift check that keeps this playbook honest — edit playbook-content.ts and run npm run docs:playbook, never hand-edit PLAYBOOK.md itself
9. server: npm ci (working directory server/)
10. server: npm run build — type-check + compile the API
11. server: npm test — the server suite above (assembler parity, reference write order, auth)

The server steps run AFTER npm run data:all specifically because server/test/assembler.test.ts replays the freshly generated public/data/views/vw_Model*.json fixtures through the shared assembler and must reproduce public/data/model.json exactly — that ordering is what makes the CI run itself proof of the static-build/live-API parity guarantee, not just a claim in this playbook.

### Running everything locally in one go

```bash
npm ci
npx tsc --noEmit
npm run data:all
npm test
npm run data:verify
npm run docs:playbook && git diff --exit-code PLAYBOOK.md
cd server && npm ci && npm run build && npm test
```

## 13. Runbook & troubleshooting

### Daily/weekly ops

Run (or confirm the scheduled) Elastic pull (or the Blue Prism API alternative) → bulk load → usp_RunPull cycle; skim the usp_RunPull output (or the build script's console output in the demo pipeline, or the ingest job's logs in production) for "unmapped queue" warnings after every run; whenever anyone edits reference data, follow the sync loop from section 6 that matches your deployment (production: it's already in SQL via the API, versioned and audited automatically; local mode: download JSON, commit; download SQL, hand to DBA) rather than letting edits sit only in one person's browser.

### npm scripts

| Script | Command | What it does |
| --- | --- | --- |
| npm run dev | vite | local dev server |
| npm run build | tsc && vite build | type-check, then production build to dist/ |
| npm run preview | vite preview | serve the production build locally |
| npm run data:mock | node tools/generate-mock-data.mjs | writes a fresh deterministic mock CSV to data/mock/BPAWorkQueueItem.csv |
| npm run data:build | node tools/build-dashboard-data.mjs | transforms the CSV + reference.json into public/data/model.json, public/data/views/vw_*.json, and public/data/manifest.json |
| npm run data:all | npm run data:mock && npm run data:build | mock + build in one go (the full demo refresh) |
| npm run data:verify | node tools/verify-economics.mjs | proves the client economics engine reproduces the pipeline-baked benefit/cost totals |
| npm run docs:playbook | node tools/build-playbook-md.mjs | regenerates PLAYBOOK.md from src/pages/playbook-content.ts |

### What data:verify proves

It reloads public/data/model.json, re-runs the same rate-table and per-row benefit/cost math the client's economics.ts uses, and checks the recomputed totals match the pipeline-baked totals to within 0.5%. A pass looks like PARITY OK with baked vs recomputed figures shown side by side; a fail prints a PARITY FAILED table with the actual differences and exits non-zero. Run it after every npm run data:build.

### Common failures and where to look

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| Build fails or numbers look wrong right after a real CSV swap | CSV schema drift — a column renamed, reordered, or missing versus the 16-column BPAWorkQueueItem contract | Compare the CSV header row against the contract in ARCHITECTURE.md; check the build script's console output for parsing errors |
| Every KPI shows £0 | The base reference.json failed to load or parse | Check the browser console and the Administration panel — reference-context.tsx surfaces a load error there when the base reference fetch/parse fails |
| Your Administration edits vanished after a deploy or code update (local/demo mode only) | The localStorage overlay's schema version no longer matches the app's current schema version, so it was automatically rejected | Check the browser console for a message like "dropping stale localStorage overlay… falling back to base reference" — this is deliberate, not a bug; re-apply the edits, or use Administration → Data & sync to confirm what's live. This entire failure mode doesn't apply in production — see the next table for the SQL-backed equivalent (409 on save). |
| A new spoke/squad shows no activity | Expected — the squad's reference data is live immediately, but its queues' activity only appears after the next data build ingests data tagged with that squad's mapped queues | Confirm the queue mapping is in place (section 7) and that a data build has run since |
| A queue's data isn't showing up anywhere | The queue isn't in RefQueueMap / reference.json's queueMap | Check usp_RunPull's (or the build script's) unmapped-queue warning output, then add the mapping in Administration → Propositions & processes |

### Production symptoms → causes

| Symptom | Likely cause | What to check / do |
| --- | --- | --- |
| GET /api/health returns dbOk: false | The API's SQL connection pool can't reach Cloud SQL — a network/VPC egress problem, a credential rotation, or the instance itself being unavailable | The API keeps serving requests regardless (ok is always true; dbOk is the specific signal) — check the Cloud Run service's own logs for the connection error, confirm Direct VPC egress and the instance's private IP haven't changed, and confirm SQL_PASSWORD's Secret Manager binding is still valid |
| A dashboard response carries X-Data-Stale: true | The database was unreachable at the moment of a rebuild attempt, so the API served the last successfully-built model instead of failing outright | Not a data-quality bug — the numbers on screen are real but not current. Check dbOk above and core.PipelineRun (below) for why the DB was unreachable; the header stops appearing once a rebuild succeeds again |
| PUT /api/reference returns 409 | Someone else's edit landed first — the If-Match version the client sent is now stale | Expected concurrent-edit behaviour, not corruption. The client should refetch GET /api/reference and reapply the change on top of the current snapshot the 409 body returns (see section 4) |
| PUT /api/reference (or any /api/* call) returns 401 in AUTH_MODE=entra | Either the Bearer token's audience/issuer doesn't match ENTRA_AUDIENCE/ENTRA_TENANT_ID, or — the known, currently-open gap — the SPA never attached an Authorization header to the request in the first place (see deploy/gcp.md section 7's "known gap" note) | Decode the token (jwt.ms or similar) and confirm its aud claim matches ENTRA_AUDIENCE exactly; confirm the SPA's VITE_ENTRA_SCOPES actually includes the API's scope and that an access token (not just an ID token) is being requested and attached — until that wiring lands, expect every real Entra sign-in to 401 on API calls |
| core.PipelineRun shows a row stuck at Status='running' with no FinishedAt | Either a run genuinely is still going, or a prior run crashed before reaching its final UPDATE | core.usp_GetInFlightRun already treats a 'running' row older than IN_FLIGHT_STALE_MINUTES (default 30) as abandoned and won't let it block a new run — so this self-clears. To confirm rather than wait, check the ingest job's own Cloud Run Job execution logs for that run's outcome; if it genuinely crashed and you need it marked failed sooner, update the row by hand: UPDATE core.PipelineRun SET Status='failed', FinishedAt=SYSUTCDATETIME(), Error='manually closed' WHERE RunId=<id> |
| The ingest job's logs show run_skipped_in_flight and it did nothing | This is a deliberate no-op, not a failure — run_pipeline.py found another run already Status='running' and started less than IN_FLIGHT_STALE_MINUTES ago, so it exited cleanly rather than double-running | Confirm this isn't happening on every scheduled run (which would mean a run is taking longer than the schedule's interval, or a truly stuck run isn't clearing) — compare Cloud Scheduler's cadence against how long a normal run actually takes in the logs |
| You need to force a re-pull of a date range the watermark has already passed | A backfill gap was found after the fact, or a source (Elastic/BP) is confirmed to have corrected/backfilled its own data behind the current watermark | There is no built-in "reset" command — do it by hand: for the Elastic adapter, set an explicit FROM_DATE behind the gap for one manual run (this overrides the SQL watermark outright); for the Blue Prism API adapter, either set BP_SINCE for a one-off run against a fresh BP_STATE_FILE, or directly UPDATE core.IngestWatermark SET LastUpdatedMax = '<earlier date>' WHERE Source='api' AND Queue='<queue>'. Either way this is safe: core.usp_MergeFact only overwrites on a strictly newer LastUpdatedDate and never deletes, so re-pulling old ground is a no-op for anything that hasn't actually changed |

### Where to look, generally

Local/demo mode: the browser devtools console (schema-version warnings, reference load errors); Administration → Data & sync's changelog; public/data/manifest.json (which build is actually live — generatedAt, source, sourceRows). Production: GET /api/health (dbOk, lastPullAt, dataThrough); core.PipelineRun (row-count deltas, status, errors, per run); core.RefChangeLog (who changed which reference section, and when); and the ingest Cloud Run Job's own structured JSON logs (one event per line — adapter_start/adapter_done, phase_start/phase_done, pipeline_success/pipeline_failed) for the detail behind any of the above.

## 14. Thresholds & alerting

A threshold-alerting layer (src/alerts/engine.ts, src/alerts/NotificationBell.tsx) evaluates the dashboard's own KPI targets against the trailing week of data and surfaces breaches/warnings via a bell icon in the header. This is deliberately separate from the static target reference lines already drawn on Overview/Capacity/Commercial/Input & Outcome — those come from the data build's baked targets and don't move when you edit thresholds here; the bell's targets are a live, editable layer on top.

### The threshold model

Seven global targets live in reference.targets (TargetsRef): completionPct, exceptionRate, systemRate, costPerCase, utilMin, utilMax, and vdiStaleDays. Any of the four rate metrics — completionPct, exceptionRate, systemRate, costPerCase — can additionally be overridden per spoke or per process via reference.thresholdOverrides[], each one a {scope: "spoke"|"process", scopeId, metric, value} record. Resolution precedence for a given metric (resolveThreshold() in reference-store.ts): a matching PROCESS override wins; else that process's own SPOKE override wins; else the global target.

> **Info:** Utilisation (utilMin/utilMax) and vdiStaleDays can only be overridden at spoke (or left at the global/estate) level, never per process. VDIs are spoke-owned, not tied to any single process, so the alert engine's vdi-scope evaluation only ever resolves utilMin/utilMax/vdiStaleDays via scope="spoke" — a process-scoped override of any of these would never be read. The Administration UI enforces this going forward: the metric picker excludes utilMin/utilMax/vdiStaleDays whenever you're adding a process-scoped override. Because thresholdOverrides is an additive field that doesn't force a schema-version bump, a process-scoped override of one of these three metrics created before this restriction existed (or a hand-edited JSON import) can still be sitting in the data — the UI detects and flags any such row inline as "not evaluated" rather than pretending it's live. A spoke-scoped vdiStaleDays override changes which of that spoke's VDIs fall into the review queue (VdiSection.tsx) and which trigger a staleVdi alert (engine.ts) — both read the same resolveThreshold() result.

### Where to configure it

Administration → Targets & thresholds (always visible to anyone who can reach Administration at all). Admins edit the six global targets directly. hub_leads (and admins) add or remove spoke/process overrides, but only for spokes they're assigned to (edit_spoke_reference) and that spoke's own processes — a hub_lead can't touch the global targets or another spoke's overrides.

### How evaluation works

- Window: the trailing 7 full days ending at the data build's data-through date (WINDOW_DAYS = 7 in engine.ts) — anchored to the last data build, not the browser's actual today.
- Scopes: estate-wide, each spoke, each process, and each VDI (utilisation only) — evaluateAlerts() walks all four every time it runs.
- Severity: past the threshold is a "breach"; within WARN_MARGIN (10%, a named constant in engine.ts, not a magic number) of the threshold but not yet past it is a "warn"; anything further from the threshold than that produces no alert.
- Minimum-volume guard: a process is skipped from evaluation entirely if it has fewer than MIN_ALERT_VOLUME (30 in engine.ts) completed+exception items in the trailing window — a 1-item process hitting 100% exceptions is noise, not a signal. This guard applies at process scope only; a spoke is skipped only if it has literally zero attempts in the window, and estate scope is always evaluated.
- Re-evaluation trigger: alerts recompute only when reference data changes or a new data build lands (evaluateAlerts(reference) is memoized on the reference object alone) — never when the dashboard's slicers change. Alerts are estate/spoke/process/vdi-scoped facts, not filter-relative.

### The bell

The header bell (NotificationBell.tsx) shows an unacknowledged-count badge (capped at "9+"), listing alerts sorted breach-before-warn, then estate → spoke → process → vdi. Acknowledgements are per-user (localStorage, keyed by user id) and expire naturally with each new data build: every alert's id embeds the data-through date (metric|scope|scopeId|dataThroughISO), so once a new data build moves that date, an old acknowledged alert's id no longer matches anything current and its acknowledgement is pruned automatically — there's no separate expiry timer, the id fingerprint does the work on its own. Clicking "View" on an alert navigates to the right page for its scope (e.g. Overview for an estate-wide completion-rate breach, Process detail for a process-scoped one, Capacity for a VDI utilisation alert) and sets the spoke/process slicers — and resets proposition/queue alongside them — to match.

### Honesty note

> **Note:** Alerting is in-app only today — the bell is a browser-side notification; nothing pushes to email, Teams, or anywhere else. Like the rest of this dashboard's more ambitious production plans (see section 8's Entra ID gap list), a real push channel needs a small server-side component: something that runs this evaluation logic on a schedule and calls out to an email/Teams/webhook API. The data API (section 4) exists now, but it has no alert-evaluation or notification code of its own today — that's still the natural place to add scheduled evaluation and outbound notification once it's built, not a from-scratch server that would need standing up alongside it.
