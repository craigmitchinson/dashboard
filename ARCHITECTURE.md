# Architecture — Intelligent Automation — Performance (hub & spoke IA CoE)

One universal model, five swappable hops. Every visual in the dashboard binds to
data whose lineage is:

```
Blue Prism work queue activity ──▶ adapter ──▶ CSV in the BPAWorkQueueItem schema ──▶ SQL warehouse ──▶ consumers
   (queue items, via Elastic)     preferred: elastic_to_csv.py   THE UNIVERSAL SWAP POINT   raw → staging      ├─ web dashboard (GCP)
                                   alternative: bp_api_to_csv.py                           → core → report    └─ any BI tool (external, direct on report.vw_*)
```

The preferred ingestion path is a pull from Elastic/Kibana
(`elastic_to_csv.py`): the estate already ships Blue Prism work queue
activity there via Data Gateways, and pulling from Elastic has **no further
impact on the Blue Prism production database**. A direct pull from the Blue
Prism work queue REST API (`bp_api_to_csv.py`) is the documented
**alternative**: it exists and is fully tested for estates that don't ship
activity to Elastic, and it's also worth using when you need authoritative
current item state — but unlike the Elastic route, it does add direct load
to the live BP environment, and its history depth is limited to whatever the
BP database hasn't yet purged. Both adapters write the identical CSV
contract, so nothing downstream cares which one ran.

`bp_api_to_csv.py`'s own docstring is explicit that its Blue Prism 7.x
Web API field mapping is an **assumption**, written without access to a live
Swagger/OpenAPI document — verify it against your instance before trusting it
in production (override any mismatch via `BP_FIELD_MAP_JSON`, no code change
needed). See PLAYBOOK.md section 2 for the full env var contract and this
caveat in detail.

The **schema is the contract** at every hop. Replace any hop and nothing
downstream changes:

| Hop | Today (demo) | Production | Swap mechanism |
|---|---|---|---|
| Source | `tools/generate-mock-data.mjs` (deterministic mock) | Elastic (preferred), Blue Prism work queue API (documented alternative) | drop-in CSV, same 16 columns |
| Extract | committed mock CSV | `bp-sql-layer/ingest/elastic_to_csv.py` (preferred: env-var config — URL, index, API key, date range; no impact on the BP production database) or `ingest/bp_api_to_csv.py` (alternative: OAuth client-credentials, `lastUpdated` watermark + overlap window) | writes the same CSV |
| Transform | `tools/build-dashboard-data.mjs` (Node port of the SQL) | On self-managed SQL Server: `10_bulk_load_csv.sql` → `core.usp_RunPull`. On Cloud SQL for SQL Server (where `BULK INSERT` from a local path isn't viable): `bp-sql-layer/ingest/run_pipeline.py` → `load_to_sql.py` → `core.usp_RunPull`, with a durable watermark/run ledger in `core.IngestWatermark`/`core.PipelineRun` | identical rules, verified shapes |
| Serve | static `/data/*.json` baked at build | `server/`'s data API, reading `report.vw_Model*`/`report.vw_Dim*`/`report.vw_EstateRateByDate` live from Cloud SQL | Both paths go through the ONE `shared/model-assembler.mjs` (so they can't drift — see below). `src/data/client.ts`'s `VITE_API_URL`-aware `fetchModel()`/`DATA_MODE` is what `src/main.tsx`'s boot sequence actually calls: `DATA_MODE` is `"api"` whenever `VITE_API_URL` is set (a static build's `dev`/`build` with no `VITE_API_URL` stays `"local"`, reading the baked JSON) |
| Reference | localStorage overlay on `data/reference/reference.json`, exported by hand as JSON/SQL | `PUT /api/reference` on `server/`'s data API writes SQL directly — versioned (`core.RefVersion`), conflict-checked (`If-Match`, a 409 opens the Admin panel's Conflict dialog) and audited (`core.RefChangeLog`); JSON/SQL export remains for local mode and for audits | `src/reference/backend.ts`'s `ApiBackend` (api mode) vs. the localStorage-backed overlay (local mode) — both sit behind the same `reference-context.tsx` interface, so the rest of the app doesn't care which one is live |

`shared/model-assembler.mjs` is the one function that turns "rowsets" (plain
arrays shaped like SQL view output, or their JSON-fixture twins) into the
exact `ModelJson` the dashboard reads. Both `tools/build-dashboard-data.mjs`
(the static build) and `server/`'s data API call it — a bug fixed there is
fixed in both places at once, and a CI test
(`server/test/assembler.test.ts`) proves the two paths stay identical by
replaying the static build's own view-fixture files through that same
assembler and asserting a byte-for-byte match against `public/data/model.json`.

