# Dashboard API server

Production data API for the Intelligent Automation dashboard SPA. Serves
`ModelJson` (the SPA's `/data/model.json` shape — see `src/rpaData.ts`) over
HTTP from SQL Server (Cloud SQL), and persists reference-data edits
(`PUT /api/reference`) back into the database, transactionally, in the same
FK-safe order the SPA's browser-side exporter uses.

The whole point of this service: `tools/build-dashboard-data.mjs` (the
static-build path) and this server both call the exact same
`shared/model-assembler.mjs` to turn "rowsets" into `ModelJson`. A bug fixed
in the assembler is fixed in both places. See that file's header comment for
the full rowset contract.

## Run it

```
npm ci
npm run build   # tsc -> dist/
npm start       # node dist/index.js
```

or for local development with auto-reload:

```
npm run dev
```

### Against a real SQL Server

```
DATA_SOURCE=sql
SQL_SERVER=<host>
SQL_DATABASE=BPAnalytics
SQL_USER=<user>
SQL_PASSWORD=<password>
SQL_ENCRYPT=true        # default true
SQL_TRUST_CERT=false    # default false
```

Requires `bp-sql-layer/scripts/13_api_model_views.sql` to have been run
against the target database (on top of the existing `08_report_views.sql` /
`03_core_dimensions.sql` / `04_fact_and_calendar.sql`), IN ADDITION to
whatever `11_pipeline_ops.sql`/`12_performance.sql` a sibling task adds.

### FIXTURE MODE — no database required (CI / SPA-worker local dev)

This is the primary way to run this API with **zero infrastructure**: it
serves the exact same `ModelJson`, through the exact same assembler, from
the static JSON view ports `tools/build-dashboard-data.mjs` already writes
to `public/data/views/` on every `npm run data:build` at the repo root.

```
DATA_SOURCE=fixtures
FIXTURES_DIR=../public/data/views
AUTH_MODE=dev            # or "none" — see Auth below
PORT=8080
npm run dev
```

Run from the `server/` directory, `FIXTURES_DIR=../public/data/views`
resolves to `<repo-root>/public/data/views` — exactly the directory
`npm run data:build` (root `package.json`) writes to. The reference-data
seed (`data/reference/reference.json`) is located automatically, three
levels above `FIXTURES_DIR` (`<FIXTURES_DIR>/../../../data/reference/
reference.json`); override with `FIXTURES_REFERENCE_PATH=<abs path>` if your
checkout is laid out differently.

**Limitation** (documented in `src/data/fixtures.ts`'s header comment): the
fact-based rowsets (`dayRows`, `excRows`, `resRows`, `estateRateByDate`,
`dayWorktimeTotals`, `spokeDayWorktimeTotals`, `resourceActivity`, `meta`,
`unmappedQueues`, `exceptionReasons`) are a **frozen snapshot** from the last
`npm run data:build` — fixture mode has no live warehouse to re-run the cost
engine against a `PUT /api/reference` edit. The **dimension** rowsets
(`spokes`/`propositions`/`processes`/`resources`) and the `reference` object
itself **do** reflect live `PUT` edits immediately (an in-memory
`ReferenceStore`, reset on process restart) — exactly like the real SQL path
derives them from `core.Ref*` on every request.

## Endpoints

- `GET /api/health` → `{ ok, dataThrough, lastPullAt, dbOk, version, lastRun, stale }`. No
  auth. `lastRun` is the latest `core.PipelineRun` row (whatever its status)
  via `report.vw_PipelineHealth`; `stale` is true when its
  `watermarkAgeMinutes` exceeds `3 x PULL_CADENCE_MINUTES`. See "What breaks
  and how you'll know" below.
- `GET /api/model` → `ModelJson`, gzip'd, `ETag`/`If-None-Match` aware (304 on
  a match). Any authenticated user. Falls back to the last good cached model
  with `X-Data-Stale: true` if the data source is unavailable; 503 if
  nothing is cached yet.
- `GET /api/reference` → `{ reference, version, updatedAt, updatedBy }`. Any
  authenticated user.
- `PUT /api/reference` (header `If-Match: <version>`, body
  `{ reference, actor, section }`) → `200` with the new snapshot, `400` on a
  shape validation failure, `409` with `{ error, current }` on a version
  mismatch, `403` if the caller isn't permitted (see Auth below).

## Auth

Set via `AUTH_MODE`:

- `entra` — validates a `Bearer` JWT against the Entra ID tenant's JWKS
  (issuer/audience/exp/signature, via `jose`), then maps its `groups` claim
  to a role + spokeIds using `shared/auth-mappings.mjs` — the single copy of
  `GROUP_ROLE_MAPPINGS`/`mapClaimsToUser` that both this server and the SPA
  (`src/auth/entra-provider.ts`) import directly, so a mapping change lands
  in one place and both sides see it at once. Requires `ENTRA_TENANT_ID` and
  `ENTRA_AUDIENCE`.
- `dev` — trusts an `X-Dev-User` header verbatim: a JSON object
  `{id,name,email,roles,spokeIds}`. **Local dev / fixture-mode CI only** —
  the server refuses to even start with `AUTH_MODE=dev` (or `none`) when
  `NODE_ENV=production` (see `config.ts`).
- `none` — every request is treated as an anonymous `business_user`. Local
  dev only, same production guard as `dev`.

Roles: `admin`, `hub_lead`, `hub_member`, `business_user` (same four as the
SPA). Enforcement on `PUT /api/reference`:

- `admin` — any change.
- `hub_lead` — only if **every** touched row's spoke is in the caller's own
  `spokeIds`, **and** the diff touches nothing GLOBAL (the `spokes[]`
  dimension itself, `grades`, `exceptionPatterns`, `estateCostHistory`,
  `targets` — including `fiscalYearStartMonth` — `exceptionDisplayCodes`,
  `vdiOperatingHoursPerDay`, the estate-wide `financeTargets` row
  (`spokeId: "ESTATE"`), or any universal/hub-scoped rate row; a per-spoke
  `financeTargets` row is attributed to that spoke like any other spoke-owned
  row. See `data/reference-diff.ts` for exactly how a changed row is
  attributed to a spoke (or `GLOBAL`).
- anyone else — `403`.

`GET /api/model` and `GET /api/reference` only require *any* authenticated
user, regardless of role.

## Config (env vars)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | |
| `NODE_ENV` | `development` | `production` enables the dev/none auth-mode guard |
| `CORS_ORIGIN` | (reflect all) | passed to `@fastify/cors`'s `origin` |
| `LOG_LEVEL` | `info` | pino level |
| `AUTH_MODE` | `none` | `entra` \| `dev` \| `none` |
| `ENTRA_TENANT_ID` / `ENTRA_AUDIENCE` | — | required for `AUTH_MODE=entra` |
| `DATA_SOURCE` | `sql` | `sql` \| `fixtures` |
| `PULL_CADENCE_MINUTES` | `15` | Expected minutes between ingest pulls — `GET /api/health`'s `stale` = `lastRun.watermarkAgeMinutes > 3x` this. |
| `FIXTURES_DIR` | — | required for `DATA_SOURCE=fixtures` |
| `FIXTURES_REFERENCE_PATH` | derived | override the fixture-mode reference.json path |
| `SQL_SERVER` / `SQL_PORT` / `SQL_DATABASE` / `SQL_USER` / `SQL_PASSWORD` | — | |
| `SQL_ENCRYPT` | `true` | |
| `SQL_TRUST_CERT` | `false` | |

## Resilience

- SQL connection pool retries with exponential backoff (capped at 30s) on
  startup and never blocks the process from listening — `/api/health`'s
  `dbOk` reflects the live connection state.
- `/api/model` never 500s on a transient DB hiccup if a model was built
  successfully before: it serves the cached copy with `X-Data-Stale: true`.
- A route-handler error never crashes the process (Fastify's error handler
  + a belt-and-braces `unhandledRejection`/`uncaughtException` logger).

## Tests

```
npm test
```

- **Assembler contract** (`test/assembler.test.ts`): `assembleModel()` fed
  the fixture rowsets under `public/data/views/vw_Model*.json` (+
  `vw_EstateRateByDate.json` + `data/reference/reference.json`) deep-equals
  `public/data/model.json` — the parity guarantee between the static build
  and this API.
- **Reference write order** (`test/reference-order.test.ts`): `data/table-
  order.ts`'s `DELETE_ORDER`/`INSERT_ORDER` equal
  `src/reference/reference-store.ts`'s `exportReferenceSql()` order exactly.
- **SQL reference store** (`test/sql-reference.test.ts`), against a
  lightweight in-memory fake of the mssql surface `SqlReferenceStore` uses
  (no real database): a process's `icon`/`tags` round-trip through
  `core.RefProcess.Icon`/`Tags` (`;`-joined) unchanged, including the
  no-icon/no-tags case; the writer's `RefProcess` column list includes
  `Icon`/`Tags`; and `spa-exporter-columns-in-sync` asserts that list equals
  `src/reference/reference-store.ts`'s `exportReferenceSql()` `RefProcess`
  column list (parsed as text) — this one is a cross-repo-half parity guard
  and will fail if that SPA-side function's column list ever drifts from
  the server's.
- **Auth** (`test/auth.test.ts`): dev-header mode refused when
  `NODE_ENV=production`; a `hub_lead` PUT touching another spoke (or
  anything global) is rejected; an `If-Match` mismatch on
  `enforceReferenceWrite`'s caller path yields the documented conflict
  shape.
- **Health** (`test/health.test.ts`): response shape.
- **Reference schema** (`test/reference-schema.test.ts`): `validateReference()`
  rejects NaN/Infinity in a numeric field (a bare `typeof` check would wrongly
  admit both) and rejects a duplicate `spokeId` within `financeTargets[]`
  with a named error rather than silently overwriting one row with another.

## What breaks and how you'll know

"Set and forget" only works if a broken pipeline or a bad ingest is
impossible to miss. This is the map from symptom to cause to fix, across
the whole ingest→SQL→API→dashboard chain (see `bp-sql-layer/scripts/
05_proc_load_staging.sql`/`11_pipeline_ops.sql` for the quarantine/ledger
mechanics this table refers to, and `deploy/gcp.md`'s §11 for the
out-of-band email alerts).

| Symptom | Where it shows | What to do |
|---|---|---|
| A row is missing from the dashboard entirely | Nowhere obvious — this is the failure mode quarantining exists to prevent | Check `raw.WorkQueueItemRejected` for that `ID`/date range; `RejectReason` names exactly which field failed (blank ID, an unparseable date, a non-integer/negative Worktime or Attempt, an unknown Status). Fix the source export and re-pull. |
| "Rows rejected" is non-zero, or the ingest job exits 4 | `GET /api/health`'s `lastRun.rowsRejected`; the dashboard's Admin → Data & sync → Data health block; Cloud Run execution logs (`reject_rate_check` / `pipeline_failed` structured log lines) | A small, steady trickle is often a known-messy source field — check `raw.WorkQueueItemRejected`'s `RejectReason` breakdown. A sudden spike usually means the source export changed shape or a queue started emitting garbage; fix at source, don't just raise `MAX_REJECT_PCT`. |
| A queue's items never appear against any process | The dashboard's Data health block's "Unmapped queues" list; `report.vw_ModelUnmappedQueues`; `core.usp_RunPull`'s own PRINT warning | Add the queue to `core.RefQueueMap` under Administration → Propositions & processes → Queue mappings (or directly in SQL) — the hint text next to each unmapped queue says the same. |
| The ingest job container exits non-zero | Cloud Run Jobs execution history; the email alert from `deploy/scripts/11_alerting.sh`'s `bp-ingest-run-failed` policy; `core.PipelineRun.Status = 'failed'` with `Error` populated | Read `Error` on the latest `core.PipelineRun` row (or the container's own JSON stdout logs) — exit 1 is a config problem (env vars), 2 is the adapter subprocess, 3 is a CSV header mismatch or SQL error, 4 is an excessive reject rate (see above). |
| Nothing has pulled in a long time, but no single run "failed" | The email alert from `11_alerting.sh`'s `bp-ingest-no-recent-success` policy (log-absence, 60 minutes); `GET /api/health`'s `stale: true` | Check Cloud Scheduler hasn't been paused/deleted (`gcloud scheduler jobs describe <job>-scheduler`), and that the job isn't stuck `Status='running'` past `IN_FLIGHT_STALE_MINUTES` (`core.usp_GetInFlightRun`). |
| The dashboard's header dot is amber | `src/data/status.tsx`'s `apiOk` (folds in both API-unreachable and `stale`) | Check `GET /api/health` directly — `dbOk: false` means the API can't reach SQL; `stale: true` means the data itself is old even though the API/DB are both up. The Admin → Data & sync page has the detail either way. |
| A database not yet migrated with this task's columns | `GET /api/health`'s `lastRun: null`; `core.PipelineRun` missing `RowsRejected`/`UnmappedQueues`/`WatermarkAgeMinutes` | Re-run `bp-sql-layer/scripts/11_pipeline_ops.sql` and `13_api_model_views.sql` — both are idempotent (`IF COL_LENGTH(...) IS NULL` guards the `ALTER TABLE`s). |

## Integration notes for other workers

- **nginx `/api` proxy** (`deploy/**`): proxy `/api/*` to this service's
  Cloud Run URL (or `http://api:8080` in a docker-compose/sidecar setup),
  preserving the `Authorization` header. Required env vars at deploy time:
  `DATA_SOURCE=sql`, `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`,
  `SQL_PASSWORD`, `AUTH_MODE=entra`, `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE`,
  `CORS_ORIGIN` (the SPA's origin), `NODE_ENV=production`.
- **`shared/auth-mappings.mjs`**: already the single source of truth — the
  SPA (`src/auth/entra-provider.ts`) imports this file directly rather than
  keeping its own copy of `GROUP_ROLE_MAPPINGS`/`mapClaimsToUser`, so there
  is no longer a hand-kept duplicate on either side to drift.
