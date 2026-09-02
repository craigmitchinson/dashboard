# ingest/ — Blue Prism work queue CSV adapters + Cloud SQL loader

Six files live here:

| File | Role |
| --- | --- |
| `elastic_to_csv.py` | Adapter (preferred): Elastic -> CSV |
| `bp_api_to_csv.py` | Adapter (alternative): Blue Prism Web API -> CSV |
| `sqlconn.py` | Shared, OPTIONAL Cloud SQL for SQL Server connection + watermark helpers (lazy `pyodbc` import — see below) |
| `load_to_sql.py` | Loads a CSV into Cloud SQL for SQL Server (`raw.WorkQueueItem`, batched) and runs `core.usp_RunPull` — the Cloud-SQL-viable replacement for `bp-sql-layer/scripts/10_bulk_load_csv.sql`'s server-local `BULK INSERT` (not viable against Cloud SQL — see that script's own header comment) |
| `run_pipeline.py` | Orchestrates one full pull: adapter -> `load_to_sql.py`, with an in-flight-run overlap guard. This is what `Dockerfile`'s `ENTRYPOINT` runs |
| `Dockerfile` | The Cloud Run Job image: `python:3.12-slim` + the Microsoft ODBC Driver 18 for SQL Server + this directory |

Both adapters write the IDENTICAL 16-column CSV contract
(`raw.WorkQueueItem` / `BPAWorkQueueItem`, see `ARCHITECTURE.md` at the repo
root and `bp-sql-layer/scripts/10_bulk_load_csv.sql`):

```
ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate,
Worktime, ExceptionDate, ExceptionReason, QueueName
```

Neither adapter replaces the other — they are alternative front doors onto
the same contract, for teams with different access to the Blue Prism
estate. `bp-sql-layer/Runbook.docx` covers the wider SQL pipeline in more
detail; this file exists because that runbook is a binary `.docx` and this
side-by-side, plain-text comparison is easier to keep next to the code it
describes.

## Two ways to run this: on-prem/self-managed SQL Server, vs Cloud SQL

- **On-prem / self-managed SQL Server** (the server process can see a local
  disk or network share): either adapter -> edit `bp-sql-layer/scripts/
  10_bulk_load_csv.sql`'s `@File` path -> run that script (it `BULK INSERT`s
  the CSV and calls `core.usp_RunPull` for you). Nothing below applies; you
  don't need `sqlconn.py`/`load_to_sql.py`/`run_pipeline.py`/`Dockerfile` at
  all for this path.
