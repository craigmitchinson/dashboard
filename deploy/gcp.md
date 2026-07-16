# Deploying to GCP

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

## 2. Production (live warehouse) — target architecture

```
Cloud Scheduler ──▶ Cloud Run job: elastic_to_csv.py + bulk load + usp_RunPull
                                   │
                     Cloud SQL (SQL Server) — bp-sql-layer schemas & views
                                   │
                    Cloud Run service: thin data API over report.vw_* views
                    (one GET per view, JSON identical to /public/data/views/*)
                                   │
        Cloud Run (this frontend, built with VITE_DATA_URL=https://api…/model)
                                   +
        Power BI gateway → the same report.vw_* views (the PBI toggle path)
```

Steps:
1. **Cloud SQL for SQL Server** instance; run `bp-sql-layer/scripts/01…08` in
   order to build the warehouse; `07_seed_reference.sql` carries the estate
   config (spokes, grade rate card, VDI ownership).
2. **Ingest job**: containerise `bp-sql-layer/ingest/elastic_to_csv.py` +
   `sqlcmd` running `10_bulk_load_csv.sql`; schedule with Cloud Scheduler
   (e.g. hourly). Config is all env vars; keep the Elastic API key in Secret
   Manager.
3. **Data API**: a ~100-line service (Cloud Run) exposing
   `GET /data/model.json` and `GET /data/views/:view` straight off the SQL
   views — response shapes must match `public/data/` exactly (that's the
   contract; the app cannot tell the difference).
4. **Frontend**: build this repo with `--build-arg VITE_DATA_URL=…` and deploy
   as in section 1.
5. **Power BI**: connect to the `report.vw_*` views via the on-prem gateway or
   Cloud SQL public IP + firewall; set MonthLabel sort-by-column once (see the
   in-app Build guide).
```
