# Intelligent Automation — Performance

A **data-ready** automation performance dashboard for a hub-and-spoke
Intelligent Automation Centre of Excellence (IA CoE): one universal model
every spoke can slice to its own estate, with the commercial story
(grade-based benefit, spoke-level cost, ROI) built on the same rules as
the SQL warehouse in [bp-sql-layer/](bp-sql-layer/).

**Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it explains the end-to-end
lineage (Blue Prism work queue activity, preferred via Elastic or, as a
documented alternative, direct from the Blue Prism API → CSV → SQL →
dashboard, with any BI tool able to read the same SQL report views) and the
swap points. The one-line version:
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
npm ci
npm run data:all   # generate the mock CSV and bake /public/data from it
npm run dev        # open the printed localhost URL
```

This is the static "local" mode: the SPA loads the baked `public/data/model.json`
directly and reference-data edits live in a browser-only overlay. No server,
database or GCP project needed.

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

### Local end-to-end, against the real data API

The SPA can also run in "api" mode, talking to the real production data API
([`server/`](server/)) instead of the baked JSON — with zero infrastructure of
its own (no database, no GCP project, no Entra tenant needed) via fixture mode:

```bash
# terminal 1 — the API, serving the same JSON files npm run data:build already wrote
cd server && npm ci
DATA_SOURCE=fixtures FIXTURES_DIR=../public/data/views AUTH_MODE=dev PORT=8080 npm run dev

# terminal 2 — the SPA, pointed at it
VITE_API_URL=http://localhost:8080 npm run dev
```

Setting `VITE_API_URL` switches the SPA's `DATA_MODE` to `"api"`: it calls
`GET /api/model` on boot and `PUT /api/reference` for every Administration-panel
save, instead of the static file and localStorage overlay. In a real deployment
`VITE_API_URL` is normally set to `"/"` (same-origin) so the dashboard's own
nginx proxies `/api/*` straight through to the API service — see
[deploy/gcp.md](deploy/gcp.md) §5 for the two topology options. See
[server/README.md](server/README.md) for the API's full contract and
[PLAYBOOK.md](PLAYBOOK.md) section 4 for the detailed walkthrough.

### Run the tests

```bash
npm test              # dashboard rules + data-pipeline parity (repo root)
cd server && npm test # data API: assembler parity, reference write order, auth
```

[PLAYBOOK.md](PLAYBOOK.md) section 14 lists what each test proves and the
full CI gate order.

Deployment (Cloud Run + Cloud SQL): [deploy/gcp.md](deploy/gcp.md).

Sign-in uses a fixed demo directory today: any of the seeded demo users with
the shared passphrase **"demo"** — for example admin **Nigel Spriggs**, or
hub leads **Callum Ferris** (Insurance, Pensions & Investments) and **Naomi
Whitfield** (Risk). Users and roles (`admin`, `hub_lead`, `hub_member`,
`business_user`) are managed from **Administration → Users & roles** in-app;
see [PLAYBOOK.md](PLAYBOOK.md) section 10 for the full user list and the
production Entra ID (Azure AD) setup (a real, working sign-in flow, not a
placeholder).

## What's in the app

Twelve report pages in six nav groups — Overview (Overview, Alerts), Operate
(Input & Outcome, Process Analysis, Exceptions, and the Process detail
drill-through), Optimise (VDI & Capacity), Value (Value & Finance, Commercial
Performance), Manage (Administration, gated behind the `view_admin`
permission), and Reference (Data model, **Playbook** — both admin-only). All
report pages share one slicer bar: **Spoke** (each spoke selects itself; "All
spokes" is the hub view), Proposition, Process, Queue, Tags, Date range —
plus a command palette (Ctrl+K / ⌘K) for jumping anywhere, drilling into a
process, or running an action — see [PLAYBOOK.md](PLAYBOOK.md) section 5.

- **Saved views** (☆ in the top bar): name and reapply any combination of
  slicers, rate assumption and page. Local to the user today; the `SavedView`
  type is the contract if views move server-side.
- **Reference data**: in local mode, the committed base
  `data/reference/reference.json` can be edited in-browser from
  **Administration** (`src/pages/Admin.tsx`), persisted as a localStorage
  overlay shared by whoever uses that browser, and exported back out as a
  replacement `reference.json` or a SQL script for a DBA to run. In api mode,
  every save is a versioned, audited write straight to SQL via `server/`,
  with a Conflict dialog if two edits collide — see
  [PLAYBOOK.md](PLAYBOOK.md) section 8 for the full lifecycle.
- **Thresholds & alerting**: the header bell evaluates global/spoke/process
  KPI targets (`Administration → Targets & thresholds`) against the trailing
  week of data and flags breaches/warnings — in-app only today; see
  [PLAYBOOK.md](PLAYBOOK.md) section 16.
- **Spoke colour schemes**: each spoke carries its own accent (validated for
  CVD separation and contrast on both surfaces, light and dark). Selecting a
  spoke re-skins the dashboard accent to that spoke's colour; the hub view
  keeps the brand accent. Colours live in `reference.json` / `core.RefSpoke`.
- **Human cost / SMV mechanism**: benefit = each process's SMV × the £/h of the
  **grade it automates against**, at the rate in force on the item's outcome
  date (date-effective rate card, hub-maintained). The Commercial page slider
  is a flat what-if override on top.
- **Spoke-true costs**: VDI class rates are universal (hub-set); each spoke
  pays for its own team and VDIs, apportioned across that spoke's own work by
  worktime; the CoE's shared pool is apportioned across all work. All money in
  the app is summed, never recomputed — rates were resolved in the pipeline.
- **Value & Finance**: net-benefit KPIs, a gross-to-net cost waterfall, a
  per-spoke P&L, and a value-league/review-candidates ranking, all exportable
  to CSV — see [PLAYBOOK.md](PLAYBOOK.md) section 6.
- **Accessibility & personalisation**: theme (light/dark/high-contrast), a
  liquid-glass toggle, text scale, dyslexia-friendly font, bionic reading, a
  reading ruler, a colour-vision-safe palette, reduced motion and more, all
  in one panel (Shift+A) — see [PLAYBOOK.md](PLAYBOOK.md) section 13.

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
