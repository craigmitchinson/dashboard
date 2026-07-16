# ingest/ — Blue Prism work queue CSV adapters

Two scripts live here. Both write the IDENTICAL 16-column CSV contract
(`raw.WorkQueueItem` / `BPAWorkQueueItem`, see `ARCHITECTURE.md` at the repo
root and `bp-sql-layer/scripts/10_bulk_load_csv.sql`):

```
ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate,
Worktime, ExceptionDate, ExceptionReason, QueueName
```

Neither script replaces the other — they are alternative front doors onto
the same contract, for teams with different access to the Blue Prism
estate. `bp-sql-layer/Runbook.docx` covers the wider SQL pipeline in more
detail; this file exists because that runbook is a binary `.docx` and this
side-by-side, plain-text comparison is easier to keep next to the code it
describes.

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

Run it directly: `python ingest/elastic_to_csv.py`.

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
| `BP_STATE_FILE` | Path to the JSON watermark state file | `./bp_api_watermark.json` | No |
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
