// Feature catalogue — single source for docs/FEATURE-CATALOGUE.md and the
// hub-review page. Pure data, no imports. Regenerate with
// `node tools/build-feature-catalogue.mjs`.
//
// Shape: sections[] → items[]. Every item has a stable id (the review page
// keys feedback on it — never renumber, only append), a title, a plain-English
// body (light markdown: **bold**, `code`, blank line = paragraph, "- " = bullet)
// and optionally a table {headers, rows}.

export const CATALOGUE_META = {
  title: "Intelligent Automation Performance Dashboard",
  subtitle: "Feature and metric catalogue for hub review",
  version: "1.0",
  dated: "2026-09-16",
  audience:
    "Hub leads and squad members in Insurance, Pensions & Investments; Risk; Commercial; Consumer Lending; and the CoE team.",
  purpose:
    "This catalogue lists everything the dashboard shows and does today, with the definition and formula behind every number. Please review it against what your hub needs and tell us, item by item, whether it meets the need, partly meets it, or leaves a gap.",
  howToReview: [
    "Work through the sections that matter to your hub. Every item is numbered so you can refer to it in your reply.",
    "For each item tell us whether it Meets your need, Partly meets it, or leaves a Gap, with a short note wherever it is Partly or Gap or the definition does not match how your hub measures things.",
    "Section 23 lists the questions we most need answered. Section 22 lists what we already know is missing, so you can confirm or reprioritise.",
    "Section 17 shows the reference data loaded today. If a rate, SMV, grade, VDI or people-cost figure for your hub is wrong, tell us the right one.",
    "Reply with comments in this document, or a list of item numbers and verdicts, to the CoE team.",
  ],
  hubs: [
    { key: "ipi", label: "Insurance, Pensions & Investments" },
    { key: "risk", label: "Risk" },
    { key: "commercial", label: "Commercial" },
    { key: "lending", label: "Consumer Lending" },
    { key: "coe", label: "CoE (hub team)" },
  ],
};

