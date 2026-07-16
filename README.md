# Intelligent Automation — Performance

A **data-ready** automation performance dashboard for a hub-and-spoke
Intelligent Automation Centre of Excellence (IA CoE): one universal model
every spoke can slice to its own estate, with the commercial story
(grade-based benefit, spoke-level cost, ROI) built on the same rules as
the SQL warehouse in [bp-sql-layer/](bp-sql-layer/).

**Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it explains the end-to-end
lineage (Blue Prism work queue activity, preferred via Elastic or, as a
documented alternative, direct from the Blue Prism API → CSV → SQL →
dashboard/Power BI) and the swap points. The one-line version:
everything downstream is driven by a CSV in the exact `BPAWorkQueueItem`
export schema; replace the mock CSV with a real extract and every visual
follows.

**Read [PLAYBOOK.md](PLAYBOOK.md) for day-to-day operation** — Elastic /
Blue Prism ingest setup, the SQL script tour, the reference data sync loop, adding a new spoke,
roles/sign-in, performance/scale guidance, accessibility and troubleshooting.
ARCHITECTURE.md is the technical shape; PLAYBOOK.md is the how-to for the team
running this. It's generated from `src/pages/playbook-content.ts` (the same
content backs the in-app **Playbook** page) — regenerate it after edits with
`npm run docs:playbook`.

## Run it

```bash
npm install
npm run data:all   # generate the mock CSV and bake /public/data from it
npm run dev        # open the printed localhost URL
```

- `npm run data:mock` — writes `data/mock/BPAWorkQueueItem.csv` (deterministic,
  ~230k queue items over 18 months, 4 spokes — Insurance, Pensions & Investments;
  Risk; Commercial; Consumer Lending — 14 processes, 15 queues).
- `npm run data:build` — runs the SQL-parity transform over the CSV +
  [data/reference/reference.json](data/reference/reference.json) and writes
  `public/data/model.json` plus `public/data/views/vw_*.json` (1:1 ports of the
  `report.vw_*` SQL views — the API contract).
- `npm run data:build path/to/real-export.csv` — point it at any CSV in the
  same schema.
- `npm run build` — type-check + production build into `dist/`.

To run off a live API instead of baked JSON: set `VITE_DATA_URL` to an endpoint
returning the same `model.json` shape and rebuild. Deployment (Cloud Run):
[deploy/gcp.md](deploy/gcp.md).

Sign-in uses a fixed demo directory today: any of the seeded demo users with
the shared passphrase **"demo"**. Users and roles (`admin`, `hub_lead`,
`hub_member`, `business_user`) are managed from **Administration → Users &
roles** in-app; see [PLAYBOOK.md](PLAYBOOK.md) for the full user list and the
production Entra ID (Azure AD) setup.

## What's in the app

Nine report pages — Overview, Input & Outcome, Process Analysis, Exceptions,
Process detail, VDI & Capacity, Commercial Performance, Administration (gated
behind the `view_admin` permission), Data model — plus a **Playbook** page in
the Reference group with the operational runbook. All share one slicer bar:
**Spoke** (each spoke selects itself; "All spokes" is the hub view),
Proposition, Process, Queue, Tags, Date range — plus:

- **Saved views** (☆ in the top bar): name and reapply any combination of
  slicers, rate assumption and page. Local to the user today; the `SavedView`
  type is the contract if views move server-side.
- **Reference data overlay**: the committed base `data/reference/reference.json`
  can be edited in-browser from **Administration** (`src/pages/Admin.tsx`),
  persisted per-user in localStorage on top of the base data, and exported
  back out as a replacement `reference.json` or a SQL script for a DBA to run
  — see [PLAYBOOK.md](PLAYBOOK.md) for the sync loop.
- **Spoke colour schemes**: each spoke carries its own accent (validated for
  CVD separation and contrast on both surfaces, light and dark). Selecting a
  spoke re-skins the dashboard accent to that spoke's colour; the hub view
  keeps the brand accent. Colours live in `reference.json` / `core.RefSpoke`.
- **Human cost / SMV mechanism**: benefit = each process's SMV × the £/h of the
  **grade it automates against**, at the rate in force on the item's outcome
  date (date-effective rate card, hub-maintained). The Commercial page slider
  is a flat what-if override on top.
- **Spoke-true costs**: VDI class rates are universal (hub-set); each spoke
  pays for its own VDIs; the IA CoE team pool is shared by worktime. All money
  in the app is summed, never recomputed — rates were resolved in the pipeline.

## Where things live

| Path | What |
|---|---|
| `data/reference/reference.json` | Team-owned config: spokes, grade rate card, processes (SMV+grade), queue map, VDIs, cost histories. JSON twin of `07_seed_reference.sql`. |
| `tools/` | Mock generator + the CSV→JSON transform pipeline |
| `public/data/` | Baked dataset: `model.json`, `views/vw_*.json`, `manifest.json` |
| `src/rpaData.ts` | Semantic model, populated from `model.json` before first render |
| `src/filters-context.tsx` | Slicer state + client-side aggregation (sums only) |
| `bp-sql-layer/` | The SQL warehouse: schemas, procs, report views, runbook, Elastic / Blue Prism API ingest |
| `Dockerfile`, `deploy/` | Cloud Run hosting assets |
