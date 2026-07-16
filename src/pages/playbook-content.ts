// ---------------------------------------------------------------------------
// playbook-content.ts
// ---------------------------------------------------------------------------
// Single source of truth for the operational playbook. Pure data — no React,
// no JSX — so this same module renders both the in-app Playbook page
// (src/pages/Playbook.tsx) and the generated repo doc (PLAYBOOK.md, via
// tools/build-playbook-md.mjs). Edit the prose here; never hand-edit
// PLAYBOOK.md, and never duplicate this content anywhere else.
//
// Regenerate PLAYBOOK.md after any change: npm run docs:playbook
// ---------------------------------------------------------------------------

export interface PlaybookBlock {
  kind: "heading" | "prose" | "list" | "table" | "code" | "callout" | "checklist";
  // heading: { text, level? (3|4) }
  // prose: { text }  -- rendered wrapped in <Bionic> in the page, plain text in markdown
  // list: { items: string[], ordered?: boolean }
  // checklist: { items: string[] }  -- rendered as a checkbox list (markdown: "- [ ] item")
  // table: { headers: string[], rows: string[][] }
  // code: { code: string, lang?: string }
  // callout: { tone: "info" | "warn", text: string }
  text?: string;
  level?: 3 | 4;
  items?: string[];
  ordered?: boolean;
  headers?: string[];
  rows?: string[][];
  code?: string;
  lang?: string;
  tone?: "info" | "warn";
}

export interface PlaybookSection {
  id: string; // slug, used for jump links and markdown headings
  title: string; // e.g. "1. What this is"
  blocks: PlaybookBlock[];
}

const heading = (text: string, level?: 3 | 4): PlaybookBlock => ({ kind: "heading", text, level });
const prose = (text: string): PlaybookBlock => ({ kind: "prose", text });
const list = (items: string[], ordered?: boolean): PlaybookBlock => ({ kind: "list", items, ordered });
const checklist = (items: string[]): PlaybookBlock => ({ kind: "checklist", items });
const table = (headers: string[], rows: string[][]): PlaybookBlock => ({ kind: "table", headers, rows });
const callout = (tone: "info" | "warn", text: string): PlaybookBlock => ({ kind: "callout", tone, text });