## The 16-column contract (raw.WorkQueueItem)

```
ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate,
Worktime, ExceptionDate, ExceptionReason, QueueName
```

This is the standard Blue Prism 7.x `BPAWorkQueueItem` export plus `QueueName`.
`data/mock/BPAWorkQueueItem.csv` (regenerate: `npm run data:mock`) follows it
exactly — replace that file with a real export and run `npm run data:build` to
re-point every visual at real data.

## Transform rules (identical in SQL and the Node pipeline)

1. **Staging typing** — dates/numbers parsed once (`TRY_CONVERT` semantics:
   bad values become NULL, never fail a load); missing `LastUpdatedDate`
   falls back to the most recent meaningful timestamp.
2. **Outcome derivation** — Completed / Exception / Pending from the date
   columns; outcome date = CompletedDate ?? ExceptionDate ?? LoadedDate.
3. **Exception classification** — explicit `"Business Exception:"` /
   `"System Exception:"` prefix first (the convention), pattern fallback
   (`core.RefExceptionType`) second, default **Business** third.
4. **Merge** — identity is `ID`; a row is overwritten only when its
   `LastUpdatedDate` is newer. Never deletes (a pull may be one queue's file).

## Hub & spoke economics

Two money rules, applied per item, at the rates **in force on the item's
outcome date** — so a pay award or price change never re-values history:

**Benefit** = SMV × grade rate in force.
Each process carries the *grade of colleague it automates against* plus the
SMV (standard minutes value). `RefGradeRate` is the hub's date-effective rate
card. Spokes automating against different grades price differently with zero
per-spoke configuration; the dashboard's rate slider is a *what-if flat
override* on top (default: the rate card).

**Cost** = worktime × (hub £/bot-second + spoke pool £/bot-second).
- Hub pool/day = the CoE's people run-rate (`RefPeopleCostHistory`, `OwnerId='HUB'`
  — the sole source of hub people cost in both SQL and the JS/Node pipeline;
  `RefEstateCostHistory.TeamAnnualCostGBP` is retained for schema parity only
  and is not read for cost) + hub-owned VDIs, ÷ 365.25, apportioned by
  worktime across **all** work.
- Spoke pool/day = the spoke's **own** VDIs (`RefResource.SpokeId`) at the
  universal class rates (`RefVDICostHistory`, or a VDI's own `AnnualCostGBP`
  override), resolved through `report.fn_VdiDailyCost`'s renewal/expiry/
  retirement coverage-window logic — the same algorithm as the client's
  `economics.ts` — **plus that spoke's own people cost** (`RefPeopleCostHistory`,
  `OwnerId=<spokeId>`, date-effective, ÷ 365.25 — a spoke's people record is
  charged into its own pool exactly like the hub's is, not merely informational),
  all apportioned by worktime **within** the spoke. Retiring/adding/renewing a
  VDI, or dating a new spoke people-cost record, moves that spoke's cost
  automatically.
- Idle time is never a denominator: idle cost lands on the work that ran.

Ownership: the **hub** maintains spokes, the grade rate card, VDI class rates,
team cost history and exception patterns. Each **spoke** maintains its
propositions, processes (SMV + grade), queue mappings and VDI assignments.
All of it lives in `data/reference/reference.json` (JSON twin of
`07_seed_reference.sql` — keep them in step).

## The web dashboard

- React/Vite SPA; loads `/data/model.json` **before first render**
  (`src/main.tsx`), so pages read a fully-populated semantic model
  (`src/rpaData.ts`) and aggregate client-side per slicer state
  (`src/filters-context.tsx`). Money is only ever **summed** client-side —
  all rate resolution happened upstream.
- **Spoke slicer** first-class: "All spokes (hub)" or any spoke; propositions
  and processes narrow to it; the Capacity page shows exactly the machines
  that spoke pays for.
- **Saved views**: named bookmarks of every slicer + rate assumption + page
  (localStorage today; renameable, and shareable by link via a `#view=`
  base64url hash decoded client-side — no server round-trip; the `SavedView`
  type in `filters-context.tsx` is the API contract if views move
  server-side). The six filters and the what-if rate are likewise persisted
  per signed-in user between visits, separately from saved views.
- **Client-side economics engine** (`src/reference/economics.ts`): recomputes
  benefit (SMV × grade rate in force on the outcome date) and cost (worktime ×
  hub £/bot-second + spoke pool £/bot-second) from rate tables built by
  `buildRateTables()`, which are rebuilt whenever reference data changes. This
  mirrors the SQL `report.vw_*` views exactly — `tools/verify-economics.mjs`
  (`npm run data:verify`) checks the client engine reproduces the
  pipeline-baked totals to within 0.01%.