export const SECTIONS = [
  // ---------------------------------------------------------------------------
  {
    id: "overview",
    title: "What the dashboard is",
    intro:
      "A web dashboard for the Intelligent Automation Centre of Excellence and its hubs. It shows how our Blue Prism automations perform, what they cost, and what they are worth, at estate, hub, proposition and process level. It is not Power BI: it is a purpose-built web application with its own sign-in, roles, alerts and administration.",
    items: [
      {
        id: "ov-model",
        title: "Hub and spoke model",
        body: "The CoE is the hub. Each hub (Insurance, Pensions & Investments; Risk; Commercial; Consumer Lending) is a spoke that owns its own processes, people and machines. Every page can be viewed for the whole estate or narrowed to one spoke.",
      },
      {
        id: "ov-lineage",
        title: "Where the data comes from",
        body: "Blue Prism ships work-queue activity into Elastic (the Kibana log store) via Data Gateways. A scheduled job pulls the change every 15 minutes into our own SQL Server warehouse, where it is aggregated. Money is calculated from those aggregates and our reference data using one set of rules, held in the SQL views and mirrored in the browser; an automated parity check proves the two agree.",
      },
      {
        id: "ov-pages",
        title: "Twelve pages in six groups",
        body: "Overview and Alerts (Overview group); Input & Outcome, Process Analysis, Exceptions and Process detail (Operate); VDI & Capacity (Optimise); Value & Finance and Commercial Performance (Value); Administration (Manage); Data model and Playbook (Reference, admin only). Pages a user may not see are removed from the navigation entirely.",
        table: {
          headers: ["Group", "Page", "What it answers", "Who sees it"],
          rows: [
            ["Overview", "Overview", "How is the estate doing right now?", "Everyone"],
            ["Overview", "Alerts", "What needs attention today?", "Everyone, scoped to their hub"],
            ["Operate", "Input & Outcome", "What came in, and what happened to it?", "Everyone"],
            ["Operate", "Process Analysis", "Which processes are healthy, which are not?", "Everyone"],
            ["Operate", "Exceptions", "What is failing, and why?", "Everyone"],
            ["Operate", "Process detail", "One process in depth", "Everyone"],
            ["Optimise", "VDI & Capacity", "Are our machines used well?", "Everyone"],
            ["Value", "Value & Finance", "What is automation worth, net?", "Everyone"],
            ["Value", "Commercial Performance", "What is the ROI, per case, per process?", "Everyone"],
            ["Manage", "Administration", "Where reference data is edited", "Admin, hub lead, hub member"],
            ["Reference", "Data model", "How the data is structured", "Admin"],
            ["Reference", "Playbook", "How the platform is run", "Admin"],
          ],
        },
      },
      {
        id: "ov-freshness",
        title: "Data freshness indicator",
        body: "The header always shows **Data to {date} · {rows}**: the latest outcome date loaded and the number of source queue items behind it. Every date window on every page ends at that date, not at today. The dot beside it turns amber with the message **API unreachable — showing last loaded data** if the data service cannot be reached; the last good data stays on screen.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "filters",
    title: "Filters, navigation and saved views",
    intro: "The same six filters sit under the header on every data page and apply to every visual on that page.",
    items: [
      {
        id: "fl-spoke",
        title: "Spoke filter",
        body: "Options: **All spokes (hub)** plus each spoke with its colour dot. Choosing a spoke resets Proposition, Process name and Queue name, and tints the whole application in that spoke's colour so it is always obvious which hub you are looking at.",
      },
      {
        id: "fl-proposition",
        title: "Proposition filter",
        body: "Options narrow to the selected spoke. Choosing a proposition resets Process name and Queue name. Propositions today: General Insurance, Home Insurance, Pensions, Life & Protection, Investments, Financial Crime, Commercial Insurance, Personal Loans.",
      },
      {
        id: "fl-process",
        title: "Process name filter",
        body: "Options narrow to the selected spoke and proposition. Choosing a process resets Queue name and shows a **Process: {name}** chip under the filter bar with an × to clear it.",
      },
      {
        id: "fl-queue",
        title: "Queue name filter",
        body: "All 15 Blue Prism queue names. This list is not narrowed by the spoke or process chosen above it.",
      },
      {
        id: "fl-tags",
        title: "Tags filter (multi-select)",
        body: "Fourteen tags carried on processes: Batch, Claims, Collections, Customer-facing, KYC, Onboarding, Reconciliation, Regulatory, Renewals, Screening, Transfers, Triage, Underwriting, Valuations. A process matches if it carries any selected tag.",
      },
      {
        id: "fl-date",
        title: "Date range",
        body: "Presets: **Last 7 days**, **Last 30 days**, **Last 90 days** (default), **Year to date**, **All time**, **Custom range…** with From and To dates bounded by the data available. Every window ends at the data-through date. Every page compares the window against the immediately preceding window of equal length for its change arrows.",
      },
      {
        id: "fl-reset",
        title: "Reset",
        body: "One button clears every filter back to defaults, including the what-if rate slider on Commercial Performance, and shows a count of the filters currently active.",
      },
      {
        id: "fl-drill",
        title: "Click to drill or cross-filter",
        body: "Clicking a process bar on Overview or Process Analysis filters every page to that process. Clicking a watchlist or league-table row opens Process detail for it. Clicking a heatmap row on Exceptions toggles the filter. Opening an alert sets the spoke and process and goes to the relevant page.",
      },
      {
        id: "fl-back",
        title: "Breadcrumb and Back",
        body: "Process detail shows a breadcrumb back to the page the drill started from. The browser Back button also works and returns you to the same filtered state.",
      },
      {
        id: "fl-views",
        title: "Saved views",
        body: "Save the current filters, what-if rate and page under a name. Views are private to the signed-in user, listed under **Views** in the header and in the command palette, and can be deleted. Saving the same name again overwrites it. There is no separate rename.",
      },
      {
        id: "fl-palette",
        title: "Command palette (Ctrl+K or Cmd+K)",
        body: "A search box over everything: pages, **Drill into {process}**, **Filter to {spoke}**, saved views, the top five unacknowledged alerts, actions (reset filters, toggle theme, collapse navigation, accessibility settings, shortcuts, acknowledge all alerts, sign out) and, for admins, every Playbook section. Typing **>** searches actions only. Recent choices float to the top.",
      },
      {
        id: "fl-shortcuts",
        title: "Keyboard shortcuts",
        body: "Shown by pressing **?**.",
        table: {
          headers: ["Keys", "Action"],
          rows: [
            ["?", "Show keyboard shortcuts"],
            ["Ctrl+K / Cmd+K", "Open the command palette"],
            ["Shift+A", "Open Accessibility & display settings"],
            ["/", "Focus the Spoke filter"],
            ["[", "Collapse or expand the navigation"],
            ["Esc", "Close whatever is open"],
            ["Alt+1 … Alt+9", "Go to the first nine pages in navigation order"],
          ],
        },
      },
      {
        id: "fl-persist",
        title: "What is remembered between visits",
        body: "Per signed-in user: saved views, the last page and navigation state, display settings, recent palette choices and alert acknowledgements. Filter selections are not remembered; every visit starts at All spokes and Last 90 days.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-overview",
    title: "Page: Overview",
    intro: "Headline performance, outcome mix and the operational watchlist.",
    items: [
      {
        id: "pov-kpis",
        title: "Six headline tiles",
        body: "Each tile shows the value for the selected window, the change against the previous window, and a target status where a target exists.",
        table: {
          headers: ["Tile", "Shows", "Change arrow", "Target"],
          rows: [
            ["Completion rate", "Share of attempted cases completed first time", "Up is good", "On/Off target (≥ 95%)"],
            ["Cost per completed case", "Fully loaded estate cost per completed case", "Down is good", "≤ £9.00"],
            ["Exceptions", "Business plus system exceptions, with a daily sparkline", "Down is good", "—"],
            ["Net/FTE value", "Net benefit divided by FTE released; sub-line shows FTE released", "—", "—"],
            ["Completed cases", "Completed cases with a daily sparkline", "Up is good", "—"],
            ["Colleague time saved", "Hours of colleague effort displaced", "Up is good", "—"],
          ],
        },
      },
      {
        id: "pov-dailyflow",
        title: "Daily case flow",
        body: "Line chart of cases per day by outcome: Completed, Business exception, System exception. Weekends are shaded. When the window is 60 days or more, a **Daily / 7-day avg** toggle overlays a moving average. Hovering shows the values for that day.",
      },
      {
        id: "pov-watchlist",
        title: "Watchlist",
        body: "The five processes with the highest exception rate. Each row shows the process, its queue, the exception count, its estate cost and its exception rate, coloured red above the 6% target and amber within 10% of it. Click a row to open Process detail. Exportable to CSV.",
      },
      {
        id: "pov-throughput",
        title: "Throughput by process",
        body: "Horizontal bars for the seven processes with the most completed cases. Click a bar to filter every page to that process.",
      },
      {
        id: "pov-outcome",
        title: "Outcome mix",
        body: "A single stacked bar of Completed, Business exception and System exception with counts and shares, a daily share strip when the window exceeds 14 days, and the estate cost apportioned to the period.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-alerts",
    title: "Page: Alerts",
    intro: "Threshold breaches and early warnings. Alerts always evaluate the trailing seven days of the latest data; the date range filter does not apply.",
    items: [
      {
        id: "pal-feed",
        title: "Alert feed",
        body: "Grouped by severity (Breaches first, then Warnings) and by owning hub, with Estate-wide alerts first. Within a group, unacknowledged alerts come before acknowledged ones. Each row shows the severity, the headline, a context line (process, proposition, spoke, or VDI), a seven-day sparkline with the threshold drawn as a dashed line, an **Open** button that goes to the relevant page with filters set, and **Acknowledge** or **Unacknowledge**.",
      },
      {
        id: "pal-toolbar",
        title: "Counts, filters and export",
        body: "The top strip shows breach, warning and acknowledged counts for the current view, a **Hide acknowledged** switch, **Acknowledge all** for the filtered set, and CSV export. Scope chips filter to Estate, Spoke, Process or VDI alerts. The spoke, proposition and process filters also narrow the feed.",
      },
      {
        id: "pal-visibility",
        title: "Who sees which alerts",
        body: "Admins and CoE-wide users see every alert. A user attached to a hub sees estate-wide alerts plus alerts for their own hub, its processes and its VDIs. Alerts for hub-owned (shared or test) VDIs are a CoE concern and are not shown to hub-scoped users.",
      },
      {
        id: "pal-ack",
        title: "Acknowledgement",
        body: "Acknowledgements are per signed-in user. They expire automatically when a new data build moves the data-through date on, so a persisting problem resurfaces.",
      },
      {
        id: "pal-bell",
        title: "Header bell",
        body: "The bell shows a count of unacknowledged alerts (9+ above nine), a preview of the worst five, **Acknowledge all**, and **View all alerts**. Screen readers are told when new alerts arrive. The navigation item for Alerts carries the same count.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-input-outcome",
    title: "Page: Input & Outcome",
    intro: "Case flow in and out, by outcome, daily or monthly.",
    items: [
      {
        id: "pio-kpis",
        title: "Four tiles",
        body: "**Volume in** (cases attempted), **Completed out** with its share of intake, **Business exceptions** with share of intake, **System exceptions** with share of intake.",
      },
      {
        id: "pio-flow",
        title: "Case flow: volume in and out by outcome",
        body: "Line chart of intake (dashed) against Completed, Business exception and System exception. A **Daily / Monthly** toggle re-bins the chart to calendar months.",
      },
      {
        id: "pio-split",
        title: "Outcome split over time",
        body: "Completion % and Exception % over time with two dashed reference lines: the 95% completion target and the 6% exception ceiling.",
      },
      {
        id: "pio-summary",
        title: "Period summary",
        body: "Cases attempted, Completed (straight-through), Business exceptions, System exceptions, Active days in range, and Average cases per active day.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-process-analysis",
    title: "Page: Process Analysis",
    intro: "Completion time, throughput and exception trends by process.",
    items: [
      {
        id: "ppa-performance",
        title: "Process performance",
        body: "Horizontal bars per process, switchable between **Avg completion time** (bot runtime per completed case, longest first, with case counts), **Throughput** (completed cases) and **Exception rate** (share of attempts ending in an exception). Click a bar to filter every page to that process.",
      },
      {
        id: "ppa-trend",
        title: "Exception time trend",
        body: "System and business exception volume over time, daily or monthly.",
      },
      {
        id: "ppa-league",
        title: "Process league table",
        body: "Process, average cycle time, exception % (red above 10%) and estate cost, sorted by cost. A footer shows the weighted average cycle time across the estate. Click a row to open Process detail. Exportable to CSV.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-exceptions",
    title: "Page: Exceptions",
    intro: "Exception heatmap and searchable detail.",
    items: [
      {
        id: "pex-kpis",
        title: "Four tiles",
        body: "**Total exceptions** with change against the previous window, **System exceptions** and **Business exceptions** each with their share of all exceptions, and **Exception cost (period)** split into business and system rework cost.",
      },
      {
        id: "pex-heatmap",
        title: "Exception heatmap",
        body: "Processes down the side, exception types across the top as three-letter codes (hover for the full reason), with stronger colour meaning more exceptions. Each row has a total bar, and a footer totals each column. Click a process row to filter to it. System and business types are distinguished by colour.",
      },
      {
        id: "pex-detail",
        title: "Exception detail table",
        body: "Every exception reason in the current filters with category, volume, share of total, rework cost and the most recent date seen. Switch between All, System and Business; search by name; sort any column. Exportable to CSV.",
      },
      {
        id: "pex-classification",
        title: "How an exception is classified",
        body: "A reason already prefixed **Business Exception:** or **System Exception:** keeps that classification. Otherwise the reason text is matched against an ordered list of patterns maintained in Administration (for example anything containing *timeout* is System; anything containing *duplicate* is Business). Changing a pattern applies from the next data build; it does not re-tag history.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-process-detail",
    title: "Page: Process detail",
    intro: "One process in depth. Reached by clicking a process anywhere, or from the chooser on the page.",
    items: [
      {
        id: "ppd-chooser",
        title: "Process chooser",
        body: "When no process is selected: a **Needs attention** group of the three processes with the highest exception rate, then every process grouped by spoke, searchable by name, queue, spoke or acronym.",
      },
      {
        id: "ppd-banner",
        title: "Process banner",
        body: "Name and acronym, spoke, proposition, its queue and stages, and its tags, with a breadcrumb back to the page you came from and a **Clear drill** button.",
      },
      {
        id: "ppd-kpis",
        title: "Five tiles",
        body: "**Completed** items, **Exceptions** with share of attempts, **Completion rate**, **Avg cycle time** (bot runtime per completed item), and **Estate cost** with cost per completed case.",
      },
      {
        id: "ppd-flow",
        title: "Daily flow",
        body: "Completed, business and system exceptions per day for this process.",
      },
      {
        id: "ppd-topexc",
        title: "Top exceptions",
        body: "The seven most frequent exception reasons for this process, coloured by category, with the process's exception rework cost for the period.",
      },
      {
        id: "ppd-workers",
        title: "Digital workers",
        body: "Up to eight machines that ran this process in the period, with items processed and utilisation.",
      },
      {
        id: "ppd-profile",
        title: "Process profile",
        body: "The reference data behind the process: SMV in manual minutes per case, the colleague grade it automates against, that grade's current hourly rate, colleague time released in the period, and the process description.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-capacity",
    title: "Page: VDI & Capacity",
    intro: "Digital-worker utilisation, idle time and estate cost.",
    items: [
      {
        id: "pcp-kpis",
        title: "Four tiles",
        body: "**Active digital workers** out of the estate total, **Average utilisation** against the 15% to 60% healthy band, **Spare capacity** in hours available for new automations, and **Estate cost (period)**.",
      },
      {
        id: "pcp-util",
        title: "Utilisation by digital worker",
        body: "Bars per machine grouped by owning spoke: red at or above the maximum, green within the band, amber below the minimum. Low utilisation is spare capacity; high utilisation flags a bottleneck risk.",
      },
      {
        id: "pcp-table",
        title: "VDI capacity table",
        body: "Per machine: spoke, processes run, items, active hours, idle % (red above 90%), utilisation bar, and estate cost share. Sortable and exportable to CSV.",
      },
      {
        id: "pcp-gauge",
        title: "Capacity & cost summary",
        body: "A utilisation gauge against the healthy band, licensed capacity in hours, productive bot time in hours, and apportioned estate cost.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-value-finance",
    title: "Page: Value & Finance",
    intro: "Net value, ROI, cost composition and run-rate forecast for finance and the executive.",
    items: [
      {
        id: "pvf-kpis",
        title: "Six tiles",
        table: {
          headers: ["Tile", "Shows"],
          rows: [
            ["Net benefit (window)", "Gross benefit less estate cost, with change against the previous window"],
            ["Annualised run-rate net", "Window net scaled to 365.25 days"],
            ["ROI", "Gross benefit per £1 of estate cost, shown as a multiple"],
            ["Payback", "Months of run-rate net needed to repay this period's estate cost"],
            ["FTE released", "Colleague full-time-equivalents released, with change"],
            ["Cost per case vs target", "Cost per completed case against the £9.00 target, with change"],
          ],
        },
      },
      {
        id: "pvf-fy",
        title: "FY target attainment",
        body: "Fiscal-year-to-date net benefit against the estate's annual net benefit target, projected to fiscal-year end at the current run-rate, with an on-track or behind verdict. The fiscal year starts in April by default. No estate target is set today, so this shows a prompt to configure one.",
      },
      {
        id: "pvf-waterfall",
        title: "Benefit waterfall",
        body: "Gross benefit, less **Teams** (all people cost), less **Machines (VDIs)** (all VDI cost), equals Net. A memo bar shows idle machine cost that no work absorbed; it is shown for honesty and is not subtracted from Net. Cost is split by kind, not by owner: the CoE is one owner alongside the hubs.",
      },
      {
        id: "pvf-monthly",
        title: "Monthly value trend",
        body: "Stacked monthly cost (Teams, Machines) with a Net line, plus fiscal-year-to-date net and the change against the same point in the prior fiscal year.",
      },
      {
        id: "pvf-spokepl",
        title: "Spoke P&L",
        body: "One row per hub: gross benefit, people cost, infrastructure cost, net, margin %, cost per case, completed cases, attainment against the hub's own annual target (fiscal-year-to-date), and a 12-week net trend. A total row reconciles to the tiles. Exportable to CSV.",
      },
      {
        id: "pvf-pareto",
        title: "Process value league",
        body: "Processes ranked by net benefit with a cumulative line and a marker at 80% of positive net, so you can see how few processes deliver most of the value. Shows the top 15.",
      },
      {
        id: "pvf-review",
        title: "Review candidates",
        body: "Processes running at a net loss, worst first, each with a reason chosen by fixed rules in order: fewer than 30 completions in the period (low volume); exception rework cost above 30% of the process's automation cost (high exception cost); unit cost above 1.5 times the target cost per case (high unit cost); otherwise cost exceeds benefit at the current volume and rate mix.",
      },
      {
        id: "pvf-footer",
        title: "Run-rate projection",
        body: "A closing sentence projects net benefit to fiscal-year end at the current run-rate and compares it with the prior fiscal year to the same point.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-commercial",
    title: "Page: Commercial Performance",
    intro: "Cost per case, grade-based benefit and cumulative ROI.",
    items: [
      {
        id: "pcm-kpis",
        title: "Five tiles",
        body: "**Cost per completed case** against the £9.00 target, **Estate cost** (Teams plus Machines), **Gross benefit**, **Net benefit**, and **Return on automation** as benefit per £1 spent.",
      },
      {
        id: "pcm-whatif",
        title: "Human cost assumption (what-if slider)",
        body: "By default benefit is valued at each process's grade rate in force on the day work completed, and the blended rate is shown. Dragging the slider (£15 to £60 per hour) revalues benefit at a flat rate to test sensitivity. **Use grade rates** restores the default. The slider never changes cost.",
      },
      {
        id: "pcm-cpc",
        title: "Cost per completed case over time",
        body: "Daily cost per case against the target line, with a shaded 14-day forecast projected from the recent trend.",
      },
      {
        id: "pcm-cumulative",
        title: "Cumulative benefit vs cost",
        body: "Cumulative benefit and cumulative cost accruing through the period, each with a 14-day forecast. Exportable to CSV.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "page-reference",
    title: "Pages: Data model and Playbook (admin)",
    items: [
      {
        id: "prf-datamodel",
        title: "Data model",
        body: "The data lineage, the star schema (one fact row per day and process, with process, digital worker, date and exception-reason dimensions), relationships, and the modelling rules every consumer shares. Any BI tool can connect to the same SQL views and get the same numbers.",
      },
      {
        id: "prf-playbook",
        title: "Playbook",
        body: "The plain-English operations guide: how data is pulled and loaded, how money is calculated, the reference data we maintain, the data API, using the dashboard, finance and alerts, sign-in, running in Google Cloud, scale, and the runbook. Also published as PLAYBOOK.md.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "metrics",
    title: "Metric dictionary",
    intro:
      "Every measure on the dashboard, its plain-English meaning and its formula. Attempts means completed plus business plus system exceptions. Change arrows compare the selected window with the immediately preceding window of the same length, with the same filters.",
    items: [
      { id: "m-completion", title: "Completion rate", body: "Share of attempted cases that completed first time with no exception.\n\n`completed ÷ attempts` · Up is good · Target ≥ 95%" },
      { id: "m-completed", title: "Completed cases / Throughput", body: "Work items the bots finished successfully.\n\n`sum of completed` · Up is good" },
      { id: "m-attempts", title: "Volume in / Cases attempted", body: "Everything the bots attempted.\n\n`completed + business exceptions + system exceptions`" },
      { id: "m-exceptions", title: "Exceptions", body: "Items that failed rather than completing.\n\n`business + system` · Down is good" },
      { id: "m-excrate", title: "Exception rate", body: "Share of attempts that ended in an exception.\n\n`exceptions ÷ attempts` · Down is good · Target ≤ 6%; amber within 10% of the target" },
      { id: "m-business", title: "Business exceptions", body: "Failures caused by the case data or business rules, where a person has to decide. Shown as a count and as a share of intake or of all exceptions." },
      { id: "m-system", title: "System exceptions", body: "Failures caused by systems or technology, such as an application being down or timing out.\n\nAlert target: `system ÷ attempts` ≤ 3%" },
      { id: "m-outcomemix", title: "Outcome mix", body: "Each outcome's share of attempts: Completed, Business exception, System exception." },
      { id: "m-cycle", title: "Avg cycle time / Avg completion time", body: "Average digital-worker runtime per completed item.\n\n`worktime on completed items ÷ completed`, shown as 45s, 10m 21s or 1h 04m" },
      { id: "m-wcycle", title: "Weighted avg cycle time", body: "Estate cycle time weighted by each process's volume.\n\n`sum(cycle time × attempts) ÷ attempts`" },
      { id: "m-activedays", title: "Active days in range / Avg cases per day", body: "Days in the window with any activity, and attempts divided by those days." },
      { id: "m-timesaved", title: "Colleague time saved / released", body: "Hours of colleague effort displaced by completed automations.\n\n`sum(completed × SMV minutes) ÷ 60` · Up is good" },
      { id: "m-gross", title: "Gross benefit", body: "Money value of the displaced colleague time.\n\n`hours saved × grade rate in force on the outcome date` for each process, where a hub's own rate for a grade wins over the universal rate. With the what-if slider, `hours × flat rate` instead." },
      { id: "m-cost", title: "Estate cost / Automation cost", body: "Fully loaded cost of running the automations, apportioned by bot time.\n\n`worktime × (CoE pool £ per bot-second + hub pool £ per bot-second)`. The CoE pool is the CoE team's daily run-rate plus CoE-owned VDIs' daily cost, spread across all work that day. A hub's pool is its own team's daily run-rate plus its own VDIs' daily cost, spread across that hub's work that day. Idle time is never a denominator." },
      { id: "m-net", title: "Net benefit", body: "What is left after paying for the automation.\n\n`gross benefit − estate cost` · Up is good · Annual target per hub and for the estate (none set today)" },
      { id: "m-cpc", title: "Cost per completed case", body: "Average estate cost of completing one case.\n\n`estate cost ÷ completed` · Down is good · Target ≤ £9.00" },
      { id: "m-fte", title: "FTE released", body: "Colleague full-time-equivalents released.\n\n`hours saved ÷ (window days × 252 ÷ 365.25 × 7.5 hours)` using 252 working days and 7.5 productive hours per day" },
      { id: "m-netfte", title: "Net/FTE value", body: "Net benefit per FTE released, a measure of value density.\n\n`net benefit ÷ FTE released`, shown as — when no FTE was released" },
      { id: "m-roi", title: "ROI / Return on automation", body: "Gross benefit earned per £1 of estate cost.\n\n`gross benefit ÷ estate cost`, shown as a multiple such as 1.4×" },
      { id: "m-runrate", title: "Annualised run-rate net", body: "The window's net scaled to a year.\n\n`net benefit × 365.25 ÷ window days`" },
      { id: "m-payback", title: "Payback", body: "Months of run-rate net needed to repay this period's estate cost.\n\n`estate cost ÷ (run-rate net ÷ 12)`, shown as — when net is not positive" },
      { id: "m-teams", title: "Teams (people cost)", body: "The people half of estate cost: the CoE team and every hub's own automation team, apportioned by bot time. Teams plus Machines always equals estate cost to the penny." },
      { id: "m-machines", title: "Machines (VDIs)", body: "The machine half of estate cost: CoE-owned and hub-owned VDI licence cost, apportioned by bot time." },
      { id: "m-unattributed", title: "Unattributed idle (memo)", body: "Pool cost on days when nothing ran anywhere. Shown on the waterfall so total spend reconciles; never subtracted from Net." },
      { id: "m-rework", title: "Exception cost / Exception rework cost", body: "An upper bound on what it would cost a colleague to redo the failed items.\n\n`exception count × SMV minutes ÷ 60 × grade rate in force on the exception date`, split into business and system. Not the bot runtime cost of the failures." },
      { id: "m-margin", title: "Margin % (Spoke P&L)", body: "Share of a hub's gross benefit left as net.\n\n`net ÷ gross`" },
      { id: "m-fytd", title: "FY-to-date net and prior FYTD", body: "Net benefit from the fiscal-year start to the data-through date, independent of the date filter, and the same number of days into the previous fiscal year. Fiscal year starts in April by default." },
      { id: "m-projected", title: "Projected FY-end and vs target", body: "`FYTD net + (window net ÷ window days) × days remaining in the fiscal year`, compared with the annual target; on track when the projection meets the target." },
      { id: "m-trend12", title: "12-week trend (Spoke P&L)", body: "Weekly net for the 12 weeks ending at the window end, regardless of the date filter. Green when the last week is at or above the first." },
      { id: "m-pareto", title: "80% of positive net", body: "The smallest number of processes whose cumulative net benefit reaches 80% of all positive net." },
      { id: "m-smv", title: "SMV (standard minutes value)", body: "The minutes a colleague would take to do one case by hand. Set per process in Administration. Drives benefit and rework cost." },
      { id: "m-graderate", title: "Grade rate", body: "The hourly cost of the colleague grade a process automates against, effective-dated, universal or overridden per hub. Described as the single most sensitive number on the dashboard." },
      { id: "m-blendedrate", title: "Human cost assumption (blended rate)", body: "The effective average rate behind every benefit figure.\n\n`gross benefit ÷ hours saved`, or the flat what-if rate when the slider is used" },
      { id: "m-activehours", title: "Active hours / Productive bot time", body: "Hours a digital worker actually spent running work." },
      { id: "m-available", title: "Licensed capacity / Available hours", body: "Hours a digital worker was licensed and available.\n\n`covered days in the window × 20 operating hours per day`. A day is covered when the VDI is inside its 365-day renewal window and not expired or retired." },
      { id: "m-util", title: "Utilisation", body: "How much of the licensed time was productive.\n\n`active hours ÷ available hours`, capped at 100% · Healthy band 15% to 60%" },
      { id: "m-idle", title: "Idle % and Spare capacity", body: "Share of licensed time with nothing to do, and the total idle hours across machines that had work." },
      { id: "m-costshare", title: "Estate cost share (per VDI)", body: "The machine's slice of apportioned estate cost, using the same day and hub bot-time share as process cost." },
      { id: "m-stale", title: "Stale VDI", body: "A machine that has history but no cases for more than the review threshold (14 days by default). Surfaces as a warning alert and in the VDI review queue." },
      { id: "m-notshown", title: "Carried in the data but not shown", body: "Pending or deferred item counts, retry counts, item priority and deferred dates exist in the source data but are not surfaced on any visual today." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "money-rules",
    title: "How money is calculated",
    intro: "The rules the whole dashboard follows. An automated check proves the browser and the warehouse agree to four decimal places.",
    items: [
      { id: "mr-benefit", title: "Benefit rule", body: "Benefit is valued at the grade rate in force on the day each case completed. Changing a rate today never changes history. A hub-specific rate for a grade wins over the universal rate." },
      { id: "mr-cost", title: "Cost rule", body: "Cost rides on the work that ran. The CoE's shared team and machines are spread across all work by bot time; each hub's own team and machines are spread across that hub's work only." },
      { id: "mr-people", title: "People cost rule", body: "Each owner's people-cost record (the CoE and each hub) becomes a daily run-rate: annual cost ÷ 365.25. Records are effective-dated and never edited once past; a change is a new record from a chosen date. Only automation delivery and support headcount belongs here, never the business team whose work is automated, because their effort is already counted as benefit." },
      { id: "mr-vdi", title: "VDI cost rule", body: "A renewal buys 365 days of coverage at the class rate (or a per-VDI override), spread evenly across those days. A licence expiry or a retirement ends coverage early. A class-rate change takes effect for each VDI at its next renewal, never mid-cycle." },
      { id: "mr-split", title: "Cost presentation", body: "On the dashboard cost is shown as Teams and Machines (VDIs), by kind of cost rather than by owner. The two reconcile to estate cost to the penny." },
      { id: "mr-rework", title: "Exception rework rule", body: "Failed items are valued as if a colleague redid them: SMV × grade rate on the exception date. It is an upper bound, because some retried items later completed." },
      { id: "mr-fy", title: "Fiscal year rule", body: "Fiscal-year-to-date figures run from the fiscal-year start month (April by default, changeable by an admin) to the data-through date and ignore the date filter." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "alerts",
    title: "Thresholds and alerts",
    intro: "Alerts evaluate the trailing seven days of the latest data at four levels: estate, spoke, process and VDI.",
    items: [
      {
        id: "al-thresholds",
        title: "Threshold settings and defaults",
        table: {
          headers: ["Setting", "Default", "Direction", "Evaluated at", "Can be overridden per"],
          rows: [
            ["Completion rate", "95%", "Floor (≥)", "Estate, spoke, process", "Spoke, process"],
            ["Exception rate", "6%", "Ceiling (≤)", "Estate, spoke, process", "Spoke, process"],
            ["System exception rate", "3%", "Ceiling (≤)", "Estate, spoke, process", "Spoke, process"],
            ["Cost per case", "£9.00", "Ceiling (≤)", "Estate, spoke, process", "Spoke, process"],
            ["Utilisation minimum", "15%", "Floor", "VDI (via its spoke)", "Spoke"],
            ["Utilisation maximum", "60%", "Ceiling", "VDI (via its spoke)", "Spoke"],
            ["Idle VDI review threshold", "14 days", "Ceiling", "VDI", "Spoke"],
          ],
        },
      },
      { id: "al-resolution", title: "Which threshold applies", body: "A process override wins; otherwise the process's spoke override; otherwise the global target." },
      { id: "al-severity", title: "Breach versus warning", body: "Past the threshold is a **breach**. Within a 10% early-warning band of it is a **warning**. For a floor such as completion rate, the band is 10% of the remaining headroom to 100%, so a 95% floor warns below 95.5%. For a ceiling, the band is 10% below it, so a 6% ceiling warns above 5.4%." },
      { id: "al-guard", title: "Volume guard", body: "A process with fewer than 30 completed-plus-exception items in the seven-day window is not evaluated, so a one-item process at 100% exceptions is not treated as a signal." },
      { id: "al-stale", title: "Stale VDI warning", body: "A machine with no cases for longer than the review threshold raises a warning (never a breach) reading, for example, *VDI-RPA-COM-04 — no cases for 21 days (last case 23 Jun) — review for retirement*. Retired machines are skipped." },
      { id: "al-headlines", title: "Headline wording", body: "Examples: *Estate — Completion rate 91.2%, below the 95.0% floor*; *Consumer Lending — System exception rate 7.2%, above the 5.0% ceiling*; warnings say *only just above the floor* or *approaching the ceiling (warning: within the early-warning band)*." },
      { id: "al-channels", title: "Delivery channels", body: "Alerts appear in the header bell, the Alerts page and the command palette. Nothing is pushed to email or Teams today." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "admin",
    title: "Administration",
    intro:
      "Where reference data is maintained. Every save updates every chart immediately. Hub leads see every hub but can edit only their own; admins can edit everything. Past dated records are locked so history is never rewritten; a change is always a new record from a chosen date.",
    items: [
      { id: "ad-squads", title: "Squads (spokes) — admin only", body: "Add or rename a spoke, set its short code and its light and dark accent colours, with a live contrast check (3:1 minimum). A new spoke is available in every picker immediately and shows activity once its processes have data. Spokes cannot be deleted." },
      { id: "ad-processes", title: "Propositions & processes — hub lead for own spoke", body: "Per spoke: add, edit or delete propositions; add, edit or delete processes with name, acronym, proposition, SMV minutes, grade (limited to grades in scope for the spoke), active flag, icon, tags and description; map Blue Prism queue names to processes with optional stage name and order. A proposition with processes, or a process with a mapped queue, cannot be deleted until reassigned." },
      { id: "ad-people", title: "People costs — hub lead for own spoke; CoE record admin only", body: "Per owner (CoE or a spoke): effective-dated records of headcount and annual cost with an optional note. New records cannot be backdated. A future record can be edited or deleted; the most recent record can be deleted to undo a mistake; older records are locked." },
      { id: "ad-vdi", title: "VDI estate — hub lead for own spoke; shared machines admin only", body: "Per owner: every machine with cost class, renewal date, annual cost override, licence expiry, status, current coverage window, and first and last case seen. Actions: edit, **Renew** (books a full year from a chosen date), **Retire** (from a chosen date), **Add VDI**. Machines seen in the data but not yet registered appear as **Unregistered — complete registration** with a one-step Register form. A **Review queue** lists machines idle beyond the threshold with a one-click Retire." },
      { id: "ad-vdirates", title: "VDI class-rate card", body: "The annual list price per machine for each cost class, effective-dated, universal (admin) or overridden per spoke (hub lead). Admins can make a backdated correction behind a confirmation that warns it revalues reported cost history." },
      { id: "ad-targets", title: "Targets & thresholds", body: "Global targets (admin): completion rate, exception rate, system exception rate, cost per case, utilisation minimum and maximum, idle VDI review days, and the fiscal-year start month. Spoke and process overrides (hub lead for own spoke) for the rate and cost metrics; utilisation and idle thresholds per spoke only. Net benefit targets: an estate target (admin) and a per-spoke annual target (hub lead for own spoke), used by Value & Finance." },
      { id: "ad-grades", title: "Grade rate card — definitions admin only; hub overrides by hub lead", body: "Grade definitions with code, name and scope (all spokes or named spokes); a grade in use cannot be deleted or narrowed. Per grade: an effective-dated universal hourly rate (admin) and per-spoke override rates (hub lead), with the same history locking and admin-only backdated corrections." },
      { id: "ad-patterns", title: "Exception patterns — admin only", body: "The ordered list of text patterns that classify a raw exception reason as System or Business. Explicit prefixes on the reason always win. Changes apply from the next data build." },
      { id: "ad-users", title: "Users & roles — admin only", body: "A working stand-in for the demo directory: name, email, roles, spokes, passphrase reset, remove. In production this is replaced by Entra ID group membership." },
      { id: "ad-sync", title: "Data & sync", body: "Download the current reference data as JSON or as a SQL script; a change log of every save (when, section, who); and, for editors, a guarded **Discard local edits**." },
      { id: "ad-conflict", title: "Concurrent edits", body: "In production every save is version-checked. If someone else saved first, a dialog names them and the time, lists the sections that differ, and requires a choice: **Reload theirs** or **Overwrite with mine**. Every accepted write is logged with who and when." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "reference-data",
    title: "Reference data loaded today",
    intro: "Please check your hub's rows. These figures drive every benefit and cost number.",
    items: [
      {
        id: "rd-spokes",
        title: "Spokes",
        table: {
          headers: ["Spoke", "Short code"],
          rows: [
            ["Insurance, Pensions & Investments", "IP&I"],
            ["Risk", "RSK"],
            ["Commercial", "COM"],
            ["Consumer Lending", "CLD"],
          ],
        },
      },
      {
        id: "rd-processes",
        title: "Processes, SMV and grade",
        table: {
          headers: ["Spoke", "Proposition", "Process", "Acronym", "SMV (min)", "Grade", "Queue(s)", "Tags"],
          rows: [
            ["IP&I", "General Insurance", "Insurance New Business", "INB", "18", "OPS3", "INSURANCE_NEW_BUS", "Onboarding; Customer-facing"],
            ["IP&I", "General Insurance", "Insurance Renewals", "IRN", "12", "OPS3", "INSURANCE_RENEWALS", "Renewals; Batch"],
            ["IP&I", "Home Insurance", "Home Claims", "HCL", "35", "SOPS", "HOME_CLAIMS", "Claims; Customer-facing"],
            ["IP&I", "Pensions", "Pension Transfers", "PTR", "55", "PSPC", "PENSIONS_TRANSFER (Initiation), PENSIONS_TRF_FINAL (Completion)", "Transfers; Regulatory"],
            ["IP&I", "Pensions", "Pension Valuations", "PVL", "10", "PANL", "PENSIONS_VALUATION", "Valuations; Batch"],
            ["IP&I", "Life & Protection", "Life Underwriting", "LUW", "40", "UWSP", "LIFE_UNDERWRITING", "Underwriting; Regulatory"],
            ["IP&I", "Investments", "Investment Rebalancing", "IRB", "22", "IANL", "INVEST_REBALANCE", "Batch"],
            ["IP&I", "Investments", "Investment Onboarding", "ION", "45", "KYCS", "INVEST_ONBOARDING", "Onboarding; KYC"],
            ["Risk", "Financial Crime", "Sanctions Screening Referrals", "SSR", "15", "RANL", "RISK_SANCTIONS", "Screening; Regulatory"],
            ["Risk", "Financial Crime", "Fraud Case Triage", "FCT", "30", "RANL", "RISK_FRAUD_TRIAGE", "Triage; Regulatory"],
            ["Commercial", "Commercial Insurance", "Commercial Quote Ingestion", "CQI", "25", "CUAS", "COMM_QUOTE_INGEST", "Onboarding; Batch"],
            ["Commercial", "Commercial Insurance", "Broker Commission Reconciliation", "BCR", "20", "FANL", "COMM_BROKER_RECON", "Reconciliation; Batch"],
            ["Consumer Lending", "Personal Loans", "Loan Application Processing", "LAP", "28", "LOPS", "LEND_APPLICATIONS", "Onboarding; Customer-facing"],
            ["Consumer Lending", "Personal Loans", "Arrears Payment Plans", "APL", "22", "LOPS", "LEND_ARREARS_PLANS", "Collections; Customer-facing"],
          ],
        },
      },
      {
        id: "rd-grades",
        title: "Grades and hourly rates",
        body: "All rates are universal today; no hub overrides are set. CL-SUP is scoped to Consumer Lending only.",
        table: {
          headers: ["Grade", "Name", "£/hour from 1 Jan 2023", "£/hour from 1 Apr 2026"],
          rows: [
            ["OPS3", "Ops Grade 3", "28.00", "29.00"],
            ["SOPS", "Senior Ops", "32.00", "33.20"],
            ["PSPC", "Pensions Specialist", "38.00", "39.40"],
            ["PANL", "Pensions Analyst", "30.00", "31.10"],
            ["UWSP", "Underwriting Support", "42.00", "43.50"],
            ["IANL", "Investment Analyst", "36.00", "37.30"],
            ["KYCS", "KYC Specialist", "40.00", "41.40"],
            ["RANL", "Risk Analyst", "34.00", "35.20"],
            ["CUAS", "Commercial Underwriting Assistant", "36.00", "37.30"],
            ["FANL", "Finance Analyst", "32.00", "33.10"],
            ["LOPS", "Lending Ops", "27.00", "28.00"],
            ["CL-SUP", "Consumer Lending Support", "26.00", "—"],
          ],
        },
      },
      {
        id: "rd-people",
        title: "People cost records",
        table: {
          headers: ["Owner", "Headcount", "Annual cost", "Effective from"],
          rows: [
            ["CoE", "14", "£780,000", "1 Jan 2023"],
            ["CoE", "16", "£860,000", "1 Apr 2025"],
            ["Insurance, Pensions & Investments", "4", "£220,000", "1 Jan 2023"],
            ["Risk", "2", "£112,000", "1 Jan 2023"],
            ["Commercial", "2", "£106,000", "1 Jan 2023"],
            ["Consumer Lending", "3", "£152,000", "1 Jan 2023"],
          ],
        },
      },
      {
        id: "rd-vdis",
        title: "VDI estate",
        body: "Twelve machines. Operating hours: 20 per day.",
        table: {
          headers: ["Resource", "Owner", "Class", "Active from", "Renewal", "Status", "Notes"],
          rows: [
            ["VDI-RPA-PROD-01", "IP&I", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-02", "IP&I", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-03", "IP&I", "prod", "1 Jan 2023", "1 Jan 2023", "Retired 31 Mar 2025", "Licence expired 31 Mar 2025"],
            ["VDI-RPA-PROD-04", "IP&I", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-05", "IP&I", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-06", "IP&I", "prod", "1 Jan 2023", "1 Jan 2023", "Active", "Deliberately idle in the demo data"],
            ["VDI-RPA-PROD-07", "IP&I", "prod", "1 Jun 2025", "1 Jun 2025", "Active", "£10,200 negotiated override"],
            ["VDI-RPA-PROD-08", "Risk", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-09", "Commercial", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-10", "Consumer Lending", "prod", "1 Jan 2023", "1 Jan 2023", "Active", ""],
            ["VDI-RPA-PROD-11", "Consumer Lending", "prod", "1 Sep 2025", "1 Sep 2025", "Active", "Added Sep 2025"],
            ["VDI-RPA-TEST-01", "CoE (shared/test)", "test", "1 Jan 2023", "1 Jan 2023", "Active", "Hub-owned test machine"],
          ],
        },
      },
      {
        id: "rd-vdirates",
        title: "VDI class rates (annual, per machine)",
        table: {
          headers: ["Class", "From 1 Jan 2023", "From 1 Jul 2025"],
          rows: [
            ["prod", "£9,000", "£9,600"],
            ["test", "£6,000", "£6,400"],
          ],
        },
      },
      {
        id: "rd-targets",
        title: "Targets in force",
        body: "Completion rate 95%; exception rate 6%; system exception rate 3%; cost per case £9.00; utilisation 15% to 60%; idle VDI review 14 days; fiscal year starts April. No spoke or process overrides and no net benefit targets are set yet.",
      },
      {
        id: "rd-patterns",
        title: "Exception classification patterns",
        body: "System: timeout, not found on screen, failed to launch, login failed, dialog, citrix, connection, session disconnected. Business: not found in core system, invalid for processing, documentation, outside tolerance, duplicate, manual referral, incomplete.",
      },
      {
        id: "rd-assumptions",
        title: "Working assumptions",
        body: "252 working days per year and 7.5 productive hours per day for FTE conversion. 20 VDI operating hours per day for capacity.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "roles",
    title: "Roles and sign-in",
    items: [
      {
        id: "ro-matrix",
        title: "Four roles",
        table: {
          headers: ["Role", "Sees", "Can edit"],
          rows: [
            ["Admin", "Every page including Administration, Data model and Playbook", "Everything, including estate-wide settings and backdated corrections"],
            ["Hub lead", "Every dashboard page and Administration", "Only their own hub's propositions, processes, queue mappings, people costs, VDIs, grade-rate overrides, threshold overrides and net benefit target"],
            ["Hub member", "Every dashboard page and Administration, read-only", "Nothing; can export reference data"],
            ["Business user", "Dashboard pages only, alerts scoped to their hub", "Nothing"],
          ],
        },
      },
      {
        id: "ro-entra",
        title: "Production sign-in",
        body: "Sign in with Microsoft (Entra ID). Group membership maps to a role and hub: SG-RPA-Admins → Admin; SG-RPA-IPI-Lead, SG-RPA-RSK-Lead, SG-RPA-COM-Lead, SG-RPA-CLD-Lead → Hub lead for that hub; SG-RPA-HubMembers → Hub member; SG-RPA-BusinessUsers → Business user. Anyone signed in with no matching group is a Business user. The server re-checks permission on every write.",
      },
      {
        id: "ro-demo",
        title: "Demo sign-in",
        body: "Six seeded accounts sharing the passphrase *demo*: an admin, hub leads for IP&I and Risk, a CoE hub member, and business users for Commercial and Consumer Lending. Used for demonstrations only.",
      },
      {
        id: "ro-server",
        title: "Server-side enforcement",
        body: "The interface hides what a user may not change, and the data API rejects any write outside the user's permissions regardless of what the browser sent.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "export-format",
    title: "Export and how numbers are shown",
    items: [
      {
        id: "ex-csv",
        title: "CSV export",
        body: "Available on the Watchlist, Alerts, Process league table, Exception detail, VDI capacity table, Spoke P&L and Cumulative benefit vs cost. The file contains exactly the rows on screen after filters, sorting and search, named **{table}-{data-through date}.csv**. Values that look like spreadsheet formulas are neutralised so nothing runs when opened in Excel.",
      },
      {
        id: "ex-numbers",
        title: "Number conventions",
        body: "Money is compact on tiles and axes (£382.7k, £1.0M) and in full elsewhere (£53,320), with pence only below £100. A negative sign always comes before the £. Percentages show one decimal. Durations read 45s, 10m 21s, 1h 04m. Anything that cannot be computed shows as — rather than a misleading zero. Dates are UK format.",
      },
      {
        id: "ex-colour",
        title: "Colour conventions",
        body: "Red means a negative or a breach, never a neutral series. Each hub has its own accent colour used for swatches, rails, tints and chart series, never as a fill behind text. Positive is green, warning is amber.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "accessibility",
    title: "Accessibility and personalisation",
    intro: "Opened with Shift+A or the header icon. Every setting is remembered per user.",
    items: [
      { id: "ac-theme", title: "Theme and contrast", body: "Light, Dark, or High contrast (true black and white, visible borders, no reliance on colour or shadow alone). Follows the operating system by default." },
      { id: "ac-glass", title: "Liquid glass", body: "Translucent surfaces on the navigation, filter band, menus and dialogs. Can be switched off, and switches itself off in high contrast or when the device asks for reduced transparency." },
      { id: "ac-text", title: "Text size", body: "100%, 115% or 130%, scaling text and layout together." },
      { id: "ac-dyslexia", title: "Dyslexia-friendly mode", body: "A clearer humanist font with more letter and line spacing, following British Dyslexia Association guidance." },
      { id: "ac-bionic", title: "Bionic reading", body: "Bolds the start of each word in descriptions to guide the eye; never applied to chart numbers or axis labels." },
      { id: "ac-ruler", title: "Reading ruler", body: "A soft highlighted band that follows the pointer or keyboard focus." },
      { id: "ac-cvd", title: "Colour-vision-safe palette", body: "Swaps chart colours for a palette distinguishable with the most common forms of colour blindness and adds distinct line patterns." },
      { id: "ac-motion", title: "Reduce motion", body: "Turns off animations and transitions; otherwise the device setting is followed." },
      { id: "ac-personal", title: "Personalisation", body: "A greeting by first name with a small seasonal accent, and live UK and India clocks in the header. Both can be turned off." },
      { id: "ac-keyboard", title: "Keyboard and screen readers", body: "A skip-to-content link, visible focus outlines everywhere, focus returned to the opener when a dialog closes, keyboard-only operation of every control, tooltips on collapsed navigation items, and announcements for page changes, filter counts, results and new alerts." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "platform",
    title: "Platform, freshness and resilience",
    items: [
      { id: "pl-cadence", title: "Refresh cadence", body: "Data is pulled from Elastic every 15 minutes. Each pull re-reads a 24-hour overlap so an item that changed state late is never missed, and the merge is safe to repeat." },
      { id: "pl-history", title: "History", body: "The demonstration data spans January 2025 to July 2026. In production, history depth is set by Elastic retention; an initial backfill loads older history in bounded windows." },
      { id: "pl-loading", title: "Loading and errors", body: "A themed loading skeleton appears instantly. If data cannot be loaded, a plain-English error offers **Retry** without reloading the page. A fault on one page shows **This page went wrong** with **Try again** while the rest of the dashboard keeps working. Background errors appear as a dismissable notice." },
      { id: "pl-stale", title: "When the data service is down", body: "The last loaded data stays on screen, the header dot turns amber with an explanation, and the dashboard recovers automatically on the next successful check." },
      { id: "pl-session", title: "Session expiry", body: "One silent token renewal is attempted; if that fails you are asked to sign in again." },
      { id: "pl-hosting", title: "Hosting", body: "Google Cloud: Cloud SQL for SQL Server as the warehouse, a scheduled Cloud Run job for the pull, and Cloud Run services for the data API and the dashboard, behind a single HTTPS load balancer in production." },
      { id: "pl-scale", title: "Scale", body: "Designed and indexed for 50 to 100 million work items; the path to 250 to 500 million is documented (monthly partitioning, materialised aggregates, server-side paging for item-level search)." },
      { id: "pl-browsers", title: "Browser support", body: "Current versions of Edge, Chrome, Safari and Firefox are expected to work. No formal supported-browser statement exists yet; the glass effect degrades gracefully on older engines." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "gaps",
    title: "Known gaps and limitations",
    intro: "What we already know is missing or constrained. Please confirm, reprioritise or add to this list.",
    items: [
      { id: "gp-channels", title: "No email or Teams alerts", body: "Alerts are in-app only. Pushing to email or Teams needs a small scheduled job in the data API." },
      { id: "gp-itemlevel", title: "No item-level search", body: "Pages show aggregates by day, process and reason. There is no search for an individual case reference or item." },
      { id: "gp-pending", title: "Pending, deferred, retries and priority not shown", body: "These fields exist in the source but have no visual today." },
      { id: "gp-queuecascade", title: "Queue filter is not narrowed", body: "The queue list always shows all 15 queues regardless of the spoke or process selected." },
      { id: "gp-patterns", title: "Exception reclassification is not retroactive", body: "A changed pattern applies from the next data build only." },
      { id: "gp-baked-lines", title: "Target lines on charts come from the data build", body: "Changing a target in Administration changes the alerts immediately but the dashed reference lines on Input & Outcome, Capacity and Commercial update at the next data build." },
      { id: "gp-hubvdi", title: "Hub-owned VDI alerts are not shown to hub users", body: "A deliberate choice: shared and test machines are a CoE concern." },
      { id: "gp-views", title: "Saved views cannot be renamed or shared", body: "Views are private to the user; re-saving under a new name is the workaround." },
      { id: "gp-filters", title: "Filters are not remembered between visits", body: "Every visit starts at All spokes and Last 90 days unless a saved view is applied." },
      { id: "gp-targets", title: "No net benefit targets set", body: "FY attainment and the vs-target column stay empty until an admin or hub lead enters targets." },
      { id: "gp-overrides", title: "No hub-specific rates or thresholds set", body: "All grade rates, VDI class rates and thresholds are universal today." },
      { id: "gp-browsers", title: "No supported-browser statement", body: "To be agreed with IT." },
      { id: "gp-ack", title: "Acknowledgements reset with each data build", body: "By design, so a persisting breach resurfaces; there is no snooze." },
      { id: "gp-noundo", title: "No undo for reference edits", body: "Writes are versioned and logged, but reverting means re-entering the previous value." },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "questions",
    title: "Questions for your hub",
    intro: "The answers we most need. A short note against each is enough.",
    items: [
      { id: "q-metrics", title: "Which measures are missing?", body: "Is there a number your hub reports today, or is asked for, that the dictionary does not contain?" },
      { id: "q-definitions", title: "Do the definitions match yours?", body: "In particular completion rate, exception rate, cost per case, and the treatment of business versus system exceptions." },
      { id: "q-smv", title: "Are the SMVs and grades right?", body: "Section 17 lists each process's standard minutes and the grade it automates against." },
      { id: "q-people", title: "Is your people cost record right?", body: "Headcount and annual cost for your automation delivery and support team only." },
      { id: "q-vdis", title: "Is your VDI list complete and correct?", body: "Machines, cost class, renewal dates, and anything that should be retired." },
      { id: "q-targets", title: "What should your targets be?", body: "Completion, exception and cost-per-case thresholds for your hub, and an annual net benefit target." },
      { id: "q-alerts", title: "Who should receive alerts and how?", body: "In-app only, or email or Teams as well, and to whom." },
      { id: "q-cadence", title: "Is a 15-minute refresh right?", body: "Faster, slower, or does it not matter for your use?" },
      { id: "q-access", title: "Who in your hub needs access, and at what role?", body: "Names or groups for hub lead, hub member and business user." },
      { id: "q-pages", title: "Which pages will you actually use, and what is missing from them?", body: "Anything you would expect to see on a page that is not there." },
      { id: "q-export", title: "What do you need to export or share?", body: "Tables, images, scheduled reports, or a link into a specific filtered view." },
    ],
  },
];
