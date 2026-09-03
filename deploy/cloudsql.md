# Cloud SQL for SQL Server — provisioning and connectivity

The detailed reference behind `deploy/gcp.md`'s production path. Read this
once before running `deploy/scripts/01` through `07`; `deploy/gcp.md` is the
short version + the "first real data pull" runbook.

Every factual claim below marks **VERIFIED** with what was checked and
where, per this task's brief — nothing here is assumed.

## 1. Why this looks different from a Postgres/MySQL Cloud SQL deployment

Two load-bearing facts, both verified against Google's own current docs,
that shape every script in `deploy/scripts/`:

1. **No IAM database authentication for SQL Server.** VERIFIED
   (docs.cloud.google.com/sql/docs/sqlserver/iam-authentication): Cloud SQL
   for SQL Server supports IAM authentication for *instance and backup
   operations only* — not database logins. Postgres/MySQL support full IAM
   database auth (short-lived OAuth tokens instead of a password); SQL
   Server does not. Built-in username/password authentication is therefore
   the only practical login path for a service-account-driven pipeline here
   (short of standing up a customer-managed Active Directory domain for
   Windows-integrated auth, which is out of scope) — see `SQL_USER`/
   `SQL_PASSWORD` throughout, sourced from Secret Manager.
2. **No public-IP path from Cloud Run, and no Unix-socket proxy.** VERIFIED
   (docs.cloud.google.com/sql/docs/sqlserver/connect-instance-cloud-run):
   *"Cloud Run does not support connecting to Cloud SQL for SQL Server over
   public IP. Use private IP instead."* Unlike Postgres/MySQL (whose client
   libraries support connecting over a Unix domain socket Cloud Run injects
   at `/cloudsql/INSTANCE_CONNECTION_NAME`), SQL Server's wire protocol/ODBC
   driver stack has no such Unix-socket mode — the application connects
   over plain TCP, port 1433, straight to the instance's **private** IP
   address, requiring the Cloud Run Job to have **Direct VPC egress** (or a
   Serverless VPC Access connector) onto the same VPC.

Both facts are why `02_network.sh` provisions a VPC + Private Service
Access peering before anything else, why `03_create_instance.sh` creates
the instance with `--no-assign-ip`, and why `06_deploy_ingest_job.sh` wires
Direct VPC egress rather than the `--add-cloudsql-instances`-only pattern
that's sufficient for Postgres/MySQL.

## 2. Architecture (text diagram)

```
Cloud Scheduler (cron, e.g. */15 * * * *)
      │  POST .../jobs/bp-ingest-pull:run  (OAuth2, roles/run.invoker)
      ▼
Cloud Run JOB: bp-ingest-pull  (bp-sql-layer/ingest/Dockerfile)
      │  Direct VPC egress (private-ranges-only) ──────────┐
      │                                                     │
      ├─ elastic_to_csv.py OR bp_api_to_csv.py              │
      │    (public internet: Elastic / BP Auth+Web API)     │
      │    watermark: core.IngestWatermark when SQL          │
      │    configured, else a local JSON file                │
      │                                                     │
      ├─ load_to_sql.py                                     │
      │    TRUNCATE + batch-load raw.WorkQueueItem            │
      │    EXEC core.usp_RunPull                             │
      │    write core.PipelineRun                            │
      ▼                                                     ▼
                                          Cloud SQL for SQL Server
                                          (PRIVATE IP only, port 1433)
                                          BPAnalytics database:
                                            raw -> staging -> core -> report

                                                      │  report.vw_* views
                                                      ▼
                                    Cloud Run SERVICE: bp-api (server/Dockerfile)
                                    GET/PUT /api/model, /api/reference, /api/health
                                    (reads core.PipelineRun for lastPullAt)
                                                      │
                                                      ▼
                                    Cloud Run SERVICE: this dashboard SPA
                                    (VITE_API_URL="/" -> nginx proxies /api/ to
                                     bp-api, same-origin — see deploy/gcp.md §5)

                                    Any BI tool (external, direct on report.vw_*,
                                    via the on-prem gateway or a temporary
                                    public IP + authorized network)
```

Everything up to and including the "Cloud SQL for SQL Server" box is this
file's scope. `bp-api` and the dashboard SPA — deploying them, their
Cloud Run wiring, the two topology options, Entra ID auth — are
`deploy/gcp.md`'s §2/§5-§10 (that file's the entry point; this one is its
Cloud SQL-specific reference). `server/README.md` is `bp-api`'s own
contract (endpoints, env vars, fixture mode).

## 3. Cloud SQL edition/tier choice (VERIFIED)

- **Editions**: (`docs.cloud.google.com/sql/docs/sqlserver/editions-intro`,
  cross-checked against `learn.microsoft.com`'s SQL Server 2019/2022 edition
  pages) Cloud SQL's own **Enterprise** platform edition supports the SQL
  Server database engine editions Standard, Enterprise, Express and Web
  (2017 through 2025); Cloud SQL's **Enterprise Plus** platform edition
  supports only the SQL Server Enterprise database engine edition. Pricing
  is per-core-hour and differs sharply by SQL Server database engine
  edition: Enterprise ≈ $0.47/core-hr, Standard ≈ $0.13, Web ≈ $0.01134,
  Express ≈ $0. `env.sh.example` defaults to Cloud SQL platform edition
  `ENTERPRISE` running SQL Server database engine edition `Standard`
  (`SQLSERVER_2022_STANDARD`) — materially cheaper than Enterprise, and
  nothing in this pipeline needs an Enterprise-only database engine
  feature (see the next point).