- **Cloud SQL for SQL Server** (Cloud Run Job, scheduled): `run_pipeline.py`
  (via `Dockerfile`'s `ENTRYPOINT`) runs the chosen adapter, then
  `load_to_sql.py`, which loads the CSV into Cloud SQL itself over the ODBC
  driver rather than asking the SQL engine to `BULK INSERT` a path it can't
  see — see `load_to_sql.py`'s own docstring for exactly why `BULK INSERT`
  isn't viable against Cloud SQL, and `deploy/cloudsql.md` for the full
  provisioning/connectivity story (private IP only, no IAM database auth,
  Direct VPC egress from Cloud Run — all verified there with citations).

## Which one do I use?

**`elastic_to_csv.py` is the default/preferred adapter**: pulling from
Elastic has no further impact on the Blue Prism production database, since
it only ever reads from a store BP already ships queue activity into via
Data Gateways. **`bp_api_to_csv.py` is the documented alternative** — fully
supported and tested — for estates that don't ship activity to Elastic, or
that specifically need authoritative current item state; it pulls directly
against the live BP environment, so it does add load to the BP estate
itself.

| | `elastic_to_csv.py` (preferred) | `bp_api_to_csv.py` (alternative) |
|---|---|---|
| Talks to | Elastic (Kibana-backed store BP ships queue logs into) | Blue Prism 7.x Web API directly, via OAuth2 against the BP Authentication Server (Hub) |
| Impact on BP production DB | None — reads only from Elastic | Direct load on the live BP environment |
| Use when | Default choice: your estate ships Blue Prism activity to Elastic via Data Gateways | Your estate doesn't ship activity to Elastic, or you need authoritative current item state and don't want a Data Gateways dependency in the way |
| Also use when | Elastic holds a *longer* history than the live BP database (BP purges completed items after a retention window; Elastic doesn't) | You want an ongoing incremental delta feed of authoritative current state and don't need deep history from this path |
| History depth | Whatever the Elastic index retains | Whatever the BP database itself still has (usually shorter — see purge/retention note above); retention is limited by BP's purge policy |
| Pull style | Full range query each run (`FROM_DATE`/`TO_DATE`), no built-in watermark state — depends on Data Gateways event-stream shipping, which must be configured and can lag or drop events | Watermark-based delta: JSON state file tracks the max `LastUpdatedDate` seen per queue, re-pulling a configurable overlap window every run; REST paging is impractical for large backfills |
| Auth | API key or basic auth against Elastic | OAuth2 client-credentials against the BP Auth Server, with automatic token refresh mid-run |
| Dependencies | Python stdlib only (`urllib.request`) | Python stdlib only (`urllib.request`) |
| Worktime unit caveat | `BP_WORKTIME_UNIT` default is `"s"` — verify against what your Elastic index actually stores | `BP_WORKTIME_UNIT` default is `"ms"` — verify against your BP API's Worktime field |

Both are safe to run against a warm target repeatedly: `core.usp_MergeFact`
(`scripts/06_proc_merge_fact.sql`) only overwrites a fact row when the
incoming `LastUpdatedDate` is newer than what's already stored, and never
deletes. Re-pulling the same rows twice is a no-op, not a corruption risk.

## Pipeline (both adapters feed the same place)

**On-prem / self-managed SQL Server:**

```
adapter writes CSV
        │
        ▼
scripts/10_bulk_load_csv.sql   (BULK INSERT into raw.WorkQueueItem, stamp
                                 provenance, then EXEC core.usp_RunPull)
        │
        ▼
scripts/09_proc_run_pull.sql   (core.usp_RunPull: runs staging load then
                                 the merge, in order, and reports counts)
        │
        ├─▶ scripts/05_proc_load_staging.sql  (staging.usp_LoadStaging: types
        │                                      and cleans raw -> staging)
        │
        └─▶ scripts/06_proc_merge_fact.sql    (core.usp_MergeFact: staging ->
                                                core.FactWorkItem, exception
                                                classification, ID + newer-
                                                LastUpdatedDate overwrite rule)
```

To point `10_bulk_load_csv.sql` at either adapter's output, edit the
`@File` variable near the top of that script to the adapter's `--output` /
`OUT_CSV` / `BP_OUTPUT_CSV` path, then run the whole script.

**Cloud SQL for SQL Server** (`run_pipeline.py`, run by `Dockerfile`'s
`ENTRYPOINT` as a Cloud Run Job):

```
run_pipeline.py
        │  in-flight-run guard first (core.usp_GetInFlightRun) — exits
        │  cleanly (not a failure) if another run is already going
        ▼
adapter (elastic_to_csv.py, or bp_api_to_csv.py when BP_ADAPTER=api)
        │  writes CSV_PATH; reads/writes its watermark via
        │  core.IngestWatermark when SQL_* env vars are set, else a
        │  local JSON file / plain FROM_DATE-TO_DATE bound, same as today
        ▼
load_to_sql.py's load_and_merge()
        │  TRUNCATE + batch-load raw.WorkQueueItem (fast_executemany)
        ▼
scripts/09_proc_run_pull.sql   (same core.usp_RunPull as the on-prem path —
                                 staging.usp_LoadStaging -> core.usp_MergeFact,
                                 completely ingest-path-agnostic)
        │
        ▼
core.PipelineRun row written (RowsStaged, RowsMerged, MaxLastUpdated,
Status) — see scripts/11_pipeline_ops.sql; this is the production data
API's GET /api/health source for lastPullAt
```

See `deploy/cloudsql.md` for the full production architecture/provisioning
story and `deploy/gcp.md`'s "first real data pull" runbook for how to
validate a first run end to end.

## `elastic_to_csv.py` — environment variables

| Name | Purpose | Default | Required? |
|---|---|---|---|
| `ELASTIC_URL` | Elastic base URL, e.g. `https://elastic.internal:9200` | — | Yes |
| `ELASTIC_INDEX` | Index/alias pattern, e.g. `bp-workqueueitems-*` | — | Yes |
| `ELASTIC_API_KEY` | Base64 ApiKey value (one of key/basic) | — | No |
| `ELASTIC_USER` / `ELASTIC_PASSWORD` | Basic auth alternative to the API key | — | No |
| `ELASTIC_VERIFY_TLS` | `"false"` to skip TLS certificate verification | `true` | No |
| `FROM_DATE` | ISO date, filter `lastupdateddate >=` | — | No |
| `TO_DATE` | ISO date, filter `lastupdateddate <=` | — | No |
| `FIELD_MAP_JSON` | JSON overriding the default Elastic-field -> CSV-column map | — | No |
| `OUT_CSV` | Output CSV path | `./workqueueitems.csv` | No |
| `PAGE_SIZE` | `search_after` page size | `5000` | No |
| `BP_WORKTIME_UNIT` | Unit of the Elastic index's worktime field: `ms` or `s`. Converted to whole seconds before writing — `scripts/08_report_views.sql`'s cost views hard-assume Worktime is in seconds. **Default differs from bp_api_to_csv.py's `BP_WORKTIME_UNIT`** (`s` here vs `ms` there) because this script's existing behavior already assumed seconds — verify which unit your Elastic index actually stores before relying on the default. | `s` | No |
| `ELASTIC_WATERMARK_OVERLAP_HOURS` | Only consulted when SQL-backed watermark storage is active (all of `SQL_SERVER`/`SQL_DATABASE`/`SQL_USER`/`SQL_PASSWORD` set — see `sqlconn.py`) AND `FROM_DATE` is left unset: hours to re-pull behind `core.IngestWatermark`'s stored value every run, same purpose as `bp_api_to_csv.py`'s `WATERMARK_OVERLAP_HOURS`. An explicit `FROM_DATE` always wins outright over the SQL watermark. | `24` | No |

Run it directly: `python ingest/elastic_to_csv.py`. With SQL_* env vars set,
it also becomes resumable across a stateless Cloud Run Job's restarts (see
`elastic_to_csv.py`'s own docstring, "SQL-BACKED WATERMARK") — without
them, it behaves exactly as it always has (`FROM_DATE`/`TO_DATE` only, no
persisted watermark).

## `bp_api_to_csv.py` — environment variables

| Name | Purpose | Default | Required? |
|---|---|---|---|
| `BP_AUTH_URL` | OAuth2 token endpoint on the BP Authentication Server (Hub) | — | Yes |
| `BP_CLIENT_ID` | OAuth2 client_credentials client id | — | Yes |
| `BP_CLIENT_SECRET` | OAuth2 client_credentials client secret | — | Yes |
| `BP_API_URL` | Base URL of the BP 7.x Web API | — | Yes |
| `BP_OAUTH_SCOPE` | OAuth2 `scope` value, if your Auth Server requires one | — (omit scope param) | No |
| `BP_QUEUE_NAMES` | Comma-separated queue names to pull; empty/unset = all queues | — (all queues) | No |
| `BP_PAGE_SIZE` | Items requested per page (skip/take pagination) | `1000` | No |
| `BP_STATE_FILE` | Path to the JSON watermark state file. **Ignored when SQL-backed watermark storage is active** (all of `SQL_SERVER`/`SQL_DATABASE`/`SQL_USER`/`SQL_PASSWORD` set — see `sqlconn.py`): `core.IngestWatermark` (one row per queue) is read/written instead, with the identical per-queue shape and overlap semantics — see `bp_api_to_csv.py`'s docstring, "SQL-BACKED WATERMARK". | `./bp_api_watermark.json` | No |
| `WATERMARK_OVERLAP_HOURS` | Hours to re-pull behind each queue's stored watermark | `24` | No |
| `BP_SINCE` | ISO-8601 date; first-run-only floor when no state file exists yet | — (pulls all history) | No |
| `BP_OUTPUT_CSV` | Output CSV path (overridden by `--output`) | `./workqueueitems_api.csv` | No |
| `BP_WORKTIME_UNIT` | Unit of the API's Worktime field: `ms` or `s`. Converted to whole seconds before writing — `scripts/08_report_views.sql`'s cost views (`vw_HubCostPerSecondByDate`, `vw_SpokeCostPerSecondByDate`, `TotalWorktimeSec`, `AvgWorktimeSec`, `ProductiveSeconds`, `WastedBotSeconds`) hard-assume Worktime is in seconds | `ms` | No |
| `BP_FIELD_MAP_JSON` | JSON overriding the default API-field -> CSV-column map | — | No |
| `BP_REQUEST_TIMEOUT` | Per-HTTP-request timeout, seconds | `30` | No |
| `BP_MAX_RETRIES` | Max retry attempts on HTTP 429/5xx before giving up | `5` | No |
| `BP_VERIFY_TLS` | `"false"` to skip TLS certificate verification | `true` | No |

Run it directly: `python ingest/bp_api_to_csv.py`, or preview with
`python ingest/bp_api_to_csv.py --dry-run`.

See the header comment in `bp_api_to_csv.py` for the full BP-API-field ->
CSV-column mapping table (every entry is marked `ASSUMPTION` — verify
against your instance's Swagger/OpenAPI doc before relying on it) and the
full explanation of the watermark/overlap delta logic.

## `sqlconn.py` — shared Cloud SQL connection env vars

Read by `load_to_sql.py`, `run_pipeline.py`, and by both adapters' optional
SQL-backed watermark paths. `pyodbc` is imported lazily, only when these are
set — see `sqlconn.py`'s docstring for why the "standard library only"
guarantee above still holds when they're not.

| Name | Purpose | Default | Required? |
|---|---|---|---|
| `SQL_SERVER` | Cloud SQL private IP (or on-prem host/IP) | — | Yes, to use any SQL-backed feature |
| `SQL_PORT` | TCP port | `1433` | No |
| `SQL_DATABASE` | Database name | — | Yes, to use any SQL-backed feature |
| `SQL_USER` | SQL Server login | — | Yes, to use any SQL-backed feature |
| `SQL_PASSWORD` | SQL Server login password (Secret Manager-backed in production) | — | Yes, to use any SQL-backed feature |
| `SQL_ENCRYPT` | `"yes"`/`"no"` — TDS encryption in transit | `yes` | No |
| `SQL_TRUST_SERVER_CERTIFICATE` | `"yes"`/`"no"` — `"no"` validates the server cert (see `SQL_CA_CERT_PATH`); `"yes"` disables validation, a conscious short-term trade-off only | `no` | No |
| `SQL_CA_CERT_PATH` | Path to the Cloud SQL instance's `server-ca.pem`, only meaningful when `SQL_TRUST_SERVER_CERTIFICATE=no` | — | No |
| `SQL_CONNECT_TIMEOUT_SECONDS` | Driver connection timeout | `30` | No |

All four of `SQL_SERVER`/`SQL_DATABASE`/`SQL_USER`/`SQL_PASSWORD` must be set
together — see `sqlconn.is_configured()`; a partial set is treated as "not
configured" with a loud warning, not a silent fallback.

## `load_to_sql.py` — the Cloud SQL loader

Reads a CSV, loads it into `raw.WorkQueueItem` in batches (`pyodbc`
`fast_executemany`), calls `core.usp_RunPull`, verifies row counts, and
writes a `core.PipelineRun` row. See its own docstring for: the pyodbc-vs-
pymssql driver choice and why, the resumability model (TRUNCATE-then-reload,
explicit about why that's sufficient), and why it targets `raw.WorkQueueItem`
rather than `staging.WorkQueueItem` directly.

| Name | Purpose | Default | Required? |
|---|---|---|---|
| `CSV_PATH` | CSV to load (overridden by `--csv`) | — | Yes (or `--csv`) |
| `LOAD_BATCH_SIZE` | Rows per INSERT batch / per transaction | `5000` | No |
| `PIPELINE_ADAPTER` | `'elastic'` or `'api'`, recorded on `core.PipelineRun.Adapter` (overridden by `--adapter`) | `api` | No |

Plus every `SQL_*` var above. Run standalone: `python load_to_sql.py --csv
path/to/file.csv --adapter elastic`, or dry-run config/CSV-shape validation
only with `--dry-run` (no SQL connection attempted).

## `run_pipeline.py` — the orchestrator (Cloud Run Job entrypoint)

Runs the in-flight-run overlap guard, then the chosen adapter, then
`load_to_sql.py`'s `load_and_merge()`. This is what `Dockerfile`'s
`ENTRYPOINT` runs every scheduled pull.

| Name | Purpose | Default | Required? |
|---|---|---|---|
| `BP_ADAPTER` | `'elastic'` or `'api'` — which adapter to run | `elastic` | No |
| `CSV_PATH` | Where the adapter writes and the loader reads from — this script sets the adapter's own `OUT_CSV`/`BP_OUTPUT_CSV` to this value | `./workqueueitems.csv` | No |
| `IN_FLIGHT_STALE_MINUTES` | A `Status='running'` `core.PipelineRun` row older than this is presumed crashed, not blocking | `30` | No |
| `LOAD_BATCH_SIZE` | Passed through to `load_to_sql.py` | `5000` | No |

Plus every env var the chosen adapter needs, and every `SQL_*` var (required
unless `--dry-run`). Exit codes: `0` success or deliberate skip (another run
in flight), `1` config error, `2` adapter subprocess failed, `3` CSV/SQL
error from `load_to_sql.py`. Structured JSON logs, one object per line, to
stdout.

## `Dockerfile` — the Cloud Run Job image

`python:3.12-slim` + the Microsoft ODBC Driver 18 for SQL Server (installed
via Microsoft's own `packages.microsoft.com` apt repository — see the
Dockerfile's comments for the exact, cited steps) + this directory,
non-root, `ENTRYPOINT ["python", "run_pipeline.py"]`. See
`deploy/cloudsql.md` and `deploy/scripts/06_deploy_ingest_job.sh` for how
it's built and deployed.

## Scheduling examples

### `elastic_to_csv.py`

**Windows Task Scheduler** (daily at 02:00, one-liner via `schtasks`):
```
schtasks /Create /SC DAILY /ST 02:00 /TN "BP-Elastic-Pull" /TR "python C:\dashboard\bp-sql-layer\ingest\elastic_to_csv.py"
```

**cron** (daily at 02:00):
```
0 2 * * * cd /opt/dashboard/bp-sql-layer && ELASTIC_URL=https://elastic.internal:9200 ELASTIC_INDEX=bp-workqueueitems-* python3 ingest/elastic_to_csv.py >> /var/log/bp-elastic-pull.log 2>&1
```

**Google Cloud Scheduler** (daily at 02:00, triggering an HTTP endpoint that runs the script, e.g. a Cloud Run job):
```
gcloud scheduler jobs create http bp-elastic-pull --schedule="0 2 * * *" --uri="https://REGION-PROJECT.cloudfunctions.net/bp-elastic-pull" --http-method=POST
```

### `bp_api_to_csv.py`

**Windows Task Scheduler** (every 15 minutes, incremental delta):
```
schtasks /Create /SC MINUTE /MO 15 /TN "BP-API-Pull" /TR "python C:\dashboard\bp-sql-layer\ingest\bp_api_to_csv.py"
```

**cron** (every 15 minutes):
```
*/15 * * * * cd /opt/dashboard/bp-sql-layer && BP_AUTH_URL=https://hub.corp.example/connect/token BP_API_URL=https://bpserver.corp.example/api BP_CLIENT_ID=svc BP_CLIENT_SECRET=*** python3 ingest/bp_api_to_csv.py >> /var/log/bp-api-pull.log 2>&1
```

**Google Cloud Scheduler** (every 15 minutes, triggering an HTTP endpoint that runs the script, e.g. a Cloud Run job):
```
gcloud scheduler jobs create http bp-api-pull --schedule="*/15 * * * *" --uri="https://REGION-PROJECT.cloudfunctions.net/bp-api-pull" --http-method=POST
```

Both adapters are safe to schedule frequently — `elastic_to_csv.py` via a
narrow `FROM_DATE`/`TO_DATE` window per run, `bp_api_to_csv.py` natively via
its own watermark/overlap delta logic — because the merge step downstream
never overwrites a row with stale data and never deletes.

> **Note:** The two "Google Cloud Scheduler" examples above illustrate
> scheduling an adapter script alone, generically, against an arbitrary HTTP
> endpoint. The actual, verified production pattern this repo uses —
> Cloud Scheduler triggering a Cloud Run **Job** running `run_pipeline.py`
> (adapter + `load_to_sql.py` + `core.usp_RunPull`, end to end) via the
> Cloud Run Admin API's `:run` method — is documented precisely in
> `deploy/cloudsql.md` §6 and scripted in `deploy/scripts/06_deploy_ingest_job.sh`
> / `07_scheduler.sh`. Use that path for Cloud SQL for SQL Server, not a bare
> Cloud Function calling the adapter alone (which has nowhere to load the
> CSV into on Cloud SQL — see `load_to_sql.py`'s docstring).
