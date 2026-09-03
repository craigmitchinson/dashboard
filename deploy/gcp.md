# Deploying to GCP

The single entry point for deploying this dashboard to GCP, from the static
demo through to the production data pipeline. `deploy/cloudsql.md` is the
detailed Cloud SQL for SQL Server reference this file points into for the
production path; `bp-sql-layer/ingest/README.md` is the adapter/loader env
var reference.

## 1. Static demo (mock or baked data) — Cloud Run + nginx

Fastest path; what the Dockerfile at the repo root builds. The dataset is baked
into the image at build time (`/data/*.json`), so the container is fully
self-contained.

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT

# build + deploy in one step from the repo root
gcloud run deploy bp-dashboard \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated        # or omit and put IAP/IAM in front

# refresh the data: replace data/mock/BPAWorkQueueItem.csv with a new export
# (same schema) and redeploy — the image bake re-runs the pipeline.
```

Lock it down for internal use: deploy without `--allow-unauthenticated` and
grant `roles/run.invoker` to your Google Workspace group, or front it with a
Load Balancer + IAP.

## 2. Production (live warehouse) — architecture

Five services, one Cloud SQL instance:

```
Cloud Scheduler ──▶ Cloud Run JOB: bp-ingest-pull
                     (elastic_to_csv.py or bp_api_to_csv.py
                      -> load_to_sql.py -> core.usp_RunPull)
                                   │  Direct VPC egress, private IP only
                                   ▼
                     Cloud SQL for SQL Server — bp-sql-layer schemas & views
                     (raw -> staging -> core -> report; core.PipelineRun /
                      core.IngestWatermark for pipeline observability)
                                   │  same VPC, Direct VPC egress, private IP
                                   ▼
                    Cloud Run SERVICE: bp-api (server/Dockerfile)
                    GET/PUT /api/model, /api/reference, /api/health —
                    AUTH_MODE=entra validates a Bearer JWT per request
                    (server/src/auth/entra.ts) against Secret Manager-backed
                    SQL_PASSWORD
                                   │
                     ┌─────────────┴──────────────────────────────┐
                     │  TWO topologies — pick one, see §5          │
                     │                                             │
        (default)    │  nginx-proxy: Cloud Run SERVICE bp-dashboard│
                      │  (root Dockerfile) — its own nginx reverse- │
                      │  proxies /api/* to bp-api's *.run.app URL,  │
                      │  same-origin from the browser's perspective │
                      │                                             │
        (production)  │  Load Balancer: one external HTTPS LB, two  │
                      │  Serverless NEG backends (bp-dashboard +    │
                      │  bp-api), path-routed on one domain — both  │
                      │  services' own *.run.app URLs stop accepting│
                      │  public traffic (--ingress=internal-and-    │
                      │  cloud-load-balancing)                      │
                     └─────────────┬──────────────────────────────┘
                                   ▼
                          the dashboard's users (browser)

        Any BI tool (external) → report.vw_* views directly, bypassing bp-api
        (on-prem gateway, or a temporary public IP + authorized network)
```

See `deploy/cloudsql.md` for the full text diagram of everything up to and
including Cloud SQL, every architectural decision's verified rationale (why
private IP, why this edition/tier, why this connectivity pattern), and the
hardening notes deferred out of the provisioning scripts. This file picks up
from `bp-api` onward — see §5 for the two topologies in full, §6 for the
env var matrix, and §7 for Entra ID app registration.

## 3. Order of operations for a first production deploy

1. **Provision Cloud SQL for SQL Server + the warehouse schema.** Run
   `deploy/scripts/01_enable_apis.sh` through `05_bootstrap_schema.sh` in
   order (copy `deploy/scripts/env.sh.example` to `env.sh` and fill it in
   first). This creates the instance, the `BPAnalytics` database, the
   pipeline's SQL login, and runs `bp-sql-layer/scripts/01` through `12`
   (`10_bulk_load_csv.sql` is skipped — see its own header comment on why
   it doesn't apply to Cloud SQL). `07_seed_reference.sql` carries the
   estate config (spokes, grade rate card, VDI ownership) — edit
   `data/reference/reference.json` and regenerate that script via the
   Administration panel's "Download SQL sync script" (see `PLAYBOOK.md`
   section 4) before or after bootstrap, either order works since it's
   safe to re-run.
2. **Deploy the ingest job.** `deploy/scripts/06_deploy_ingest_job.sh`
   builds `bp-sql-layer/ingest/Dockerfile` and creates/updates the
   `bp-ingest-pull` Cloud Run Job. Test it once manually
   (`gcloud run jobs execute bp-ingest-pull --region=... --wait`) before
   scheduling it — see §4 below.
3. **Schedule it.** `deploy/scripts/07_scheduler.sh` creates the Cloud
   Scheduler trigger (default: every 15 minutes — tune
   `INGEST_SCHEDULE`/`env.sh` per PLAYBOOK.md section 7's guidance, and
   confirm your adapter's own overlap-window settings, e.g.
   `WATERMARK_OVERLAP_HOURS` / `ELASTIC_WATERMARK_OVERLAP_HOURS`, are wide
   enough for that cadence).
4. **Data API.** `deploy/scripts/08_deploy_api.sh` builds `server/Dockerfile`
   and creates/updates the `bp-api` Cloud Run service — Direct VPC egress
   onto the same VPC/subnet the ingest job uses, `AUTH_MODE=entra`, and the
   same `SQL_PASSWORD` secret. Fill in `ENTRA_TENANT_ID`/`ENTRA_AUDIENCE` in
   `env.sh` first — see §7's app registration steps. Smoke-test with
   `curl $(gcloud run services describe bp-api --region=$REGION
   --format='value(status.url)')/api/health` — no auth required (see
   `server/README.md`'s Endpoints section).
5. **Frontend.** Pick a topology (see §5) and run either
   `deploy/scripts/09_deploy_frontend.sh` (default — same-origin nginx
   proxy, one more `gcloud run deploy`) or
   `deploy/scripts/10_deploy_loadbalancer.sh` (production — external HTTPS
   Load Balancer in front of both services, needs a domain you control).
   Either way this builds the root Dockerfile with `VITE_API_URL=/` (see §5
   for why that exact value, not a full URL or empty string) plus whichever
   `VITE_ENTRA_*` values `env.sh` carries.
6. **Any BI tool** (optional, external consumer): connect to the
   `report.vw_*` views via the on-prem gateway, or a temporary public IP +
   authorized network on the Cloud SQL instance (see `deploy/cloudsql.md`
   §5's connectivity options) — set `MonthLabel`'s "Sort by" = `MonthSortKey`
   once (see the Data model page's build notes in-app).

## 4. First real data pull — runbook

Run this after step 2 above, before scheduling (step 3):

1. **Dry-run the pipeline config first, with no network/SQL calls at all**:
   ```bash
   cd bp-sql-layer/ingest
   BP_ADAPTER=elastic ELASTIC_URL=... ELASTIC_INDEX=... \
     SQL_SERVER=... SQL_DATABASE=BPAnalytics SQL_USER=... SQL_PASSWORD=... \
     python run_pipeline.py --dry-run
   ```
   This validates env var presence and the CSV-shape contract without
   touching Elastic/the BP API or Cloud SQL — confirm it prints a clean
   `pipeline_dry_run_complete` event (see `run_pipeline.py`'s structured
   JSON log output) before proceeding.
2. **Run the Cloud Run Job once manually, bounded**: set a narrow
   `FROM_DATE`/`TO_DATE` (Elastic adapter) or `BP_SINCE` (API adapter) —
   don't pull full history through either adapter on the first try (see
   `PLAYBOOK.md` section 12 on backfill: history should come from a bulk
   export/direct DB query into `raw.WorkQueueItem`, not the REST API) —
   then `gcloud run jobs execute bp-ingest-pull --region=... --wait` and
   watch its logs for the `pipeline_success` JSON event.
3. **Check `core.PipelineRun`** (via `sqlcmd` through the Cloud SQL Auth
   Proxy, same as bootstrap): `SELECT TOP 10 * FROM core.PipelineRun ORDER
   BY StartedAt DESC;` — confirm `Status='success'`, sane `RowsStaged`/
   `RowsMerged`/`MaxLastUpdated` values, and no `Error` text.
4. **Check for unmapped queues**: `core.usp_RunPull`'s own `PRINT`/result-
   set output (captured in the Cloud Run Job's logs) flags any queue
   present in the pulled data but absent from `core.RefQueueMap` — add the
   mapping via the Administration panel (see `PLAYBOOK.md` section 9) and
   re-sync (`07_seed_reference.sql`) before that queue's activity will
   appear anywhere downstream.
5. **Reconcile row counts**: source CSV rows vs. `staging.WorkQueueItem`'s
   count vs. the net new rows in `core.FactWorkItem` — all three are on the
   `core.PipelineRun` row from step 3.
6. **Only once that's clean**, widen the pull window to your real desired
   ongoing delta, remove any temporary `FROM_DATE`/`TO_DATE`/`BP_SINCE`
   override you set for the bounded first run, redeploy the job
   (`06_deploy_ingest_job.sh`) with the final env vars, and schedule it
   (`07_scheduler.sh`).

## 5. Two topologies for `bp-api` + `bp-dashboard`

Both put the API behind `AUTH_MODE=entra` (a Bearer JWT required on every
request — see `server/src/auth/middleware.ts`); they differ in how the
**network** is shaped around that.

### 5a. nginx-proxy (default — `09_deploy_frontend.sh`)

`bp-dashboard`'s own nginx (`deploy/nginx.conf.template`) reverse-proxies
`/api/*` to `bp-api`'s public `*.run.app` URL at request time (an envsubst'd
`API_UPSTREAM` env var — see that file's header comment for the full
mechanism, including why a `resolver` directive and a `set $api_upstream`
variable are both needed for this to work at all). `bp-api` is deployed
`--allow-unauthenticated` at the network layer — its own `*.run.app` URL is
technically reachable directly, bypassing the proxy — but every request
still needs a valid Entra JWT to get past `AUTH_MODE=entra`, so this is
"exposed at the network layer, closed at the application layer."

**Choose this when**: you want the fewest moving parts (one `gcloud run
deploy` per service, no domain, no managed certificate, no Load Balancer
resources to reason about) and are comfortable with the API's network
boundary being enforced by the application (Entra JWT validation) rather
than the platform.

### 5b. Load Balancer (production recommendation — `10_deploy_loadbalancer.sh`)

One external HTTPS Load Balancer, two Serverless NEG backends (`bp-dashboard`
and `bp-api`), one URL map path-routing `/api/*` to the API backend and
everything else to the SPA backend, one domain (`LB_DOMAIN` in `env.sh`), one
Google-managed TLS certificate. Both Cloud Run services are set to
`--ingress=internal-and-cloud-load-balancing` — their own `*.run.app` URLs
stop accepting public traffic entirely, a **platform-level** boundary on top
of (not instead of) the same `AUTH_MODE=entra` check.

**Choose this when**: you want a single domain for the whole app, want the
option to add Cloud Armor (WAF/rate-limiting/geo-blocking) or
Identity-Aware Proxy later without touching either Cloud Run service, or
want the API's network exposure to be a platform guarantee rather than an
application-level one alone. Trade-off: materially more resources to
provision and reason about (static IP, two NEGs, two backend services, a URL
map, a managed cert that stays `PROVISIONING` until DNS is live — see that
script's own final output for the exact sequencing), and requires a domain
you control.

Nothing about `bp-api` itself differs between the two — `08_deploy_api.sh`
is shared; only which of 09/10 you run afterward changes.

## 6. Env var matrix

**Build-time** (baked into a JS bundle at `docker build`, cannot change
without a rebuild):

| Var | Service | Set by | Notes |
| --- | --- | --- | --- |
| `VITE_API_URL` | `bp-dashboard` | 09/10 (`"/"`), or unset for static demo | See the "Same-origin topology" note below — `"/"`, not a full URL or `""`, is the value that yields same-origin `api` mode. |
| `VITE_DATA_URL` | `bp-dashboard` | unset (default) | Legacy/independent of `VITE_API_URL` — only affects the LOCAL-mode fallback fetch URL (`src/data/client.ts`'s `LOCAL_DATA_URL`); irrelevant once `VITE_API_URL` puts the app in `api` mode. |
| `VITE_AUTH_PROVIDER` | `bp-dashboard` | `env.sh` (`entra` in prod) | `dev` or `entra` — see `src/auth/provider.ts`. |
| `VITE_ENTRA_TENANT_ID` | `bp-dashboard` | `env.sh` | Same tenant as `ENTRA_TENANT_ID` below. |
| `VITE_ENTRA_CLIENT_ID` | `bp-dashboard` | `env.sh` | The SPA's **own** app registration — distinct from the API's (see §7). |
| `VITE_ENTRA_REDIRECT_URI` | `bp-dashboard` | left unset by 09 (falls back to `window.location.origin`); set explicitly by 10 (`https://$LB_DOMAIN/`) | Must exactly match an allowed redirect URI on the SPA's app registration. |
| `VITE_ENTRA_SCOPES` | `bp-dashboard` | `env.sh` (default `openid profile email`) | The sign-in scopes only; `offline_access` is appended automatically. The API's own scope is a separate setting — see `VITE_ENTRA_API_SCOPE` and §7. |
| `VITE_ENTRA_API_SCOPE` | `bp-dashboard` | `env.sh` (optional — defaults to `api://<client-id>/.default` once `VITE_ENTRA_CLIENT_ID` is set) | The scope the SPA requests an access token for; `src/data/client.ts` attaches that token as a `Bearer` header on every `/api/*` call. See §7. |

**Runtime** (read from the environment at container start; changing these
needs a new revision, not a rebuild):

| Var | Service | Set by | Notes |
| --- | --- | --- | --- |
| `API_UPSTREAM` | `bp-dashboard` | 09 (the API's current URL); unset by 10 (LB does the routing instead) | Empty = static/local mode's `/api/` 404 stub. |
| `PORT` | both | Cloud Run (always 8080 here) | Both images already default `ENV PORT=8080`. |
| `SQL_SERVER`/`SQL_PORT`/`SQL_DATABASE`/`SQL_USER` | `bp-api` | 08 (private IP, `BPAnalytics`, `$SQL_APP_USER`) | Same login the ingest job uses by default — see `deploy/cloudsql.md` §7's hardening note on splitting this. |
| `SQL_PASSWORD` | `bp-api` | Secret Manager, via `--set-secrets` | Never set as a plain env var. |
| `SQL_ENCRYPT`/`SQL_TRUST_CERT` | `bp-api` | 08 (`true`/`false`) | See `deploy/cloudsql.md` §7's TLS validation note — applies here too. |
| `AUTH_MODE` | `bp-api` | `env.sh` (`entra` in prod — `dev`/`none` refuse to start with `NODE_ENV=production`) | See `server/src/config.ts`. |
| `ENTRA_TENANT_ID`/`ENTRA_AUDIENCE` | `bp-api` | `env.sh` | See §7. |
| `CORS_ORIGIN` | `bp-api` | unset by 08; patched to the frontend's own URL by 09/10 right after THEIR deploy | Chicken-and-egg — the API is deployed before its origin exists. Traffic through 09/10's routing is same-origin either way; this is defense-in-depth (server/README.md's own integration note lists it as required), not load-bearing for normal use. |
| `LOG_LEVEL` | `bp-api` | `env.sh` (`info`) | |
| `DATA_SOURCE`/`FIXTURES_DIR` | `bp-api` | 08 (`sql`, unset) | `fixtures` mode is for §10's local/CI path, not this deployment. |

## 7. Entra ID app registration

Two app registrations, not one — the SPA (public client, PKCE) and the API
(the resource the SPA's tokens are issued for):

1. **API app registration** (create first — the SPA's registration needs to
   reference it):
   - **Expose an API** → add a scope (e.g. `access_as_user`) — this is what
     gives the API an Application ID URI (`api://<api-client-id>`), the
     value `ENTRA_AUDIENCE` should be set to.
   - **App roles** (optional, only if you want role assignment enforced by
     Entra itself rather than purely by `GROUP_ROLE_MAPPINGS` — see the next
     bullet): not required, the group-mapping approach below doesn't need
     this.
   - No redirect URI needed on this registration — it's a resource, not a
     client.
2. **SPA app registration**:
   - **Authentication** → platform **Single-page application** → redirect
     URIs: the exact origin(s) 09/10 print at the end of their run (no
     trailing slash for 09's `window.location.origin` fallback; `https://
     $LB_DOMAIN/` — WITH the trailing slash, matching what 10 actually
     passes as `VITE_ENTRA_REDIRECT_URI` — for 10's topology).
   - **API permissions** → add the scope exposed by the API app registration
     in step 1.
   - **Token configuration** → add the `groups` claim (ID token) — this is
     what `src/auth/entra-provider.ts`'s `mapClaimsToUser()` and
     `server/src/auth/entra.ts`'s `mapClaimsToUser` (via
     `shared/auth-mappings.mjs`) both read. Group **names**, not just
     object-IDs, need to be emitted for the exact string matches in
     `GROUP_ROLE_MAPPINGS` (`SG-RPA-Admins`, `SG-RPA-IPI-Lead`, etc. — see
     `src/auth/entra-provider.ts`'s own comment) to resolve — check your
     tenant's groups-claim configuration options for "groups assigned to the
     application" vs. "all groups", and be aware of the "groups overage"
     case documented in that same file (a user in too many groups gets a
     `_claim_names` pointer instead of an inline list — resolving that needs
     a server-side Graph call this prototype doesn't perform).
   - Create the four security groups (`SG-RPA-Admins`, `SG-RPA-IPI-Lead`,
     `SG-RPA-RSK-Lead`, `SG-RPA-COM-Lead`, `SG-RPA-CLD-Lead`,
     `SG-RPA-HubMembers`, `SG-RPA-BusinessUsers`) in Entra ID / assign real
     users to them — see `src/auth/entra-provider.ts`'s
     `GROUP_ROLE_MAPPINGS` for the authoritative list.

**Real, working end to end**: `src/auth/entra-provider.ts` is a genuine
auth-code + PKCE implementation (native WebCrypto, no MSAL dependency), and
it requests two different tokens for two different purposes — the ID token
(who signed in, audience = the SPA's own client id) and a separate access
token scoped to `VITE_ENTRA_API_SCOPE` (defaults to `api://<api-client-id>/
.default` once `VITE_ENTRA_CLIENT_ID` is set; audience = `ENTRA_AUDIENCE` on
the server). `src/data/client.ts` attaches that access token as an
`Authorization: Bearer` header on every `/api/*` call and silently renews it
once on a 401 before giving up, so an expiring token doesn't force a manual
re-login mid-session. The one genuinely open item: if a signed-in user
belongs to more Entra groups than the tenant will list directly in a token
(the "groups overage" case), the app surfaces a clear error rather than
guessing at their role — resolving that needs a server-side Microsoft Graph
group lookup, which this prototype's client-side auth does not perform. See
`PLAYBOOK.md` section 10 for the full picture, including that caveat.

## 8. Rollback

Both `bp-api` and `bp-dashboard` are plain Cloud Run services — every deploy
creates a new **revision**; old revisions aren't deleted automatically.

- **Fast rollback (traffic only, no rebuild)**:
  ```bash
  gcloud run services list-revisions --service=bp-api --region=$REGION
  gcloud run services update-traffic bp-api --region=$REGION \
    --to-revisions=REVISION_NAME=100
  ```
  Same command shape for `bp-dashboard`. This is immediate — no build step —
  and is the right first move for "the new deploy broke something."
- **Ingest job**: `06_deploy_ingest_job.sh` re-run with an older
  `INGEST_IMAGE` tag rolls the job back the same way (Cloud Run Jobs execute
  the image current at `:run` time, not a pinned revision the way services
  are) — re-tag/re-push the previous image, or pin `INGEST_IMAGE` to a
  specific digest in `env.sh` rather than `:latest` if you want this to be a
  one-line revert.
- **Schema (`bp-sql-layer/scripts/`)**: none of `01`-`12` are written as
  down-migrations — see `bp-sql-layer/README.md` (if present) or each
  script's own header for whether a given change is additive-only.
  Reversing a schema change generally means writing and running the inverse
  DDL by hand, not re-running `05_bootstrap_schema.sh`.
- **Reference data** (`PUT /api/reference`): each write is versioned
  (`If-Match`/optimistic concurrency — see `src/data/client.ts`'s
  `putReferenceApi`) but there's no built-in history/undo endpoint in this
  API contract — keep `data/reference/reference.json`'s git history as the
  practical audit trail/rollback source until one exists.

## 9. Cost notes

Everything here is either Cloud Run (pay-per-use, scales to zero except
where `min-instances` says otherwise) or Cloud SQL (always-on, the one
guaranteed fixed cost):

- **Cloud SQL** is the dominant fixed cost regardless of topology or
  traffic — `env.sh.example`'s default `db-custom-4-16384` (4 vCPU/16GB,
  Enterprise edition, Standard database engine) runs whether or not anyone
  is using the dashboard. See `deploy/cloudsql.md` §3 for the per-core-hour
  pricing comparison across SQL Server database engine editions — right-size
  `SQL_TIER` down for a pilot/low-volume estate before assuming this figure.
- **`bp-api`'s `--min-instances=1`** (set deliberately in
  `08_deploy_api.sh` — see that script's comment on Direct VPC egress's own
  cold-start cost on top of a plain container cold start) is a small
  always-on cost, roughly one Cloud Run instance-hour's worth of CPU/memory
  around the clock, regardless of traffic. `bp-dashboard` stays at
  `--min-instances=0` (a static SPA container is cheap to cold-start) — only
  the API pays this trade-off.
- **`bp-ingest-pull`** (Cloud Run Job) only bills for its actual run
  duration on each scheduled trigger (every 15 minutes by default) — a job
  with a short, bounded runtime per pull is materially cheaper over a month
  than an always-on equivalent would be.
- **The Load Balancer topology (§5b)** adds: one global forwarding rule +
  static IP (a small fixed hourly charge whether or not it's in front of any
  traffic), two backend services/Serverless NEGs (no direct charge — you pay
  for the Cloud Run usage behind them, same as without a LB), and a
  Google-managed SSL certificate (no charge). The nginx-proxy topology (§5a)
  has no equivalent fixed line item, but every `/api/*` request pays for one
  extra Cloud Run instance-second on `bp-dashboard` (the nginx hop) it
  otherwise wouldn't.
- **Egress**: Direct VPC egress itself has no separate fixed charge beyond
  standard network egress pricing for the ingest job's own internet calls
  (Elastic/BP API) — see `deploy/cloudsql.md` §7's Cloud NAT note for the
  one scenario (`--vpc-egress=all-traffic`) that would change this.

## 10. Local end-to-end without GCP

Exercises the real API contract (`server/`) and the real SPA `api` mode
(`src/data/client.ts`) together, with no GCP project, Cloud SQL, or Entra
tenant involved:

```bash
# 0. (optional — public/data/views/ is already checked in, so this is only
#    needed after changing data/mock/BPAWorkQueueItem.csv or reference.json)
npm run data:build

# 1. API in fixture mode (DATA_SOURCE=fixtures — no SQL Server needed at
#    all). FIXTURES_DIR is relative to server/, so ../public/data/views is
#    exactly the directory step 0 (re)writes — see server/README.md's
#    "FIXTURE MODE" section for the full contract, including
#    FIXTURES_REFERENCE_PATH if your checkout is laid out differently.
#    AUTH_MODE=dev trusts a plain X-Dev-User header instead of validating a
#    real Entra JWT — refuses to start with NODE_ENV=production (see
#    server/src/config.ts), so this is dev/CI only.
cd server
npm ci
DATA_SOURCE=fixtures FIXTURES_DIR=../public/data/views AUTH_MODE=dev PORT=8080 npm run dev

# 2. SPA built/served against it — a second terminal, repo root:
cd ..
VITE_API_URL=http://localhost:8080 VITE_AUTH_PROVIDER=dev npm run dev
```

`VITE_API_URL=http://localhost:8080` here (a full URL, NOT `/`) is
deliberate and different from the same-origin `"/"` used in production
(§5/§6) — `npm run dev`'s Vite dev server and the API run as two genuinely
different origins/ports locally, with no nginx proxy between them, so
`src/data/client.ts`'s `API_BASE` needs the API's real origin to build
correct absolute URLs. Browser CORS therefore applies here even though it
doesn't in either GCP topology — set `CORS_ORIGIN=http://localhost:5173` (or
whatever port Vite prints) on the API process in step 1 if requests fail
with a CORS error.

This is also the fastest loop for testing a `src/**`/`server/**` change
without waiting on a Cloud Build round trip, and the path CI (see
`deploy/cloudbuild.yaml`'s test gates) exercises before any image is even
built.