export const PLAYBOOK_SECTIONS: PlaybookSection[] = [
  {
    id: "what-this-is",
    title: "1. What this is",
    blocks: [
      prose(
        "This is Intelligent Automation — Performance: the hub-and-spoke Intelligent Automation Centre of Excellence's (IA CoE) monitoring dashboard, a React single-page app built with Vite. Every number on every page traces back through a fixed pipeline — nothing is invented in the browser."
      ),
      heading("Data lineage", 3),
      list([
        "Elastic / Kibana (log/event store) — the preferred ingestion route: Blue Prism ships queue activity here via Data Gateways, and pulling from Elastic has no further impact on the Blue Prism production database",
        "Blue Prism work queue API — the documented alternative route, used when the estate doesn't ship Blue Prism activity to Elastic; a direct pull hits the live BP estate itself, and REST paging is impractical for large backfills",
        "CSV in the BPAWorkQueueItem 16-column schema — the universal swap point between everything upstream and everything downstream; both adapters write the identical contract",
        "SQL warehouse (raw → staging → core → report schemas) — where every dollar/rate/date calculation actually happens",
        "model.json / a production API — the pre-aggregated payload the dashboard fetches",
        "This dashboard's visuals — charts and tables that only sum and display what already arrived pre-resolved",
      ]),
      callout(
        "info",
        "The browser client only ever aggregates (sums) numbers and reads pre-resolved rates — all benefit/cost/rate math happens upstream in the pipeline (the Node build script or the SQL views), never in the browser. The client also never sees the full set of raw item-level rows at once — only day×process aggregates. Section 8 has the real row counts."
      ),
    ],
  },
  {
    id: "connecting-apis",
    title: "2. Plugging in your Elastic (and Blue Prism) APIs",
    blocks: [
      prose(
        "There are two adapters under bp-sql-layer/ingest/, both writing the same 16-column BPAWorkQueueItem CSV — the universal swap point. Which one you run depends on how your estate is set up; many teams only ever need the first."
      ),
      callout(
        "info",
        "Preferred route: bp-sql-layer/ingest/elastic_to_csv.py pulls from Elastic — the Kibana-backed store Blue Prism already ships queue activity into via Data Gateways — so it has no further impact on the Blue Prism production database. Documented alternative: bp-sql-layer/ingest/bp_api_to_csv.py, which pulls directly from the Blue Prism work queue REST API for estates that don't ship activity to Elastic (or that need authoritative current item state); that path adds direct load to the live BP environment. Both write the identical CSV contract, so everything downstream — the SQL load, the merge, the report views, the dashboard — is unaffected by which one you run."
      ),
      heading("Preferred: the Elastic / Kibana adapter (elastic_to_csv.py)", 3),
      prose(
        "elastic_to_csv.py queries your Elasticsearch cluster for Blue Prism work-queue-item documents — the same activity Blue Prism ships there via Data Gateways — and writes them out as the same 16-column CSV. This is the preferred route because it only ever reads from Elastic: it has no further impact on the Blue Prism production database, unlike a direct pull against the live BP API/database. It's also the route to use when Elastic is the longer-retention copy of history (Blue Prism's own database purges/archives completed items faster than your pull cadence)."
      ),
      table(
        ["Env var", "Purpose"],
        [
          ["ELASTIC_URL", "Elasticsearch/Kibana cluster URL"],
          ["ELASTIC_INDEX", "index pattern to query, e.g. bp-workqueueitems-*"],
          ["ELASTIC_API_KEY", "ApiKey auth (preferred)"],
          ["ELASTIC_USER / ELASTIC_PASSWORD", "Basic auth alternative if no API key"],
          ["ELASTIC_VERIFY_TLS", "set \"false\" to skip TLS cert verification (default true — leave it alone unless you know why)"],
          ["FROM_DATE / TO_DATE", "ISO date bounds filtering on lastupdateddate — this is the watermark"],
          ["FIELD_MAP_JSON", "optional JSON object to override source field names if your Elastic documents use different field names than the script expects"],
          ["OUT_CSV", "output CSV path (default ./workqueueitems.csv)"],
          ["PAGE_SIZE", "Elastic search_after page size (default 5000)"],
          ["BP_WORKTIME_UNIT", "Unit of the Elastic index's Worktime field: \"ms\" or \"s\", converted to whole seconds before writing (default \"s\" — verify which unit your Elastic index actually stores; this default differs from bp_api_to_csv.py's default of \"ms\")"],
        ]
      ),
      prose(
        "Authentication: the script uses ApiKey header auth if ELASTIC_API_KEY is set, otherwise it falls back to Basic auth built from ELASTIC_USER / ELASTIC_PASSWORD. There's no built-in overlap-window knob here — schedule pulls with deliberate overlap yourself (see section 8). The two things to get right before trusting this path: confirm the Data Gateways event-stream shipping Blue Prism activity into Elastic is actually configured and current (it can lag or drop events if misconfigured), and confirm BP_WORKTIME_UNIT matches what your index really stores."
      ),
      heading("Alternative: the Blue Prism API adapter (bp_api_to_csv.py)", 3),
      prose(
        "Logs in to the Blue Prism Authentication Server (\"Hub\") with OAuth2 client-credentials, asks the Blue Prism 7.x Web API for the list of work queues, then pulls the items on each queue directly — no Elastic in the loop. Use this when your estate doesn't ship activity to Elastic via Data Gateways, or when you specifically need authoritative current item state without a Data Gateways dependency in the way. It pulls directly against the live Blue Prism environment, so — unlike the Elastic route — it does add load to the BP estate itself, and its history depth is limited to whatever the BP database hasn't yet purged. Each queue keeps its own watermark (the last-seen LastUpdatedDate) in a small JSON state file, and every run re-checks a rolling overlap window behind that watermark — not just \"since last time\" — because a work queue item keeps mutating in place (Pending → Locked → Completed/Exception, sometimes across retried attempts) and a mutation landing right at the edge of a narrow window could otherwise be missed forever."
      ),
      table(
        ["Env var", "Purpose", "Required?"],
        [
          ["BP_AUTH_URL", "OAuth2 token endpoint on the Blue Prism Authentication Server (Hub)", "Yes"],
          ["BP_CLIENT_ID / BP_CLIENT_SECRET", "OAuth2 client-credentials for the pull", "Yes"],
          ["BP_API_URL", "Base URL of the Blue Prism 7.x Web API (e.g. https://bp.corp/api)", "Yes"],
          ["BP_OAUTH_SCOPE", "OAuth2 scope to request, only if your Auth Server needs one", "No"],
          ["BP_QUEUE_NAMES", "Comma-separated queue names to pull; empty/unset = every queue the API returns", "No"],
          ["BP_PAGE_SIZE", "Items requested per page (default 1000)", "No"],
          ["BP_STATE_FILE", "Path to the JSON watermark state file (default ./bp_api_watermark.json) — this is where each queue's \"last seen\" point actually lives", "No"],
          ["WATERMARK_OVERLAP_HOURS", "Hours to re-pull behind each queue's stored watermark on every run (default 24)", "No"],
          ["BP_SINCE", "ISO-8601 floor date, used only on the very first run (no state file yet) so it doesn't default to pulling all history", "No"],
          ["BP_OUTPUT_CSV", "Output CSV path (default ./workqueueitems_api.csv; overridden by --output)", "No"],
          ["BP_WORKTIME_UNIT", "Unit of the API's Worktime field: \"ms\" or \"s\", converted to whole seconds before writing (default \"ms\" — differs from elastic_to_csv.py's default of \"s\")", "No"],
          ["BP_FIELD_MAP_JSON", "JSON overriding the default API-field → CSV-column map (see the caveat below)", "No"],
          ["BP_REQUEST_TIMEOUT / BP_MAX_RETRIES / BP_VERIFY_TLS", "HTTP timeout (default 30s), retry attempts on 429/5xx (default 5), and TLS verification (default true)", "No"],
        ]
      ),
      callout(
        "warn",
        "The script's own docstring is explicit that it was written without access to a live Blue Prism 7.x Web API / Swagger document: every entry in its API-field-to-CSV-column mapping is marked ASSUMPTION (e.g. whether the queue-item id field is really called \"id\", whether Worktime is really milliseconds, whether pagination really uses skip/take). Before relying on this in production, check your own instance's Swagger/OpenAPI page (typically {BP_API_URL}/swagger) and correct any mismatches via BP_FIELD_MAP_JSON — no code changes needed. Run it with --dry-run first: it prints the resolved config and which queues it would pull without fetching a single item."
      ),
      prose(
        "On a queue's very first pull (no state file yet), if BP_SINCE isn't set the script pulls that queue's entire history through the REST API — and prints a loud warning to say so. Don't let that happen at real scale: REST paging is impractical for large backfills — see section 8's backfill guidance."
      ),
      heading("Scheduling and landing the CSV (applies to either adapter)", 3),
      prose(
        "There's no cron built into either script — in production this runs on a schedule (Cloud Scheduler → Cloud Run job, see deploy/gcp.md). Whichever adapter writes it, the CSV lands at its OUT_CSV (or equivalent) path, then either (a) gets bulk-loaded into SQL via bp-sql-layer/scripts/10_bulk_load_csv.sql — edit the @File path in that script to point at your CSV, then run the whole script; it clears raw.WorkQueueItem, bulk-inserts, stamps provenance, and calls core.usp_RunPull automatically — or (b) for the demo dashboard, the equivalent path is data/mock/BPAWorkQueueItem.csv feeding npm run data:build."
      ),
      prose(
        "Demo-vs-production swap: today the repo runs on tools/generate-mock-data.mjs (deterministic, ~231,660 mock queue items, run via npm run data:mock). A real deployment replaces this entirely with elastic_to_csv.py (or bp_api_to_csv.py as the alternative) writing a real CSV in the same 16-column schema, which then flows into the exact same SQL/build pipeline. The schema is the contract: nothing else has to change."
      ),
      heading("First real data pull checklist", 3),
      checklist([
        "Decide which adapter you actually need: Elastic (elastic_to_csv.py) by default — it only reads from Elastic, so it has no further impact on the Blue Prism production database — unless your estate doesn't ship activity to Elastic via Data Gateways, or you specifically need authoritative current item state, in which case use the Blue Prism API adapter (bp_api_to_csv.py)",
        "If using the Elastic adapter: confirm your Elastic index actually contains Blue Prism work-queue-item documents (check field names against the 16-column contract; use FIELD_MAP_JSON if they differ) and confirm BP_WORKTIME_UNIT matches what the index actually stores; set ELASTIC_URL, ELASTIC_INDEX, and either ELASTIC_API_KEY or ELASTIC_USER/ELASTIC_PASSWORD",
        "If using the Blue Prism API adapter (the alternative): run it with --dry-run first to confirm the OAuth client-credentials work against BP_AUTH_URL and the queues it lists are the ones you expect; set BP_API_URL, BP_CLIENT_ID/BP_CLIENT_SECRET, BP_QUEUE_NAMES, and a BP_SINCE floor for the first real run",
        "Run a small, bounded pull first: a short recent date/watermark window and a small output path — don't pull your entire history through either adapter on the first try (see section 8 on backfill: history should come from a bulk export, not the REST API)",
        "Open the resulting CSV and check it has exactly the 16 expected columns in a sane state (no everything-blank rows)",
        "Point bp-sql-layer/scripts/10_bulk_load_csv.sql's @File path at the CSV and run it (or run npm run data:build path/to/that.csv for the demo pipeline)",
        "Check the core.usp_RunPull output (or the build script's console output) for any \"unmapped queue\" warnings — this means a queue in your data has no entry in RefQueueMap / reference.json's queueMap, so its activity won't show up anywhere until you map it",
        "Compare row counts: source CSV rows vs. what landed in core.FactWorkItem (or model.json's manifest sourceRows) — they should reconcile",
        "Only once that's clean, widen the pull window to your real desired ongoing delta and re-run",
      ]),
    ],
  },
  {
    id: "sql-layer",
    title: "3. The SQL layer",
    blocks: [
      prose("Every script below lives under bp-sql-layer/scripts/ and is meant to be run in order the first time you stand up the warehouse."),
      heading("01_database_and_schemas.sql", 3),
      prose("Creates the BPAnalytics database and four schemas: raw (landing zone, everything as text), staging (typed and cleaned), core (the actual model: dimensions + fact table), report (read-only views for BI tools and the dashboard). Idempotent, safe to re-run any time (e.g. fresh environment setup)."),
      heading("02_raw_and_staging.sql", 3),
      prose("Creates raw.WorkQueueItem (all columns NVARCHAR, nothing cast) and staging.WorkQueueItem (typed: dates as DATETIME2(0), numbers as INT, etc.), both following the 16-column BPAWorkQueueItem schema. Re-run if you need to reset the landing/staging tables."),
      heading("03_core_dimensions.sql", 3),
      prose("Creates the reference (\"Ref\") tables — RefSpoke, RefGradeRate, RefProposition, RefProcess, RefQueueMap, RefResource, RefVDICostHistory, RefEstateCostHistory, RefPeopleCostHistory, RefExceptionType — plus DimCalendar (2023-01-01 to 2027-12-31, extend the @EndDate variable if you need more years). Re-run when onboarding a new spoke, adding a process, retiring a VDI, or recording a pay review — it drops and repopulates the Ref tables but never touches the fact table."),
      list([
        "RefPeopleCostHistory (OwnerId, Headcount, AnnualCostGBP, EffectiveFrom, Note — PK is OwnerId+EffectiveFrom) is the SOLE source of the hub CoE team's people run-rate used in the cost engine (OwnerId = \"HUB\"); a spoke id as OwnerId is informational only and never charged into estate economics. RefEstateCostHistory.TeamAnnualCostGBP is retained only for schema parity with data/reference/reference.json's own legacy field of the same name — it is NOT read for cost calculation; RefEstateCostHistory still supplies WorkingDaysPerYear and ProductiveHoursPerDay, just not the team cost figure. Both the SQL views and the JS/Node pipeline (economics.ts, build-dashboard-data.mjs) now agree: hub team cost always comes from RefPeopleCostHistory/peopleCostHistory (ownerId=\"HUB\").",
        "RefResource carries the VDI renewal/coverage-window fields — RenewalDate (annual-cycle anchor), AnnualCostGBP (per-VDI override of the class rate), LicenseExpiryDate, and Status (\"active\"/\"retired\") — alongside the older ActiveFrom/ActiveTo lifecycle columns.",
      ]),
      heading("04_fact_and_calendar.sql", 3),
      prose("Creates core.FactWorkItem (one row per case — the single source of truth) and populates DimCalendar. Safe to re-run (rebuilds the calendar, leaves the fact table alone); normally only needed once, or to extend the calendar's date range."),
      heading("05_proc_load_staging.sql", 3),
      prose("Creates the stored procedure staging.usp_LoadStaging, which clears and rebuilds staging.WorkQueueItem from raw.WorkQueueItem: parses dates/numbers leniently (bad values become NULL rather than failing the whole load), trims text, drops junk rows with a blank ID, and if LastUpdatedDate is missing, falls back to the most recent of CompletedDate/ExceptionDate/LockedDate/LoadedDate. Runs automatically every pull (via usp_RunPull) — you don't normally call it directly."),
      heading("06_proc_merge_fact.sql", 3),
      prose("Creates core.usp_MergeFact, the procedure that actually merges staging into the fact table (see the dedicated explanation below — this is the important one). Runs automatically every pull."),
      heading("07_seed_reference.sql", 3),
      prose("Inserts the team-owned reference data into all the Ref tables (spokes, grade rates, propositions, processes, queue mappings, VDIs/resources, VDI cost history, estate/team cost history, exception patterns). This is the SQL twin of data/reference/reference.json — see section 4. Re-run whenever reference data changes (this is how a DBA applies the Administration panel's exported \"Download SQL sync script\"). Safe to re-run — it clears and repopulates."),
      heading("08_report_views.sql", 3),
      prose("Creates 20+ read-only views under the report schema (e.g. report.vw_DailyOutcomes, report.vw_Commercial, report.vw_KPIHeadline, report.vw_ExceptionDetail, report.vw_ResourceUtil, and more) — all money/rate calculations happen here in SQL, so nothing downstream ever recomputes them. tools/build-dashboard-data.mjs is a byte-for-byte-equivalent Node port of these views for the demo pipeline; if you ever change a view's logic here, the Node build script needs the matching change (and vice versa) or the two will disagree. Re-run only when fixing a view's logic."),
      prose("This script also creates report.fn_VdiDailyCost, an inline table-valued function that replicates the client engine's VDI coverage-window algorithm byte-for-byte: 365-day renewal cycles tiled from RenewalDate, a licence expiry or retirement cutting that cycle's coverage short, the class rate (or a per-VDI AnnualCostGBP override) resolved at the cycle's start date, and the resulting annual figure divided evenly across however many days the (possibly shortened) window actually covers. vw_EstateRateByDate and vw_SpokeInfraRateByDate both call fn_VdiDailyCost per VDI per date rather than summing a naive ActiveFrom/ActiveTo lifecycle window, so SQL and the JS/Node pipeline compute identical hub and spoke infra pools."),
      heading("09_proc_run_pull.sql", 3),
      prose("Creates core.usp_RunPull, the orchestration procedure (see below). This is the one thing you call after every data landing."),
      heading("10_bulk_load_csv.sql", 3),
      prose("A one-off script (not a stored procedure): clears raw.WorkQueueItem, bulk-inserts your CSV, stamps provenance (source filename, load batch id), then calls core.usp_RunPull for you. Edit the @File path near the top before running. Run this once per data pull if you're loading via file rather than a custom API push."),
      heading("core.usp_RunPull — what it orchestrates", 3),
      list(
        [
          "Snapshots the fact table's row count",
          "Runs staging.usp_LoadStaging (raw → staging)",
          "Runs core.usp_MergeFact (staging → fact)",
          "Snapshots the row count again and prints a summary (rows staged, new rows inserted, new fact total)",
          "Flags any queues present in the data but absent from RefQueueMap with a warning — so an unmapped queue never silently vanishes from the dashboard, it makes noise instead",
        ],
        true
      ),
      prose("Call sequence for every pull: load raw.WorkQueueItem (via 10_bulk_load_csv.sql or a custom API load), then EXEC core.usp_RunPull; — nothing else."),
      heading("Merge / delta semantics (core.usp_MergeFact)", 3),
      prose(
        "The merge matches rows on ID. A matched row is only overwritten if the incoming row's LastUpdatedDate is strictly newer than what's already stored — so re-sending an unchanged or stale row is a safe no-op. An unmatched row (new ID) is inserted. The merge never deletes rows — there is deliberately no \"delete rows missing from this batch\" logic, because any single pull might only cover one queue's worth of data, and the absence of an item from today's file doesn't mean it stopped existing. This is why the fact table only ever grows or updates in place — never shrinks — and why it's always safe to re-pull overlapping date windows."
      ),
    ],
  },
  {
    id: "reference-lifecycle",
    title: "4. Reference data lifecycle",
    blocks: [
      prose("There are two sources of truth for reference data, and they must be kept in step."),
      heading("The two twins", 3),
      list([
        "data/reference/reference.json — the base reference data, committed to git. Structure (real field names): spokes[] (spokeId, spokeName, shortName, colorLight, colorDark), gradeRates[] (grade, gradeName, effectiveFrom, hourlyCostGBP), propositions[], processes[] (processId, processName, processAcronym, processDescription, propositionId, smvMinutes, grade, isActive, icon, tags), queueMap[] (queueName, processId, stageName, stageOrder), resources[] (VDI records: resourceName, botName, botAcronym, vdiName, costClass, spokeId, activeFrom, activeTo, renewalDate, annualCostGBP, licenseExpiryDate, status, notes), vdiCostHistory[] (costClass, effectiveFrom, annualCostPerVDIGBP), estateCostHistory[], peopleCostHistory[] (ownerId — \"HUB\" or a spokeId as a string — headcount, annualCostGBP, effectiveFrom, note), exceptionPatterns[], exceptionDisplayCodes, targets.",
        "The in-app Administration panel, which stores edits as a localStorage overlay on top of that base JSON (key holds a versioned snapshot with a schema version, an edit counter, who/when, and a changelog of the last 50 edits). The overlay wins wholesale when present (a full replacement of the reference object, not a field-by-field patch) — so exporting and syncing regularly matters.",
      ]),
      heading("Role matrix — who edits what", 3),
      table(
        ["Admin section", "Who can edit"],
        [
          ["Squads", "admin only"],
          ["Grade rate card", "admin only"],
          ["Exception patterns", "admin only"],
          ["Users & roles", "admin only"],
          ["Propositions & processes", "admin, or a hub_lead for their own assigned spoke(s)"],
          ["People costs", "admin, or a hub_lead for their own assigned spoke(s)"],
          ["VDI estate", "admin, or a hub_lead for their own assigned spoke(s)"],
          ["Data & sync", "visible to everyone; the \"discard local edits\" action needs edit rights on at least one of the above"],
        ]
      ),
      heading("Effective-dating rule", 3),
      prose(
        "Every rate table (grade rates, VDI cost-class rates, estate/team cost history, people cost history) is looked up by \"the record with the latest effectiveFrom that is on or before the date in question wins\" — there's no future-dating and no averaging across records. Practically: don't edit an old dated record's rate to \"fix\" it retroactively — that would silently change historical benefit/cost figures for every day that record was in force. Instead, always add a new record with today's (or a chosen future) date as its effectiveFrom; the old record stays exactly as it was for every day up to that point. This is what \"history is locked\" means in practice — it's a discipline the team needs to follow in the Administration panel, since it determines whether yesterday's numbers stay honest."
      ),
      heading("People cost worked example", 3),
      prose(
        "The hub's people cost is a peopleCostHistory record with ownerId = \"HUB\" — the only people-cost record the cost engine actually charges into estate cost (spoke people-cost records with ownerId set to a spoke id are informational only and never enter the cost calculation; only spoke VDI/infra cost is charged to a spoke). The real data today (data/reference/reference.json) has two HUB records: the original is 14 people at £780,000/year effective from 2023-01-01 (the engine divides that by 365.25 for a daily hub cost of about £2,135.52), superseded by a second record of 16 people at £860,000/year effective from 2025-04-01 (about £2,354.55/day) — that second record is the one in force today. Every day from 2025-04-01 onward uses the newer daily rate; every day before it correctly still used the 2023 rate."
      ),
      prose(
        "If the team now hires a 17th person effective 1 September 2026, the correct edit is: add a new HUB record — headcount 17, the new annual cost total, effectiveFrom = \"2026-09-01\" — leaving the headcount-16/£860,000 record untouched. From 1 September 2026 onward, every day uses the new record's daily rate; every day before it keeps using the 16-person record."
      ),
      callout(
        "warn",
        "Important nuance: there's no partial-day proration on the hire date itself — the switch is a hard boundary at midnight on effectiveFrom, not a blend. If you want the cost to reflect a mid-month hire more precisely, set effectiveFrom to the actual hire date and let the day-boundary rule do the rest — don't try to average two records into one."
      ),
      heading("VDI semantics", 3),
      prose(
        "Each VDI/resource record carries a renewalDate (an annual-cycle anchor — coverage tiles in 365-day blocks from that date, both forward and backward), an optional licenseExpiryDate, and a status of \"active\" or \"retired\"."
      ),
      list([
        "A renewal (booking a new renewalDate) buys a full 365-day coverage window at the class's (or the record's overridden) annual cost — not pro-rated; the full annual figure is simply divided evenly across however many days that cycle actually covers.",
        "A licence expiry shortens the current cycle: coverage stops the day after licenseExpiryDate, so the same annual cost gets divided across fewer days (each covered day effectively costs a bit more) and there is zero cost and zero available capacity for any day past expiry until a new renewal is booked.",
        "Retiring a VDI (status = \"retired\" with an activeTo date) also cuts the coverage window short at that date — from then on the VDI contributes zero cost and zero capacity.",
      ]),
      heading("The sync loop", 3),
      prose("Do this every time reference data changes in the Administration panel:"),
      list(
        [
          "Edit in the UI",
          "Open Administration → Data & sync",
          "Click \"Download reference.json\" and replace data/reference/reference.json in the repo with it, then commit",
          "Click \"Download SQL sync script\" and hand it to your DBA to run against the SQL warehouse (it's generated to match bp-sql-layer/scripts/07_seed_reference.sql exactly — same DELETE+INSERT pattern, same columns)",
          "The next npm run data:build (or the next scheduled production data build) picks up the committed JSON",
        ],
        true
      ),
      callout(
        "warn",
        "This is the only way the two twins — the JSON and 07_seed_reference.sql — stay in step. Skipping either half of the export means the dashboard and the warehouse quietly disagree."
      ),
    ],
  },
  {
    id: "new-squad",
    title: "5. Adding a new hub/spoke (squad)",
    blocks: [
      prose("A plug-and-play checklist, using the Administration panel's actual tabs:"),
      checklist([
        "Administration → Squads → add the new squad (spokeName, shortName, colorLight, colorDark) — admin role required",
        "Administration → Propositions & processes → select the new squad → add its propositions, then add processes under each proposition (set the SMV in minutes and the grade it automates against for each process)",
        "Still in Propositions & processes → map each Blue Prism queue name to the process it feeds (and a stage name/order if the process runs in multiple stages)",
        "Administration → VDI estate → add the squad's VDI/bot records (set cost class, renewal date, and owner = the new spoke)",
        "Administration → People costs → add a people-cost record for the squad (informational — spoke people cost isn't charged into estate economics, but it's useful for the spoke's own reporting)",
        "Check the spoke slicer at the top of every dashboard page — the new squad appears there immediately, no rebuild needed (it's reading the live reference overlay)",
        "Assign a hub_lead for the squad: today, that's Administration → Users & roles, editing a user's role to hub_lead and adding the new spoke's id to their spokeIds; in production this instead comes from an Entra ID (Azure AD) group — see section 6",
        "Remember: the squad's activity (case volumes, outcomes, exceptions) won't show up until the next data build (npm run data:build, or the next scheduled production pull) actually ingests queue data tagged with that squad's mapped queues — adding the squad in the Administration panel only wires up the reference side instantly",
      ]),
      heading("What the hub_lead can then manage", 3),
      prose(
        "Once assigned: everything spoke-gated for their own spoke(s) — propositions & processes, queue mappings, VDI estate, people costs — but not the squads list, the grade rate card, exception patterns, or user management, all of which stay admin-only."
      ),
    ],
  },
  {
    id: "users-roles",
    title: "6. Users, roles & sign-in",
    blocks: [
      prose("The four roles: admin, hub_lead, hub_member, business_user."),
      heading("Permission matrix (from src/auth/auth-context.tsx's can() function)", 3),
      table(
        ["Permission", "Who has it"],
        [
          ["view_dashboards", "every signed-in user"],
          ["view_admin", "admin, hub_lead, hub_member"],
          ["edit_spoke_reference", "admin (always); hub_lead (only for the spoke ids assigned to them)"],
          ["edit_global_reference", "admin only"],
          ["manage_users", "admin only"],
        ]
      ),
      heading("Dev sign-in today", 3),
      prose("A demo directory of 6 seeded users, all sharing the passphrase \"demo\" (fine for a prototype — never do this in production):"),
      table(
        ["Name", "Role", "Spoke(s)"],
        [
          ["Priya Anand", "admin", "—"],
          ["Callum Ferris", "hub_lead", "Insurance, Pensions & Investments"],
          ["Naomi Whitfield", "hub_lead", "Risk"],
          ["Dev Kapoor", "hub_member", "—"],
          ["Sian Roberts", "business_user", "Commercial"],
          ["Marcus Delaney", "business_user", "Consumer Lending"],
        ]
      ),
      prose(
        "Manage this directory at Administration → Users & roles — add, edit, reset passphrase, or remove a user. This screen carries an explicit banner: \"In production this is managed via AD group membership… this screen is a working stand-in for the demo directory only.\""
      ),
      heading("Production: Entra ID (Azure AD)", 3),
      callout(
        "warn",
        "Be honest — src/auth/entra-provider.ts is currently a non-functional stub, and its own header comment says so explicitly: it exists to show the shape of real SSO, but every method (signIn, signOut, getSession) just throws an error today. The one genuinely working piece is mapClaimsToUser() — real logic that turns an Entra ID token's claims (an AD groups array plus standard claims) into this app's User object; it's ready to receive real claims once wired up."
      ),
      heading("Ask your IT/identity team for", 3),
      list([
        "An app registration in your Entra ID tenant for this dashboard",
        "A redirect URI for the app once it's hosted (matching wherever it's deployed)",
        "Group claims turned on in the token, so AD group membership shows up as a groups array the app can read",
      ]),
      heading("How AD groups map to roles/spokes (GROUP_ROLE_MAPPINGS in entra-provider.ts)", 3),
      table(
        ["AD group", "Maps to"],
        [
          ["SG-RPA-Admins", "role: admin"],
          ["SG-RPA-IPI-Lead", "role: hub_lead, spoke taken from the group name"],
          ["SG-RPA-RSK-Lead", "role: hub_lead, spoke taken from the group name"],
          ["SG-RPA-COM-Lead", "role: hub_lead, spoke taken from the group name"],
          ["SG-RPA-CLD-Lead", "role: hub_lead, spoke taken from the group name"],
          ["SG-RPA-HubMembers", "role: hub_member"],
          ["SG-RPA-BusinessUsers", "role: business_user"],
        ]
      ),
      prose(
        "Set up your real AD groups to match this naming pattern (or edit the mapping table to match your naming) and membership changes then flow straight into the app's roles once wired up."
      ),
      heading("What's genuinely NOT built yet — the honest gap list", 3),
      list([
        "@azure/msal-browser / @azure/msal-react are not installed (check package.json — only react/react-dom are dependencies today); wiring real sign-in means adding one of these.",
        "The three EntraAuthProvider methods need to actually call MSAL instead of throwing.",
        "Token validation belongs on a server, not in the browser. A static single-page app cannot safely validate an ID token or decide what data a user is allowed to see — that has to happen server-side. The right production shape is a small API (see section 8) that validates the Entra token on every request and serves data scoped to what that user's role/spokes are allowed to see; the static-JSON model this dashboard uses today is a demo/prototype simplification, not a production security boundary.",
      ]),
    ],
  },
  {
    id: "data-to-visual",
    title: "7. How data reaches each visual",
    blocks: [
      prose(
        "The general split: pipeline = SQL views (report.vw_*) / the equivalent Node build script (tools/build-dashboard-data.mjs) — this is where every rate is resolved and every sum is pre-computed once. Engine = the client-side code in src/reference/economics.ts and src/filters-context.tsx — this only re-sums the pipeline's pre-computed numbers according to whatever slicers (spoke/proposition/process/queue/tags/date range) the user currently has selected, and (for the Commercial page's rate-override slider) recomputes a what-if benefit using a flat rate instead of the grade-rate card. The client never re-derives Outcome, ExceptionType, or the base rate tables from raw items — it only slices and sums what the pipeline already resolved."
      ),
      table(
        ["Page", "Primary aggregates/views", "Computed in pipeline", "Computed/aggregated in client"],
        [
          ["Overview", "vw_KPIHeadline, vw_DailyOutcomes/vw_MonthlyOutcomes", "outcome counts, worktime, benefit, cost per day×process", "KPI totals summed for the current slicer selection; watchlist thresholds compared client-side"],
          ["Input & Outcome", "vw_DailyOutcomes, vw_MonthlyOutcomes", "completed/business-exception/system-exception counts and worktime per day×process", "daily/monthly toggle and slicer-scoped summing"],
          ["Process Analysis", "vw_DailyOutcomes joined to vw_DimProcess", "completion time, throughput, exception counts per process per day", "grouping/summing by process for the selected date range"],
          ["Exceptions", "vw_ExceptionDetail (day × process × reason grain)", "exception classification (Business/System) and reason text, pre-joined to process/spoke", "heatmap binning and free-text search over the (already small, ~148-row) exception-detail rows"],
          ["Process detail", "vw_DailyOutcomes filtered to one process", "same as Process Analysis", "client filters the shared day×process rows down to the one process drilled into"],
          ["VDI & Capacity", "vw_ResourceUtil, resource rows in model.json", "per-VDI utilisation and daily cost from the VDI coverage-window algorithm", "idle-time and cost roll-ups for the current slicer scope; the economics.ts rate-table logic mirrors this for any what-if"],
          ["Commercial", "vw_Commercial, vw_CommercialBySpoke, vw_CommercialMonthly, vw_CommercialOverall", "benefit = SMV × grade rate in force on the outcome date; cost = worktime × (hub £/bot-second + spoke infra £/bot-second); zero-worktime-day pool cost recorded separately (not folded into cost-per-case)", "cost-per-case, ROI, and cumulative totals summed for the current slicer scope; the rate-override slider recomputes benefit with economics.ts's benefitForRow() using a flat rate instead of the grade card"],
        ]
      ),
      heading("The economics engine mechanics, precisely", 3),
      prose(
        "Rate tables are built once per reference change (buildRateTables()), walking every calendar day to sum worktime by spoke and across the whole estate, and computing the hub pool and each spoke's infra pool per day. benefitForRow() = (completed × process.smvMinutes / 60) × grade rate in force on that row's date. costForRow() = row.worktimeSec × (hub £/bot-second share + spoke £/bot-second share), where each share is that day's pool cost divided by the worktime it's spread across (hub pool spread across all worktime that day, spoke pool spread across just that spoke's worktime that day). On a day with zero worktime, both shares collapse to zero and that day's pool cost is instead recorded in a separate \"unattributed\" figure used only for P&L reconciliation, never charged to any case."
      ),
    ],
  },
  {
    id: "performance-scale",
    title: "8. Performance & scale (50-100M rows)",
    blocks: [
      prose(
        "Real numbers from public/data/manifest.json (as of the last build): 231,660 source queue items over 2025-01-01 to 2026-07-14 — about 18.5 months. The browser never sees those 231,660 raw rows — it sees the pre-aggregated model.json, whose day×process grain (vw_DailyOutcomes) is 17,531 rows, exception-detail grain (vw_ExceptionDetail) is 148 rows, and resource/VDI grain (vw_ResourceUtil) is 11 rows. model.json is about 4.5 MB; the full set of public/data/views/vw_*.json files adds roughly another 5.8 MB. Raw, item-level rows live only in SQL, in core.FactWorkItem (and upstream in staging/raw) — never in anything the browser downloads."
      ),
      heading("Delta at every hop", 3),
      list([
        "Elastic pull (preferred): elastic_to_csv.py's FROM_DATE/TO_DATE act as a watermark, but there is no built-in overlap window in that script today — schedule pulls with deliberate overlap yourself (e.g. re-pull the last several days every run, not just \"since the last run's end date\"), and confirm the Data Gateways event-stream shipping activity into Elastic hasn't lagged or dropped anything in that window.",
        "Blue Prism API pull (alternative): bp_api_to_csv.py's lastUpdated watermark is paired with an explicit WATERMARK_OVERLAP_HOURS knob, precisely because a work-queue item mutates through several states (pending → completed, or pending → exception, or a retry) and its last-updated timestamp only advances when that happens — an item that was mid-flight right at the edge of a narrow window would otherwise be missed permanently. Set that overlap generously enough to cover your slowest-moving items.",
        "SQL merge: safe to re-pull overlapping windows either way, because core.usp_MergeFact matches on ID and only overwrites when the incoming LastUpdatedDate is strictly newer — so re-sending the same or older data is a harmless no-op, and re-sending a now-completed item that was previously \"pending\" correctly updates it in place.",
        "Aggregate refresh today is a full rebuild, not incremental: tools/build-dashboard-data.mjs reprocesses the entire CSV every time it runs, and report.vw_* are plain SQL views recomputed on every query — there's no incremental-aggregate-table layer yet. This is fine at ~230k rows; it will not be fine at 50-100M rows (see below).",
      ]),
      heading("Backfilling initial history", 3),
      callout(
        "warn",
        "Paginating 50-100M rows of history through a REST API is impractical — don't try it. Get the initial backfill from a bulk export, Elastic (the preferred path, if it holds the history), or a direct query against the Blue Prism production database, loaded straight into raw.WorkQueueItem. Once that backfill is in and merged, switch to a scheduled Elastic pull (or the Blue Prism API adapter as the alternative) for ongoing deltas only — small, frequent, watermark-driven pulls, never a full-history re-pull through the REST API."
      ),
      heading("Production serving", 3),
      prose(
        "Swap the static-JSON demo for a small API that reads report.vw_* views live from SQL Server, and point the frontend at it by setting VITE_DATA_URL to that API's base URL at build time (see src/main.tsx) — the response shapes are already defined 1:1 by public/data/views/vw_*.json, so the frontend code doesn't need to change, only where it fetches from."
      ),
      heading("SQL Server guidance at 50-100M-row scale (genuinely necessary re-architecture, not built yet)", 3),
      list([
        "A clustered columnstore index on core.FactWorkItem (the fact table) — the current schema doesn't need this at 230k rows but will at tens of millions.",
        "Partition the fact table by outcome-date month, so both loads and reporting queries only ever touch the partitions that changed.",
        "A proper watermark table (e.g. core.PullWatermark, one row per queue or index, storing the last successfully-merged LastUpdatedDate) instead of manually-set FROM_DATE/TO_DATE env vars — this makes incremental pulls self-driving and safe to automate on a schedule without a human picking dates.",
        "Server-side top-N / paging for any row-level detail view (like the Exceptions page's searchable detail) — never ship 50-100M rows, or even a few hundred thousand, to the browser for client-side filtering; let SQL do the filtering and only return what's on-screen.",
      ]),
      heading("Signs you've outgrown static JSON", 3),
      checklist([
        "model.json (plus the views files) is climbing past tens of MB — today's ~10MB combined baked output is already worth watching",
        "Initial dashboard load time is creeping past 2-3 seconds on a typical connection",
        "The day×process row count (today 17,531) is heading into the hundreds of thousands",
        "You need a filter or search that doesn't fit the pre-aggregated day×process×reason grain (true item-level search across all raw rows)",
        "Different spokes want different refresh cadences, or you need closer-to-real-time data than a scheduled batch bake can give you",
      ]),
      heading("Migration path", 3),
      prose(
        "Stand up the small data API described above, keep the same JSON view shapes, flip VITE_DATA_URL, done — the frontend genuinely does not need to change for this migration, only its data source."
      ),
    ],
  },
  {
    id: "accessibility",
    title: "9. Accessibility & personalisation",
    blocks: [
      prose(
        "What exists today (all in src/a11y/, driven by useDisplayPrefs() / DisplayPrefsProvider in prefs-context.tsx, persisted per signed-in user in localStorage): theme switching between light, dark, and a high-contrast theme; a dyslexia-friendly font toggle; a reading ruler (ReadingRuler.tsx) that tracks the line you're reading; bionic reading (Bionic.tsx) which bolds roughly the first 40% of each word in wrapped prose text to help the eye anchor faster — deliberately never applied to chart axis labels, legends, or numeric values, only descriptive prose; a colour-vision-deficiency-safe (CVD-safe) palette swap (the Okabe-Ito palette) for anyone who turns it on; a text-scale control (100% / 115% / 130%); a reduced-motion setting; and lighter personalisation touches — a time-of-day greeting with a seasonal accent icon (suppressed automatically in high-contrast mode), and live UK/India clocks in the header. Everything persists per signed-in user (namespaced localStorage key), so different people sharing a machine keep their own preferences."
      ),
      prose("Standards intent: WCAG 2.2 AA."),
      heading("Keyboard shortcuts (from the registry in src/App.tsx)", 3),
      table(
        ["Keys", "Action"],
        [
          ["?", "Show the keyboard shortcuts list"],
          ["Shift+A", "Open Accessibility & display settings"],
          ["/", "Focus the first slicer (Spoke)"],
          ["[", "Toggle navigation collapse"],
          ["Esc", "Close the shortcuts overlay"],
          ["Alt+1 … Alt+9", "Jump straight to page 1 through 9 (in nav order)"],
        ]
      ),
      heading("How to test with keyboard only", 3),
      prose(
        "Unplug the mouse (or just don't touch it) and Tab through the page — every interactive element (nav links, slicers, buttons) should show a visible focus outline; confirm Alt+1…Alt+9 jump between pages; confirm ? opens and Esc closes the shortcuts overlay; confirm Shift+A opens the display-settings panel and every toggle in it (theme, dyslexia mode, reading ruler, bionic reading, CVD-safe, text scale, reduced motion) is reachable and operable by keyboard alone."
      ),
    ],
  },
  {
    id: "runbook",
    title: "10. Runbook & troubleshooting",
    blocks: [
      heading("Daily/weekly ops", 3),
      prose(
        "Run (or confirm the scheduled) Elastic pull (or the Blue Prism API alternative) → bulk load → usp_RunPull cycle; skim the usp_RunPull output (or the build script's console output in the demo pipeline) for \"unmapped queue\" warnings after every run; whenever anyone edits reference data in the Administration panel, do the full sync loop from section 4 (download JSON, commit; download SQL, hand to DBA) rather than letting edits sit only in one person's browser."
      ),
      heading("npm scripts", 3),
      table(
        ["Script", "Command", "What it does"],
        [
          ["npm run dev", "vite", "local dev server"],
          ["npm run build", "tsc && vite build", "type-check, then production build to dist/"],
          ["npm run preview", "vite preview", "serve the production build locally"],
          ["npm run data:mock", "node tools/generate-mock-data.mjs", "writes a fresh deterministic mock CSV to data/mock/BPAWorkQueueItem.csv"],
          ["npm run data:build", "node tools/build-dashboard-data.mjs", "transforms the CSV + reference.json into public/data/model.json, public/data/views/vw_*.json, and public/data/manifest.json"],
          ["npm run data:all", "npm run data:mock && npm run data:build", "mock + build in one go (the full demo refresh)"],
          ["npm run data:verify", "node tools/verify-economics.mjs", "proves the client economics engine reproduces the pipeline-baked benefit/cost totals"],
          ["npm run docs:playbook", "node tools/build-playbook-md.mjs", "regenerates PLAYBOOK.md from src/pages/playbook-content.ts"],
        ]
      ),
      heading("What data:verify proves", 3),
      prose(
        "It reloads public/data/model.json, re-runs the same rate-table and per-row benefit/cost math the client's economics.ts uses, and checks the recomputed totals match the pipeline-baked totals to within 0.5%. A pass looks like PARITY OK with baked vs recomputed figures shown side by side; a fail prints a PARITY FAILED table with the actual differences and exits non-zero. Run it after every npm run data:build."
      ),
      heading("Common failures and where to look", 3),
      table(
        ["Symptom", "Likely cause", "Where to look"],
        [
          ["Build fails or numbers look wrong right after a real CSV swap", "CSV schema drift — a column renamed, reordered, or missing versus the 16-column BPAWorkQueueItem contract", "Compare the CSV header row against the contract in ARCHITECTURE.md; check the build script's console output for parsing errors"],
          ["Every KPI shows £0", "The base reference.json failed to load or parse", "Check the browser console and the Administration panel — reference-context.tsx surfaces a load error there when the base reference fetch/parse fails"],
          ["Your Administration edits vanished after a deploy or code update", "The localStorage overlay's schema version no longer matches the app's current schema version, so it was automatically rejected", "Check the browser console for a message like \"dropping stale localStorage overlay… falling back to base reference\" — this is deliberate, not a bug; re-apply the edits, or use Administration → Data & sync to confirm what's live"],
          ["A new spoke/squad shows no activity", "Expected — the squad's reference data is live immediately, but its queues' activity only appears after the next data build ingests data tagged with that squad's mapped queues", "Confirm the queue mapping is in place (section 5) and that a data build has run since"],
          ["A queue's data isn't showing up anywhere", "The queue isn't in RefQueueMap / reference.json's queueMap", "Check usp_RunPull's (or the build script's) unmapped-queue warning output, then add the mapping in Administration → Propositions & processes"],
        ]
      ),
      heading("Where to look, generally", 3),
      prose(
        "The browser devtools console (schema-version warnings, reference load errors); Administration → Data & sync's changelog (who changed what reference data, and when); public/data/manifest.json (which build is actually live — generatedAt, source, sourceRows); and in production, the usp_RunPull PRINT output (row-count deltas and unmapped-queue warnings) after every scheduled pull."
      ),
    ],
  },
];
