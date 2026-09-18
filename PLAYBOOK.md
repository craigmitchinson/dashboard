<!-- GENERATED FILE — do not hand-edit. Edit src/pages/playbook-content.ts (or its data module) and run "npm run docs:playbook" to regenerate. -->

# Intelligent Automation — Operational Playbook

How to run, extend and troubleshoot this dashboard, in plain English. Every section below also renders as an in-app page (Playbook, in the Reference group) — both come from the same content module, so they never drift apart.

## Contents

- [1. What this is](#1-what-this-is)
- [2. Where we calculate the numbers](#2-where-we-calculate-the-numbers)
- [3. Pulling from Elastic](#3-pulling-from-elastic)
- [4. Loading and merging into SQL](#4-loading-and-merging-into-sql)
- [5. How money is calculated](#5-how-money-is-calculated)
- [6. Reference data we maintain](#6-reference-data-we-maintain)
- [7. The data API](#7-the-data-api)
- [8. Using the dashboard](#8-using-the-dashboard)
- [9. Value & Finance, targets and alerts](#9-value-finance-targets-and-alerts)
- [10. Users and sign-in](#10-users-and-sign-in)
- [11. Running it in GCP](#11-running-it-in-gcp)
- [12. Scale: 50-100M rows](#12-scale-50-100m-rows)
- [13. Tests, CI and runbook](#13-tests-ci-and-runbook)

## 1. What this is

This dashboard is our Intelligent Automation Centre of Excellence's (IA CoE) commercial and operational view of Blue Prism automation. We run it as a hub and spokes: the hub sets shared standards and shared infrastructure; each spoke — a business area running its own automations — owns its own processes, people and machines within that structure.

Every number on this dashboard traces back through one pipeline. Case data is aggregated in SQL. Money is then calculated from those aggregates and our reference data using one set of rules, held in the SQL views and mirrored in the browser; a parity check proves the two agree.

```text
Blue Prism
  -> Data Gateways (ships work-queue activity into Elastic)
  -> Elastic / Kibana (Blue Prism's own log store)
  -> our scheduled pull, every 15 minutes (elastic_to_csv.py)
  -> our SQL Server warehouse (raw -> staging -> core -> report)
  -> our data API (server/)
  -> this dashboard
```

Kibana keeps doing what it already does well: live operational monitoring of the Blue Prism estate. Our dashboard adds the commercial layer on top — benefit, cost, ROI and the reference data Kibana was never built to hold.

## 2. Where we calculate the numbers

We read from Elastic. We do not build in it. Our commercial measures — benefit, cost, ROI — are computed in our own SQL Server warehouse, not in Elasticsearch.

- Elastic is Blue Prism's own log store, owned and sized for operational logging. Putting our indices, transforms and reference data there ties our changes to a cluster we do not own, and risks the logging it exists for.
- Our numbers need joins to date-effective reference data — grade rates, people costs, VDI coverage windows — plus penny-exact reconciliation and versioned, role-controlled edits with an audit trail. Elasticsearch has no joins or transactions. The nearest tools — enrich processors, transforms, runtime fields — would mean rebuilding those lookups and re-running enrichment every time a rate changes. SQL views do this natively.
- The export is small: a delta of a few thousand rows every 15 minutes. The only extra cost of our own database is one always-on SQL instance.
- If we only wanted operational metrics — volumes, exception rates, run times — with no money attached, Kibana Lens could show those directly and we would not need this stack at all.

| Where | What lives there |
| --- | --- |
| Elastic / Kibana | Raw work-queue events; live operational dashboards |
| Our warehouse | Reference data, economics, alerts — everything this dashboard shows |

> **Info:** This is the best-practice pattern for source systems: Elastic stays read-only, exactly as Blue Prism already uses it. Our analytics live in a store we control.

## 3. Pulling from Elastic

elastic_to_csv.py queries the Blue Prism work-queue index in Elastic, sorted by LastUpdatedDate with the item ID as a tiebreak, and pages through results with Elastic's search_after cursor rather than a page-number offset — that stays reliable at scale. It writes one row per item into a CSV in the 16-column BPAWorkQueueItem schema, the contract everything downstream expects.

```text
ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate,
Worktime, ExceptionDate, ExceptionReason, QueueName
```

We track how far we have pulled in core.IngestWatermark (Source='elastic'). Every run re-pulls a window behind that watermark — ELASTIC_WATERMARK_OVERLAP_HOURS, default 24 hours — because a work item changes state in place (pending, then completed or an exception) and a change landing right at the edge of a narrow window could otherwise be missed. The watermark only moves forward after a pull succeeds and returns rows.

| Env var | What we set |
| --- | --- |
| ELASTIC_URL | Our Elastic/Kibana cluster URL |
| ELASTIC_INDEX | The index pattern to query, e.g. bp-workqueueitems-* |
| ELASTIC_API_KEY | ApiKey auth — the method we use (basic auth via ELASTIC_USER/ELASTIC_PASSWORD also exists, unused) |
| FROM_DATE / TO_DATE | Manual date override, for one bounded backfill only — otherwise the watermark drives |
| FIELD_MAP_JSON | Only needed if our Elastic documents use different field names than the script expects |
| BP_WORKTIME_UNIT | "s" by default — must match the unit our index actually stores |
| PAGE_SIZE | Elastic search_after page size |
| ELASTIC_WATERMARK_OVERLAP_HOURS | How far behind the watermark we re-pull every run, default 24 hours |

### First pull checklist

- [ ] Confirm Data Gateways is shipping Blue Prism activity into Elastic, and is current
- [ ] Confirm the index has the fields we expect (set FIELD_MAP_JSON if not) and confirm BP_WORKTIME_UNIT matches what it stores
- [ ] Run one bounded pull with FROM_DATE/TO_DATE set
- [ ] Open the CSV: 16 columns, no blank-ID rows
- [ ] Load it
- [ ] Check the load output for unmapped-queue warnings
- [ ] Reconcile source CSV rows against the new fact rows
- [ ] Remove the FROM_DATE/TO_DATE override and let the watermark drive from here

## 4. Loading and merging into SQL

run_pipeline.py is the one entry point our Cloud Run Job runs on every scheduled pull. It first calls core.usp_GetInFlightRun so two pulls never overlap — a 'running' row older than IN_FLIGHT_STALE_MINUTES is treated as crashed, not blocking. It then runs elastic_to_csv.py to pull the delta, and load_to_sql.py batch-inserts those rows into raw.WorkQueueItem over the ODBC driver. Finally it calls core.usp_RunPull, which runs staging.usp_LoadStaging — the one place we parse dates and numbers — then core.usp_MergeFact, which matches rows on ID and only overwrites when the incoming LastUpdatedDate is newer, so an overlapping pull is harmless. Every run writes one row to core.PipelineRun recording what happened.

| Env var | What it does |
| --- | --- |
| BP_ADAPTER | elastic — the only adapter we run |
| CSV_PATH | Where the adapter writes and the loader reads |
| LOAD_BATCH_SIZE | Rows per insert batch, default 5000 |
| IN_FLIGHT_STALE_MINUTES | How old a 'running' row must be before we treat it as crashed, default 30 |
| SQL_SERVER / SQL_PORT / SQL_DATABASE / SQL_USER / SQL_PASSWORD | Our Cloud SQL connection — SQL_PASSWORD comes from Secret Manager |
| SQL_ENCRYPT / SQL_TRUST_SERVER_CERTIFICATE / SQL_CA_CERT_PATH / SQL_CONNECT_TIMEOUT_SECONDS | TLS and connection-timeout settings |

The repo also carries a direct Blue Prism API adapter (bp_api_to_csv.py) for estates that do not ship to Elastic, and an on-prem bulk-load script (10_bulk_load_csv.sql); we use neither.

| Script | Purpose |
| --- | --- |
| 01_database_and_schemas.sql | Creates the BPAnalytics database and the raw/staging/core/report schemas |
| 02_raw_and_staging.sql | Creates raw.WorkQueueItem (untyped landing table) and staging.WorkQueueItem (typed) |
| 03_core_dimensions.sql | Creates the reference tables we edit — spokes, grade rates, processes, queue map, VDIs, cost history — and the calendar |
| 04_fact_and_calendar.sql | Creates core.FactWorkItem, one row per case — the single source of truth |
| 05_proc_load_staging.sql | Creates staging.usp_LoadStaging, which parses raw rows into staging |
| 06_proc_merge_fact.sql | Creates core.usp_MergeFact, the ID-match, newer-wins merge into the fact table |
| 07_seed_reference.sql | Seeds our reference data — the SQL twin of data/reference/reference.json |
| 08_report_views.sql | Creates the report views — every rate and cost calculation lives here |
| 09_proc_run_pull.sql | Creates core.usp_RunPull, which we call after every load |
| 10_bulk_load_csv.sql | On-prem bulk load, not used on Cloud SQL |
| 11_pipeline_ops.sql | Creates core.PipelineRun and core.IngestWatermark, our run ledger and watermark store |
| 12_performance.sql | Adds the columnstore index and supporting indexes for scale; documents but does not apply monthly partitioning |
| 13_api_model_views.sql | Adds the views and tables our data API reads from |

For initial history, we pull from Elastic in bounded FROM_DATE/TO_DATE windows, a month at a time, and merge each window the same way as an ongoing pull. We never page through a REST API item by item for a large backfill — Elastic's search_after paging handles that at scale; a page-by-page REST crawl does not.

## 5. How money is calculated

Benefit = completed cases × SMV (the standard minutes value for that process) × the grade rate in force on the outcome date. Each process carries the grade of colleague it automates against. A spoke's own rate, where one exists, wins over the estate-wide rate for that grade — we call this spoke-first resolution.

Cost = worktime × (our CoE pool rate + that spoke's own pool rate), both in pounds per bot-second. The CoE pool is our shared team's run-rate plus our CoE-owned VDIs' daily cost, spread across all work that day by worktime. Each spoke's own pool is that spoke's own team plus its own VDIs, spread only within that spoke's own work that day.

A VDI renewal buys 365 days of coverage at the class rate. A licence expiry or a retirement ends that coverage early — from that date a VDI costs nothing and counts as no available capacity.

Idle time is never a denominator — idle cost rides on the work that actually ran, never spread across it as if it were busy.

On the dashboard we show this cost as two rows — Teams and Machines (VDIs) — split by what kind of cost it is, not by who owns it. The two rows always reconcile to the penny against our total estate cost.

Exception rework cost = SMV × the grade rate in force on the exception's date. It is an upper bound on what rework would cost if redone at that rate, not a payment we actually make.

npm run data:verify checks that the browser's own economics engine and the SQL pipeline agree on these numbers. A pass prints PARITY OK.

### Worked example

Our CoE people cost today is 16 people at £860,000 a year, in force from 2025-04-01 — about £2,354.55 a day. An earlier record, 14 people at £780,000 a year from 2023-01-01, still applies to every day before that. If we hire a 17th person from 1 September 2026, we add a new record dated 2026-09-01; we never edit the old one, so past days stay honest.

## 6. Reference data we maintain

We maintain: spokes; propositions; processes (with SMV, grade, an icon and tags); the queue map (which Blue Prism queue feeds which process); grade rates, per spoke where they differ; people costs per owner, including the CoE; VDI classes and the VDI estate; targets and thresholds; and finance targets.

In production, every edit goes straight to SQL through PUT /api/reference, checked against an If-Match version header (core.RefVersion) so two people can never silently overwrite each other. Every accepted write is logged in core.RefChangeLog — who, when, what changed. A few sections with no table of their own — targets, threshold overrides, exception display codes, VDI operating hours, finance targets — live as JSON documents in core.RefAppSettings.

In local/demo mode, the base reference data lives in data/reference/reference.json, a JSON twin of 07_seed_reference.sql. Edits sit in a browser-only localStorage overlay until we export and commit them.

| Admin section | Who can edit |
| --- | --- |
| Squads | admin only |
| Grade rate card | admin (definitions and universal rates); hub_lead may add spoke-scoped overrides for their own spoke(s) |
| Exception patterns | admin only |
| Users & roles | admin only |
| Propositions & processes | admin, or hub_lead for their own spoke(s) |
| People costs | admin, or hub_lead for their own spoke(s) |
| VDI estate | admin, or hub_lead for their own spoke(s) |
| Targets & thresholds — global targets, exception patterns, universal rates | admin only |
| Targets & thresholds — spoke/process overrides and that spoke's own finance target | admin, or hub_lead for their own spoke(s) |

### Effective-dating rule

Every rate table looks up the record with the latest effectiveFrom on or before the date in question — no future-dating, no averaging. To change a rate, we add a new record dated today or a chosen future date; we never edit an old record, because that would silently change historical figures. The switch is a hard boundary at midnight, not a blend across the change date.

### VDI semantics

- A renewal buys a full 365-day coverage window at the class rate (or the VDI's own override rate), divided evenly across however many days that window covers
- A licence expiry shortens the current window — coverage, and cost, stop the day after expiry until we book a new renewal
- Retiring a VDI (status 'retired', with an end date) also cuts its coverage window short from that date

### Adding a new spoke

1. Administration → Squads: add the spoke's name, short name and colours
2. Administration → Propositions & processes: add its propositions and processes, with each process's SMV and grade
3. Map each Blue Prism queue name to the process it feeds
4. Administration → VDI estate: add the spoke's VDI records, with cost class and owner set to the new spoke
5. Administration → People costs: add a people-cost record for the spoke — it feeds the spoke's own pool
6. Assign a hub_lead for the spoke — in production, this is an Entra ID group

## 7. The data API

server/ is the only thing that reads or writes our warehouse on the dashboard's behalf. The browser never talks to SQL Server directly.

| Endpoint | Returns | Auth |
| --- | --- | --- |
| GET /api/health | { ok, dataThrough, lastPullAt, dbOk, version } | None |
| GET /api/model | The ModelJson the dashboard reads, gzip'd and ETag-aware; X-Data-Stale: true if it is serving a cached copy | Any signed-in user |
| GET /api/reference | { reference, version, updatedAt, updatedBy } | Any signed-in user |
| PUT /api/reference | The same shape on success; 400/409/403 on failure | admin, or hub_lead scoped to their own spoke(s) |

AUTH_MODE controls how we check who is calling. entra validates a bearer token against our Entra ID tenant and maps group membership to a role and spoke(s). dev and none exist only for local development — the server refuses to start with either when NODE_ENV=production.

On every write, the server checks permissions itself, regardless of what the browser sent. admin can change anything; a hub_lead can only change rows in their own spoke(s), and never anything estate-wide — the spokes list, grade definitions, exception patterns, global targets, or VDI operating hours.

We can run and test the API with no infrastructure at all: DATA_SOURCE=fixtures FIXTURES_DIR=../public/data/views serves the same ModelJson from the static files our build script already writes to public/data/views/.

| Env var | Default | Notes |
| --- | --- | --- |
| PORT | 8080 |  |
| NODE_ENV | development | production enables the dev/none auth-mode guard |
| AUTH_MODE | none | entra in production |
| ENTRA_TENANT_ID / ENTRA_AUDIENCE | — | required for AUTH_MODE=entra |
| DATA_SOURCE | sql | sql in production |
| SQL_SERVER / SQL_PORT / SQL_DATABASE / SQL_USER / SQL_PASSWORD | — | SQL_PASSWORD is Secret Manager-backed |
| SQL_ENCRYPT / SQL_TRUST_CERT | true / false |  |
| CORS_ORIGIN | reflect all | set to the dashboard's own origin in production |

## 8. Using the dashboard

| Group | Page | What it answers |
| --- | --- | --- |
| Overview | Overview | How is the estate doing right now? |
| Overview | Alerts | What needs attention today? |
| Operate | Input & Outcome | What came in, and what happened to it? |
| Operate | Process Analysis | Which processes are healthy, which are not? |
| Operate | Exceptions | What is failing, and why? |
| Optimise | VDI & Capacity | Are our machines used well? |
| Value | Executive Summary | The headline numbers for the exec and finance, on one screen |
| Value | Value & Finance | What is automation worth, net? |
| Value | Commercial Performance | What is the ROI, per case, per process? |
| Manage | Administration | Where we edit reference data |
| Reference | Data model, Playbook (admin only) | How the data and pipeline work |

Executive Summary is the one page with no slicer bar: it has its own period control (This month, Last month, Quarter to date or FY to date, always anchored on the data-through date) and puts the headline numbers, estate health, a by-hub table, movers and a generated three-sentence briefing on a single screen. Print and Copy figures give the exec and finance a clean page or a pasteable set of figures without touching any other page.

Ctrl+K (or Cmd+K) opens a searchable command palette: pages, a 'drill into' shortcut for any process, a 'filter to' shortcut for any spoke, saved views, our top 5 unacknowledged alerts, actions like resetting slicers or toggling theme, and — for admins — a jump straight to any Playbook section. Typing > searches actions only.

The six slicers and the what-if rate are now remembered per signed-in user between visits, alongside saved views, the last page, display settings and alert acknowledgements/snoozes — Reset still returns filters and the what-if rate to their defaults (all spokes, last 90 days) without touching a saved view. A saved view can now be renamed in place, and Copy link puts a shareable URL on the clipboard with the view encoded in its hash, so anyone opening that link gets the same view applied, no sign-in or server round-trip needed to decode it.

| Keys | Action |
| --- | --- |
| ? | Show the keyboard shortcuts list |
| Ctrl+K / ⌘K | Open the command palette |
| Shift+A | Open Accessibility & display settings |
| / | Focus the spoke slicer |
| [ | Toggle navigation collapse |
| Esc | Close whatever is open |
| Alt+1 … Alt+9 | Jump to page 1 through 9 in nav order |

The header and slicer band stay fixed. Most pages scroll only in the canvas beneath them. Value & Finance and Playbook scroll the whole page, because each simply holds more than one screen.

Clicking a process anywhere takes us to Process detail, with a breadcrumb back to where we came from. Back (or the browser's own Back button) returns us exactly where we started, slicers included.

Every table carries an Export CSV button, named <name>-<data-through-date>.csv. Any value that looks like a spreadsheet formula gets a leading apostrophe, so opening it in Excel never runs anything by accident.

Money reads compact on tiles and axes (£382.7k) and in full elsewhere (£53,320). A negative value shows its sign before the £. A value we cannot compute shows as —.

Each spoke has its own accent colour, used for swatches, side rails and chart series — never as a solid fill behind text, which would break contrast. Choosing a spoke re-skins the dashboard to that colour.

Our navigation rail and slicer band use a frosted-glass effect. It switches off automatically under a high-contrast theme, the OS's 'reduce transparency' setting, an unsupported browser, or the Liquid glass toggle in Accessibility & display.

### Accessibility & display panel (Shift+A)

- Theme: light, dark, or high contrast
- Liquid glass: on/off
- Text scale: 100% / 115% / 130%
- Dyslexia-friendly font
- Bionic reading (bolds the start of each word in prose, never in chart labels or numbers)
- Reading ruler
- Colour-vision-safe palette (Okabe-Ito)
- Reduce motion
- Seasonal accent
- World clocks (UK / India)

We test this by unplugging the mouse: Tab through every page and confirm each interactive element shows a visible focus outline, Alt+1…9 jump between pages, ? opens and Esc closes the shortcuts list, and every toggle in Accessibility & display is reachable by keyboard alone.

## 9. Value & Finance, targets and alerts

- Net benefit, with the change versus the prior window
- Annualised run-rate
- ROI — gross benefit ÷ cost
- Payback period, in months
- FTE released
- Cost per case, against target

The waterfall runs Gross benefit, minus Teams, minus Machines (VDIs), equals Net, plus a memo bar for idle machine cost that no work absorbed that day. The memo is shown for honesty and is not subtracted from Net. We split cost by kind — people versus machines — not by owner, because the CoE is just one owner alongside the spokes.

Spoke P&L: one row per spoke — gross benefit, people cost, infrastructure cost, net, margin, cost per case, a 12-week trend, financial-year-to-date, and the spoke's own target. Every table exports to CSV.

The value league ranks processes by value; a review-candidates list flags the ones worth a second look, using fixed rules: volume under 30 cases flags 'low volume'; exception cost above 30% of runtime cost flags 'high exception cost'; unit cost above 1.5× the cost-per-case target flags 'high unit cost'; anything else that still lands on the list gets a generic flag.

We project each spoke's, and the estate's, net position to financial year end at the current run-rate. The financial year start month (targets.fiscalYearStartMonth, default April) is one global setting; finance targets are editable in Administration → Targets & thresholds.

### Thresholds and alerts

Seven global targets — completion rate, exception rate, system rate, cost per case, utilisation min/max, and VDI stale days — live in reference.targets. Any of the four rate metrics can be overridden per spoke or per process. Resolution: a matching process override wins; else that process's spoke override; else the global target.

We configure this at Administration → Targets & thresholds. Admins edit the global targets directly; hub_leads add or remove overrides, but only for their own spoke(s) and that spoke's processes.

reference.targets is now the single source of truth for the whole dashboard, not just the alert engine: every page reads it live (with a spoke override resolved when one spoke is selected), so saving a target here moves the alerts, every KPI target chip, and every dashed reference line on a chart in the same instant. Process Analysis's league-table colouring reads the same threshold and the same early-warning band the alerts use, so a process never reads healthy on one page and breaching on another.

We evaluate the trailing 7 days ending at the last data build, across the estate, every spoke, every process, and every VDI (utilisation only). Past the threshold is a breach; within 10% of it is a warn. A process with fewer than 30 completed-plus-exception items in the window is skipped — a 1-item process at 100% exceptions is noise, not a signal.

The header bell lists alerts, worst first, scoped to the spoke we currently have selected. Acknowledgement is per signed-in user and expires automatically once a new data build moves past the alert's date. Snooze until resolved is also per user, but survives a data build: it hides an alert for as long as the same breach keeps recurring, and clears itself the first time that breach does not reappear. The Alerts page carries a Show snoozed toggle and an Unsnooze action for anything snoozed.

A hub-owned (shared or test) VDI stays a CoE concern, but its alerts are now also shown to a hub whose own processes actually ran on that machine — that hub's throughput depends on the machine's health too. A hub-owned VDI that never ran any of a hub's processes stays hidden from that hub.

> **Info:** Alerting is in-app only today — nothing pushes to email or Teams yet. That would need a small scheduled job added to our data API.

## 10. Users and sign-in

In production, we sign in through Entra ID using PKCE (Proof Key for Code Exchange) — a public-client flow that never holds a client secret in the browser. Signing in gets us two tokens: an ID token (proves who signed in) and an access token, scoped to our data API and attached as a bearer header on every /api/* call.

Group membership maps to a role and spoke(s) in shared/auth-mappings.mjs — one file, imported directly by both the browser app and the data API, so the two sides can never disagree about what a group means.

| AD group | Maps to |
| --- | --- |
| SG-RPA-Admins | role: admin |
| SG-RPA-IPI-Lead / SG-RPA-RSK-Lead / SG-RPA-COM-Lead / SG-RPA-CLD-Lead | role: hub_lead, spoke taken from the group name |
| SG-RPA-HubMembers | role: hub_member |
| SG-RPA-BusinessUsers | role: business_user |

### What we ask our identity team for

- An app registration for the dashboard, with the redirect URI set to wherever it is hosted
- A scope on the API's own app registration, so the dashboard can request a token audienced to it
- The groups claim turned on, with group names (not just object IDs) emitted
- The seven AD groups above created, with real users assigned

For demos, we sign in as one of six seeded users, all sharing the passphrase "demo" — never used in production. Nigel Spriggs (admin) is the usual demo account.

The Administration panel hides what a user should not see, but our data API checks again on every write, regardless of what the browser sent. admin can change anything. A hub_lead can only change rows in their own spoke(s); anything estate-wide is admin-only. That server-side check, not the browser, is what actually enforces the rule.

## 11. Running it in GCP

- Cloud SQL for SQL Server — our warehouse, private IP only, always on
- Cloud Run Job bp-ingest-pull — runs run_pipeline.py on a schedule
- Cloud Scheduler — triggers bp-ingest-pull via the Cloud Run Admin API's :run method, since Cloud Run Jobs have no HTTPS URL of their own
- Cloud Run service bp-api — our data API, AUTH_MODE=entra, kept at --min-instances=1
- Cloud Run service bp-dashboard — this SPA, built in api mode
- Secret Manager — SQL_PASSWORD and the Elastic API key
- Artifact Registry — holds both container images

### Verified Cloud SQL constraints

- No IAM database authentication for SQL Server — SQL_USER/SQL_PASSWORD (Secret Manager-backed) is the only login path
- No public-IP path and no Unix-socket proxy — both services need Direct VPC egress onto the instance's private IP
- BULK INSERT is not viable on Cloud SQL — that is why we use run_pipeline.py, not 10_bulk_load_csv.sql

We recommend one external HTTPS Load Balancer in front of both services for production — one domain, one managed certificate, and both services stop accepting public traffic directly. For a first deploy, the simpler nginx-proxy topology (bp-dashboard's own nginx forwards /api/* to bp-api) needs no domain or certificate to stand up.

### Order of operations

1. Provision Cloud SQL and the warehouse schema: deploy/scripts/01 through 05 (fill in env.sh first)
2. Deploy the ingest job: 06_deploy_ingest_job.sh, then test it once manually before scheduling
3. Schedule it: 07_scheduler.sh (default: every 15 minutes)
4. Deploy the data API: 08_deploy_api.sh, with ENTRA_TENANT_ID/ENTRA_AUDIENCE filled in
5. Deploy the frontend: 09_deploy_frontend.sh (nginx-proxy) or 10_deploy_loadbalancer.sh (Load Balancer)
6. Optional: connect a BI tool directly to the report.vw_* views

### First real pull, before scheduling

1. Dry-run the pipeline with no network calls: python run_pipeline.py --dry-run
2. Run the job once manually with a narrow FROM_DATE/TO_DATE
3. Check core.PipelineRun for Status='success' and sane row counts
4. Check the logs for unmapped-queue warnings and map them
5. Reconcile row counts, then widen the window and schedule it

Both Cloud Run services keep every old revision, so the fastest fix for a bad deploy is a traffic shift, not a rebuild. The ingest job is not revisioned the same way — we pin INGEST_IMAGE to a digest for a one-line rollback. None of the SQL scripts are written as down-migrations; reversing a schema change means writing the inverse DDL by hand.

We can exercise the real API and dashboard together with no GCP project at all: run the API in fixture mode (DATA_SOURCE=fixtures), then point the dashboard at it with VITE_API_URL=http://localhost:8080. CI runs the fixture-mode test suite, including the assembler-parity check, before any image is built.

## 12. Scale: 50-100M rows

Every hop in the pipeline moves only a delta. The Elastic pull uses a watermark plus a deliberate overlap. The SQL merge is idempotent — it matches on ID, only overwrites on a newer LastUpdatedDate, and never deletes. The browser only ever gets pre-aggregated totals, never raw rows.

Today's mock dataset is about 232,000 rows; core.FactWorkItem is built to hold 50-100 million.

Done: a nonclustered columnstore index on core.FactWorkItem, plus supporting rowstore indexes on Resource and LastUpdatedDate (12_performance.sql). A durable watermark table, core.IngestWatermark, so pulls are self-driving and safe to schedule.

Pending: monthly partitioning of core.FactWorkItem by outcome date — the DDL is written but commented out in 12_performance.sql, ready to apply once we need it. Server-side paging for item-level search — today's Exceptions detail view is small enough to filter in the browser; it will not stay that way at full scale.

### Signs we need the partitioning migration

- [ ] model.json and the views files are climbing past tens of MB
- [ ] Initial dashboard load time is creeping past 2-3 seconds
- [ ] The day×process row count is heading into the hundreds of thousands
- [ ] We need item-level search across all raw rows, not just the pre-aggregated grain
- [ ] report.vw_* query latency is visibly degrading

## 13. Tests, CI and runbook

- Economics rules: rate-in-force lookups, VDI coverage-window arithmetic, benefit/cost formulas
- Reference data: overlay-merge rules, schema-version rejection, threshold resolution order
- Alerts: warn/breach classification, the minimum-volume guard, headline phrasing, the stale-VDI signal
- Data pipeline parity: the built model reproduces the same totals the client computes
- Display: number formatting, CSV export, command palette ranking, fiscal-year bounds, net-trend math
- Value & Finance: review-candidate rules and the cost-composition identity

server/'s own tests prove the API side: the static build and the live API produce byte-for-byte the same model; the SQL writer and the browser exporter use the same column order; the dev/none auth guard, hub_lead scoping, and the 409 conflict shape all behave as documented.

npm run data:verify reloads the built model, re-runs the same rate-table and benefit/cost math the client uses, and checks the totals match to within 0.01%. A pass prints PARITY OK.

### CI gate order

1. npx tsc --noEmit — type-check
2. npx vite build — production build
3. npm test — the suite above
4. npm run data:all — rebuild the mock CSV and model
5. npm run data:verify — parity check
6. npm run docs:playbook, then git diff --exit-code PLAYBOOK.md — keeps this file honest
7. server: npm ci && npm run build && npm test

| Script | Command | What it does |
| --- | --- | --- |
| npm run dev | vite | Local dev server |
| npm run build | tsc && vite build | Type-check, then production build |
| npm run data:all | npm run data:mock && npm run data:build | Mock data plus build, in one go |
| npm run data:verify | node tools/verify-economics.mjs | Checks the economics engine matches the pipeline |
| npm run docs:playbook | node tools/build-playbook-md.mjs | Regenerates PLAYBOOK.md from this file |

Daily/weekly, we confirm the scheduled Elastic pull ran, skim the pipeline logs for unmapped-queue warnings, and — whenever anyone edits reference data — follow the sync that matches our mode: production writes are already in SQL and audited; local mode needs a JSON export and a commit.

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| GET /api/health returns dbOk: false | SQL connection cannot reach Cloud SQL | Cloud Run logs, Direct VPC egress, Secret Manager binding |
| A response carries X-Data-Stale: true | The database was unreachable when a rebuild was attempted | dbOk above, and core.PipelineRun for why |
| PUT /api/reference returns 409 | Someone else's edit landed first | Refetch and reapply on the current snapshot the response returns |
| core.PipelineRun stuck at Status='running' | A run crashed before its final update | Self-clears after IN_FLIGHT_STALE_MINUTES; check the job's own logs |

### Common local failures

- Numbers look wrong right after a CSV swap — compare the CSV header row against the 16-column contract
- Every KPI shows £0 — reference.json failed to load; check the browser console
- Admin edits vanished — the localStorage overlay's schema version no longer matches; check the console, then re-apply
- A queue's data is not showing up — it is not in the queue map; check for the unmapped-queue warning