- **Table partitioning is NOT Enterprise-only.** VERIFIED: Microsoft made
  table partitioning (and several other previously Enterprise-only engine
  features) available in the Standard, Web and Express editions starting
  SQL Server **2016 SP1** — every Cloud SQL for SQL Server version (2017
  onward) postdates that. `12_performance.sql`'s optional partitioning DDL
  therefore works on the Standard-edition default above; the one
  Enterprise-only nuance that survives is *parallel query execution across
  partitions*, not partitioning itself.
- **Storage ceiling**: VERIFIED (`docs.cloud.google.com/sql/docs/sqlserver/
  instance-settings`) — Cloud SQL for SQL Server instances scale storage
  automatically up to a **64 TB** maximum. That ceiling, not edition
  licensing, is the more binding long-range constraint at 50-100M+ rows.

## 4. Provisioning order (`deploy/scripts/`)

Run in order; every script is idempotent (safe to re-run).

| Script | Does |
| --- | --- |
| `01_enable_apis.sh` | Enables the GCP APIs this deployment touches. |
| `02_network.sh` | VPC + subnet + Private Service Access peering (private IP prerequisite — see §1). |
| `03_create_instance.sh` | Creates the Cloud SQL for SQL Server instance (private-IP-only), the `BPAnalytics` database, and the pipeline's own SQL login; both generated passwords land in Secret Manager. |
| `04_secrets.sh` | Prompts for the chosen adapter's own credential (Elastic API key, or the BP OAuth2 client secret) and stores it in Secret Manager; creates the ingest job's service account with least-privilege IAM (`roles/cloudsql.client` project-wide — needed only to use the Cloud SQL connection plumbing, not for DB login, see §1 — plus `roles/secretmanager.secretAccessor` scoped to exactly the secrets it needs). |
| `05_bootstrap_schema.sh` | Runs `bp-sql-layer/scripts/01` through `12` (skipping `10`, the on-prem-only alternative — see its own header comment) via `sqlcmd` through the Cloud SQL Auth Proxy. See §5 for the two connectivity options this implements/documents. |
| `06_deploy_ingest_job.sh` | Builds `bp-sql-layer/ingest/Dockerfile` via Cloud Build and creates/updates the `bp-ingest-pull` Cloud Run Job with Direct VPC egress, Cloud SQL wiring, and Secret Manager-backed env vars. |
| `07_scheduler.sh` | Creates the Cloud Scheduler job that triggers one Cloud Run Job execution on a cron schedule via the Cloud Run Admin API's `:run` method (see §6). |

Copy `deploy/scripts/env.sh.example` to `deploy/scripts/env.sh` and fill in
your project/region/naming before running any of them.

## 5. Running `sqlcmd` against Cloud SQL for SQL Server (VERIFIED options)

Both options were verified against `docs.cloud.google.com/sql/docs/
sqlserver/connect-auth-proxy` and `.../connection-options`:

