# Architecture — Intelligent Automation — Performance (hub & spoke IA CoE)

One universal model, four swappable hops. Every visual in the dashboard binds to
data whose lineage is:

```
Blue Prism work queue activity ──▶ adapter ──▶ CSV in the BPAWorkQueueItem schema ──▶ SQL warehouse ──▶ consumers
   (queue items, via Elastic)     preferred: elastic_to_csv.py   THE UNIVERSAL SWAP POINT   raw → staging      ├─ web dashboard (GCP)
                                   alternative: bp_api_to_csv.py                           → core → report    └─ Power BI (external, direct on report.vw_*)
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
| Transform | `tools/build-dashboard-data.mjs` (Node port of the SQL) | `bp-sql-layer` warehouse: `10_bulk_load_csv.sql` → `core.usp_RunPull` | identical rules, verified shapes |
| Serve | static `/data/*.json` baked at build | API over `report.vw_*` views (Cloud Run + Cloud SQL) | `VITE_DATA_URL` env var |

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

**Cost** = worktime × (hub £/bot-second + spoke infra £/bot-second).
- Hub pool/day = IA CoE team run-rate (`RefPeopleCostHistory`, `OwnerId='HUB'`
  — the sole source of hub people cost in both SQL and the JS/Node pipeline;
  `RefEstateCostHistory.TeamAnnualCostGBP` is retained for schema parity only
  and is not read for cost) + hub-owned VDIs, ÷ 365.25, apportioned by
  worktime across **all** work.
- Spoke infra/day = the spoke's **own** VDIs (`RefResource.SpokeId`) at the
  universal class rates (`RefVDICostHistory`, or a VDI's own `AnnualCostGBP`
  override), resolved through `report.fn_VdiDailyCost`'s renewal/expiry/
  retirement coverage-window logic — the same algorithm as the client's
  `economics.ts` — and apportioned by worktime **within** the spoke.
  Retiring/adding/renewing a VDI moves that spoke's cost automatically.
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
  (localStorage today; the `SavedView` type in `filters-context.tsx` is the
  API contract if views move server-side).
- **Client-side economics engine** (`src/reference/economics.ts`): recomputes
  benefit (SMV × grade rate in force on the outcome date) and cost (worktime ×
  hub £/bot-second + spoke infra £/bot-second) from rate tables built by
  `buildRateTables()`, which are rebuilt whenever reference data changes. This
  mirrors the SQL `report.vw_*` views exactly — `tools/verify-economics.mjs`
  (`npm run data:verify`) checks the client engine reproduces the
  pipeline-baked totals to within 0.5%.
- **Reference data overlay** (`src/pages/Admin.tsx` + `src/pages/admin/*`,
  `src/reference/reference-store.ts`, `src/reference/reference-context.tsx`):
  the Administration panel lets the team edit spokes, rate cards, processes,
  queues and VDIs in-browser, persisted per-user as a localStorage overlay on
  top of the committed base `data/reference/reference.json`. `model.json`
  embeds that base reference data so the overlay always has something to sit
  on top of. Edits export back out as a replacement `reference.json` or a SQL
  script matching `bp-sql-layer/scripts/07_seed_reference.sql`.
- `public/data/views/vw_*.json` are 1:1 ports of the SQL report views —
  they define the API response shapes for the production data service, and
  `manifest.json` records source + row counts for auditability.
- **Threshold alerting** (`src/alerts/engine.ts`, `src/alerts/NotificationBell.tsx`):
  evaluates `reference.targets`/`thresholdOverrides` against the trailing
  7-day window at estate/spoke/process/vdi scope and surfaces breach/warn
  alerts in a header bell; in-app only today, no email/Teams push — see
  `PLAYBOOK.md` section 11.

Power BI is not embedded in this app — there is no render-mode toggle. It is a
valid *external* consumer that connects directly to the same `report.vw_*` SQL
views (see `deploy/gcp.md`).

For the operational runbook — Blue Prism / Elastic ingest setup, the SQL
script tour, the reference sync loop, adding a new spoke, roles/sign-in,
performance/scale guidance, accessibility and troubleshooting — see
[PLAYBOOK.md](PLAYBOOK.md).

## GCP deployment

See `deploy/gcp.md`. Short version: static demo = this repo's Dockerfile
(nginx on Cloud Run). Production = same frontend + a small data API on Cloud
Run reading Cloud SQL (SQL Server) where `bp-sql-layer` runs; a Cloud
Scheduler job runs the Elastic pull (or the Blue Prism API adapter as the
documented alternative) + `usp_RunPull` on a schedule.

## Repo map

```
data/reference/reference.json   team-owned config (spokes, grades, SMVs, VDIs, costs)
data/mock/BPAWorkQueueItem.csv  the swap point (gitignored; npm run data:mock)
tools/generate-mock-data.mjs    deterministic mock generator
tools/build-dashboard-data.mjs  CSV + reference -> /public/data (SQL-parity transform)
public/data/                    model.json + views/vw_*.json + manifest.json
src/                            the dashboard app
bp-sql-layer/                   the SQL warehouse (schemas, procs, views, runbook)
bp-sql-layer/ingest/            elastic_to_csv.py (preferred: Elastic -> CSV, no BP DB load)
                                 bp_api_to_csv.py (documented alternative: BP work queue API -> CSV)
deploy/                         nginx.conf + gcp.md; Dockerfile at repo root
```