- **Reference data** (`src/pages/Admin.tsx` + `src/pages/admin/*`,
  `src/reference/reference-store.ts`, `src/reference/reference-context.tsx`,
  `src/reference/backend.ts`): the Administration panel lets the team edit
  spokes, rate cards, processes, queues and VDIs in-browser. In local mode
  that's a localStorage overlay — shared by whoever uses that browser, not
  per-user — on top of the committed base `data/reference/reference.json`
  (`model.json` embeds that base data so the overlay always has something to
  sit on top of), exportable as a replacement `reference.json` or a SQL
  script matching `bp-sql-layer/scripts/07_seed_reference.sql`. In api mode
  every edit is a `PUT /api/reference` call straight to SQL (see the Reference
  row above).
- `public/data/views/vw_*.json` are 1:1 ports of the SQL report views —
  they define the API response shapes for the production data service, and
  `manifest.json` records source + row counts for auditability.
- **Threshold alerting** (`src/alerts/engine.ts`, `src/alerts/NotificationBell.tsx`):
  evaluates `reference.targets`/`thresholdOverrides` against the trailing
  7-day window at estate/spoke/process/vdi scope and surfaces breach/warn
  alerts in a header bell; in-app only today, no email/Teams push — see
  `PLAYBOOK.md` section 16.

No BI tool is embedded in this app — there is no render-mode toggle. Any BI
tool is a valid *external* consumer that connects directly to the same
`report.vw_*` SQL views (see `deploy/gcp.md`).

For the operational runbook — Blue Prism / Elastic ingest setup, the SQL
script tour, the data API's own contract, deploying to GCP, the reference
sync loop, adding a new spoke, roles/sign-in, performance/scale guidance,
tests & CI, accessibility and troubleshooting — see
[PLAYBOOK.md](PLAYBOOK.md).

## GCP deployment

See `deploy/gcp.md` (the entry point) and `deploy/cloudsql.md` (the Cloud
SQL-specific reference); PLAYBOOK.md section 7 is the operational summary.
Short version: static demo = this repo's Dockerfile (nginx on Cloud Run),
self-contained. Production is five services around one Cloud SQL for SQL
Server instance: a Cloud Scheduler-triggered Cloud Run Job (`bp-ingest-pull`)
runs the Elastic pull (or the Blue Prism API adapter as the documented
alternative) through to `core.usp_RunPull`; `server/`'s data API
(`bp-api`, Cloud Run service, `AUTH_MODE=entra`) reads the warehouse and
serves the dashboard; the dashboard SPA (`bp-dashboard`, Cloud Run service)
reaches it via a same-origin nginx proxy (default) or an external Load
Balancer (production recommendation) — see `deploy/gcp.md` §5 for the
choice between the two.

## Repo map

```
data/reference/reference.json   team-owned config (spokes, grades, SMVs, VDIs, costs)
data/mock/BPAWorkQueueItem.csv  the swap point (gitignored; npm run data:mock)
tools/generate-mock-data.mjs    deterministic mock generator
tools/build-dashboard-data.mjs  CSV + reference -> /public/data (SQL-parity transform)
public/data/                    model.json + views/vw_*.json + manifest.json
src/                            the dashboard app
shared/                         model-assembler.mjs (rowsets -> ModelJson, used by BOTH
                                 tools/build-dashboard-data.mjs and server/) + auth-mappings.mjs
server/                         the production data API (GET/PUT /api/model, /api/reference,
                                 /api/health) — see server/README.md; server/test/ is its suite
tests/                          the dashboard's own vitest suite (economics, alerts, reference
                                 overlay, value rules, viz formatters, command palette, CSV, ...)
bp-sql-layer/                   the SQL warehouse (schemas, procs, views, runbook); scripts
                                 11-13 add the pipeline-ops tables, scale hardening, and the
                                 API-model views + RefAppSettings/RefVersion/RefChangeLog
                                 (13's migration also gives RefProcess real Icon/Tags columns)
bp-sql-layer/ingest/            elastic_to_csv.py (preferred: Elastic -> CSV, no BP DB load)
                                 bp_api_to_csv.py (documented alternative: BP work queue API -> CSV)
                                 run_pipeline.py / load_to_sql.py (Cloud SQL production loader)
deploy/                         nginx.conf.template + gcp.md + cloudsql.md + scripts/; Dockerfile
                                 at repo root, server/Dockerfile for the data API
```