- **Cloud SQL Auth Proxy (used by `05_bootstrap_schema.sh`, and Google's own
  recommended method — *"Using the Cloud SQL Auth Proxy is the recommended
  method for connecting to a Cloud SQL instance"*)**: works over public OR
  private IP; authenticates via your IAM/gcloud credentials rather than a
  network allowlist, and wraps the TDS connection in TLS itself. Because
  `03_create_instance.sh` creates the instance private-IP-only,
  `05_bootstrap_schema.sh` **temporarily** assigns a public IP purely so the
  Auth Proxy (run from Cloud Shell or a laptop with `gcloud` — no VPC
  peering needed for this one-off bootstrap step) can reach it, then removes
  the public IP again afterwards (see that script's `cleanup()` trap, which
  fires even on failure).
- **Direct connection + authorized networks**: `sqlcmd -S
  CLOUD_SQL_PUBLIC_IP_ADDR -U USERNAME`, after adding your machine's IP to
  the instance's authorized networks list. Simpler conceptually, but leaves
  a plaintext-IP-based allowlist to maintain and forget to revoke — not used
  by the scripts here, mentioned only as the alternative Google's own docs
  describe.
- **Bastion-VM alternative (never assign a public IP, not scripted)**: stand
  up a small Compute Engine VM on the same VPC/subnet `02_network.sh`
  created, install the Cloud SQL Auth Proxy + `mssql-tools18` there,
  `gcloud compute ssh --tunnel-through-iap` to it, and run the identical
  `sqlcmd` sequence against the instance's private IP directly. Prefer this
  if your organization's policy disallows a Cloud SQL instance ever holding
  a public IP, even briefly.

## 6. Cloud Run Job scheduling (VERIFIED)

Cloud Run **Jobs** (unlike **services**) have no HTTPS invocation URL of
their own. VERIFIED (`docs.cloud.google.com/sdk/gcloud/reference/scheduler/
jobs/create/http`): Cloud Scheduler triggers one via an HTTP target that
calls the Cloud Run **Admin API**'s `:run` method directly —
`https://run.googleapis.com/v2/projects/P/locations/R/jobs/J:run` — using
`--oauth-service-account-email` (an OAuth2 token, the flag Google's own
gcloud reference specifies for calling `*.googleapis.com` APIs, as distinct
from `--oidc-service-account-email` which targets a custom Cloud Run
*service* URL instead). The invoking service account needs `roles/
run.invoker` granted on that specific job (`07_scheduler.sh` does this with
`gcloud run jobs add-iam-policy-binding`, not a project-wide grant).

**Concurrency**: Cloud Run Jobs/Cloud Scheduler have no built-in "skip if
still running" semantics (unlike a Kubernetes CronJob's `concurrencyPolicy:
Forbid`). `06_deploy_ingest_job.sh` sets `--max-retries=0 --task-count=1
--parallelism=1` to avoid the platform ever attempting an overlapping retry
of its own accord, and the pipeline's real "never overlap pulls" guarantee
is application-level: `run_pipeline.py`'s in-flight check against
`core.PipelineRun` (via `core.usp_GetInFlightRun` — see
`bp-sql-layer/scripts/11_pipeline_ops.sql`), which exits cleanly (not a
failure) if another run is currently `Status='running'` and started less
than `IN_FLIGHT_STALE_MINUTES` ago.

## 7. Hardening notes deferred out of the scripts

- **Least-privilege SQL login**: `05_bootstrap_schema.sh` grants the
  pipeline's SQL login `db_owner` on `BPAnalytics` so it can run the full
  `01`-`12` DDL sequence *and* the steady-state `EXEC core.usp_RunPull` /
  `core.usp_GetInFlightRun` calls with one login. Once bootstrap is done,
  consider narrowing the **steady-state** ingest job's login to exactly:
  `INSERT`/`TRUNCATE` on `raw.WorkQueueItem`, `EXECUTE` on
  `core.usp_RunPull` and `core.usp_GetInFlightRun`, `SELECT` on
  `staging.WorkQueueItem`/`core.FactWorkItem` (for the row-count
  verification), and `INSERT`/`UPDATE`/`MERGE` on `core.PipelineRun`/
  `core.IngestWatermark` — a second, narrower login used only by the Cloud
  Run Job, distinct from the `db_owner` login `05_bootstrap_schema.sh` and
  any future DBA/migration tooling uses. Not scripted here because the
  exact grant list is worth re-deriving once you've decided whether a
  future migration tool needs `db_owner` too, rather than guessing now.
- **TLS certificate validation**: `sqlconn.py`'s default
  (`SQL_TRUST_SERVER_CERTIFICATE=no`) validates the Cloud SQL instance's
  server certificate. Fetch it once via `gcloud sql ssl server-ca-certs
  list --instance=$SQL_INSTANCE_NAME` (or `gcloud sql instances describe
  --format='value(serverCaCert.cert)'`), store the PEM alongside the ingest
  job (or bake it into the image), and set `SQL_CA_CERT_PATH` to it —
  `06_deploy_ingest_job.sh` does not do this today (it leaves
  `SQL_TRUST_SERVER_CERTIFICATE=no` with no `SQL_CA_CERT_PATH`, which most
  ODBC Driver 18 builds will refuse to connect with unless the CA is in the
  container's system trust store); fill this in before going to production,
  or set `SQL_TRUST_SERVER_CERTIFICATE=yes` as a conscious, documented
  short-term trade-off.
- **Cloud NAT**: not provisioned. Only needed if you switch
  `06_deploy_ingest_job.sh`'s `--vpc-egress` to `all-traffic` (e.g. to get a
  static outbound IP for an Elastic/BP API allowlist) — see that script's
  comment.

## 8. What could not be verified without a live GCP project

- The exact behavior of `gcloud sql instances patch --assign-ip` /
  `--no-assign-ip` timing (how long the public IP takes to actually become
  reachable/removed) — `05_bootstrap_schema.sh`'s proxy-readiness poll loop
  is a reasonable guard but wasn't exercised against a real instance.
  Verify by inspection.
- Whether `gcloud run jobs create`'s exact flag set in
  `06_deploy_ingest_job.sh` (`--network`/`--subnet`/`--vpc-egress` alongside
  `--set-cloudsql-instances`) is accepted together on the current `gcloud`
  CLI version without additional flags — the individual flags are each
  documented, but this specific combination was not run end-to-end. Verify
  by inspection, `gcloud run jobs create --help`, or `--dry-run`-equivalent
  inspection.
- Real Cloud SQL Auth Proxy v2 binary URL/version pinned in
  `05_bootstrap_schema.sh` (`v2.14.0`) may have moved on by the time you run
  this — check `github.com/GoogleCloudPlatform/cloud-sql-proxy/releases` for
  the current version before relying on the pinned URL.
