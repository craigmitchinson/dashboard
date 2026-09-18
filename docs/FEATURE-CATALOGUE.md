<!-- GENERATED FILE — do not hand-edit. Edit docs/feature-catalogue.data.mjs and run "node tools/build-feature-catalogue.mjs" to regenerate. -->

# Intelligent Automation Performance Dashboard

## Feature and metric catalogue for hub review

Version 1.1 · 2026-09-18

**Audience:** Hub leads and squad members in Insurance, Pensions & Investments; Risk; Commercial; Consumer Lending; and the CoE team.

This catalogue lists everything the dashboard shows and does today, with the definition and formula behind every number. Please review it against what your hub needs and tell us, item by item, whether it meets the need, partly meets it, or leaves a gap.

### How to review

- Work through the sections that matter to your hub. Every item is numbered so you can refer to it in your reply.
- For each item tell us whether it Meets your need, Partly meets it, or leaves a Gap, with a short note wherever it is Partly or Gap or the definition does not match how your hub measures things.
- Section 24 lists the questions we most need answered. Section 23 lists what we already know is missing, so you can confirm or reprioritise.
- Section 18 shows the reference data loaded today. If a rate, SMV, grade, VDI or people-cost figure for your hub is wrong, tell us the right one.
- Reply with comments in this document, or a list of item numbers and verdicts, to the CoE team.

## Contents

- 1. What the dashboard is
- 2. Filters, navigation and saved views
- 3. Page: Overview
- 4. Page: Alerts
- 5. Page: Input & Outcome
- 6. Page: Process Analysis
- 7. Page: Exceptions
- 8. Page: Process detail
- 9. Page: VDI & Capacity
- 10. Page: Executive Summary
- 11. Page: Value & Finance
- 12. Page: Commercial Performance
- 13. Pages: Data model and Playbook (admin)
- 14. Metric dictionary
- 15. How money is calculated
- 16. Thresholds and alerts
- 17. Administration
- 18. Reference data loaded today
- 19. Roles and sign-in
- 20. Export and how numbers are shown
- 21. Accessibility and personalisation
- 22. Platform, freshness and resilience
- 23. Known gaps and limitations
- 24. Questions for your hub

## 1. What the dashboard is

A web dashboard for the Intelligent Automation Centre of Excellence and its hubs. It shows how our Blue Prism automations perform, what they cost, and what they are worth, at estate, hub, proposition and process level. It is not Power BI: it is a purpose-built web application with its own sign-in, roles, alerts and administration.

### 1.1 Hub and spoke model

The CoE is the hub. Each hub (Insurance, Pensions & Investments; Risk; Commercial; Consumer Lending) is a spoke that owns its own processes, people and machines. Every page can be viewed for the whole estate or narrowed to one spoke.

### 1.2 Where the data comes from

Blue Prism ships work-queue activity into Elastic (the Kibana log store) via Data Gateways. A scheduled job pulls the change every 15 minutes into our own SQL Server warehouse, where it is aggregated. Money is calculated from those aggregates and our reference data using one set of rules, held in the SQL views and mirrored in the browser; an automated parity check proves the two agree.

### 1.3 Thirteen pages in six groups

Executive Summary and Value & Finance and Commercial Performance (Value group); Overview and Alerts (Overview group); Input & Outcome, Process Analysis, Exceptions and Process detail (Operate); VDI & Capacity (Optimise); Administration (Manage); Data model and Playbook (Reference, admin only). Pages a user may not see are removed from the navigation entirely.

| Group | Page | What it answers | Who sees it |
| --- | --- | --- | --- |
| Overview | Overview | How is the estate doing right now? | Everyone |
| Overview | Alerts | What needs attention today? | Everyone, scoped to their hub |
| Operate | Input & Outcome | What came in, and what happened to it? | Everyone |
| Operate | Process Analysis | Which processes are healthy, which are not? | Everyone |
| Operate | Exceptions | What is failing, and why? | Everyone |
| Operate | Process detail | One process in depth | Everyone |
| Optimise | VDI & Capacity | Are our machines used well? | Everyone |
| Value | Executive Summary | Headline numbers for the exec and finance, for the estate or one hub | Everyone, scoped to their hub |
| Value | Value & Finance | What is automation worth, net? | Everyone |
| Value | Commercial Performance | What is the ROI, per case, per process? | Everyone |
| Manage | Administration | Where reference data is edited | Admin, hub lead, hub member |
| Reference | Data model | How the data is structured | Admin |
| Reference | Playbook | How the platform is run | Admin |

### 1.4 Data freshness indicator

The header always shows **Data to {date} · {rows}**: the latest outcome date loaded and the number of source queue items behind it. Every date window on every page ends at that date, not at today. The dot beside it turns amber with the message **API unreachable — showing last loaded data** if the data service cannot be reached; the last good data stays on screen.

## 2. Filters, navigation and saved views

The same six filters sit under the header on every data page and apply to every visual on that page.

### 2.1 Spoke filter

Options: **All spokes (hub)** plus each spoke with its colour dot. Choosing a spoke resets Proposition, Process name and Queue name, and tints the whole application in that spoke's colour so it is always obvious which hub you are looking at.

### 2.2 Proposition filter

Options narrow to the selected spoke. Choosing a proposition resets Process name and Queue name. Propositions today: General Insurance, Home Insurance, Pensions, Life & Protection, Investments, Financial Crime, Commercial Insurance, Personal Loans.

### 2.3 Process name filter

Options narrow to the selected spoke and proposition. Choosing a process resets Queue name and shows a **Process: {name}** chip under the filter bar with an × to clear it.

### 2.4 Queue name filter

Cascades with the filters above it: options narrow to the queues belonging to the processes of the selected spoke, proposition and process, the same way the Process name filter narrows to the selected spoke and proposition. With nothing else selected, all 15 Blue Prism queue names are offered.

### 2.5 Tags filter (multi-select)

Fourteen tags carried on processes: Batch, Claims, Collections, Customer-facing, KYC, Onboarding, Reconciliation, Regulatory, Renewals, Screening, Transfers, Triage, Underwriting, Valuations. A process matches if it carries any selected tag.

### 2.6 Date range

Presets: **Last 7 days**, **Last 30 days**, **Last 90 days** (default), **Year to date**, **All time**, **Custom range…** with From and To dates bounded by the data available. Every window ends at the data-through date. Every page compares the window against the immediately preceding window of equal length for its change arrows.

### 2.7 Reset

One button clears every filter back to defaults, including the what-if rate slider on Commercial Performance, and shows a count of the filters currently active.

### 2.8 Click to drill or cross-filter

Clicking a process bar on Overview or Process Analysis filters every page to that process. Clicking a watchlist or league-table row opens Process detail for it. Clicking a heatmap row on Exceptions toggles the filter. Opening an alert sets the spoke and process and goes to the relevant page.

### 2.9 Breadcrumb and Back

Process detail shows a breadcrumb back to the page the drill started from. The browser Back button also works and returns you to the same filtered state.

### 2.10 Saved views

Save the current filters, what-if rate and page under a name. Views are private to the signed-in user, listed under **Views** in the header and in the command palette, and can be renamed or deleted. Saving the same name again overwrites it. **Copy link** puts a shareable URL on the clipboard with the view encoded in the link's hash; opening it (by anyone) applies that view once, with no server round-trip and no sign-in requirement to decode it.

### 2.11 Command palette (Ctrl+K or Cmd+K)

A search box over everything: pages, **Drill into {process}**, **Filter to {spoke}**, saved views, the top five unacknowledged alerts, actions (reset filters, toggle theme, collapse navigation, accessibility settings, shortcuts, acknowledge all alerts, sign out) and, for admins, every Playbook section. Typing **>** searches actions only. Recent choices float to the top.

### 2.12 Keyboard shortcuts

Shown by pressing **?**.

| Keys | Action |
| --- | --- |
| ? | Show keyboard shortcuts |
| Ctrl+K / Cmd+K | Open the command palette |
| Shift+A | Open Accessibility & display settings |
| / | Focus the Spoke filter |
| [ | Collapse or expand the navigation |
| Esc | Close whatever is open |
| Alt+1 … Alt+9 | Go to the first nine pages in navigation order |

### 2.13 What is remembered between visits

Per signed-in user: saved views, the six filters and the what-if rate, the last page and navigation state, display settings, recent palette choices, and alert acknowledgements and snoozes. **Reset** clears the filters and what-if rate back to defaults (All spokes, Last 90 days) for that user; it does not delete saved views.

## 3. Page: Overview

Headline performance, outcome mix and the operational watchlist.

### 3.1 Six headline tiles

Each tile shows the value for the selected window, the change against the previous window, and a target status where a target exists.

| Tile | Shows | Change arrow | Target |
| --- | --- | --- | --- |
| Completion rate | Share of attempted cases completed first time | Up is good | On/Off target (≥ 95%) |
| Cost per completed case | Fully loaded estate cost per completed case | Down is good | ≤ £9.00 |
| Exceptions | Business plus system exceptions, with a daily sparkline | Down is good | — |
| Net/FTE value | Net benefit divided by FTE released; sub-line shows FTE released | — | — |
| Completed cases | Completed cases with a daily sparkline | Up is good | — |
| Colleague time saved | Hours of colleague effort displaced | Up is good | — |

### 3.2 Daily case flow

Line chart of cases per day by outcome: Completed, Business exception, System exception. Weekends are shaded. When the window is 60 days or more, a **Daily / 7-day avg** toggle overlays a moving average. Hovering shows the values for that day.

### 3.3 Watchlist

The five processes with the highest exception rate. Each row shows the process, its queue, the exception count, its estate cost and its exception rate, coloured red above the 6% target and amber within 10% of it. Click a row to open Process detail. Exportable to CSV.

### 3.4 Throughput by process

Horizontal bars for the seven processes with the most completed cases. Click a bar to filter every page to that process.

### 3.5 Outcome mix

A single stacked bar of Completed, Business exception and System exception with counts and shares, a daily share strip when the window exceeds 14 days, and the estate cost apportioned to the period.

## 4. Page: Alerts

Threshold breaches and early warnings. Alerts always evaluate the trailing seven days of the latest data; the date range filter does not apply.

### 4.1 Alert feed

Grouped by severity (Breaches first, then Warnings) and by owning hub, with Estate-wide alerts first. Within a group, unacknowledged alerts come before acknowledged ones. Each row shows the severity, the headline, a context line (process, proposition, spoke, or VDI), a seven-day sparkline with the threshold drawn as a dashed line, an **Open** button that goes to the relevant page with filters set, and **Acknowledge** or **Unacknowledge**.

### 4.2 Counts, filters and export

The top strip shows breach, warning and acknowledged counts for the current view, a **Hide acknowledged** switch, a **Show snoozed** switch (off by default), **Acknowledge all** for the filtered set, and CSV export. Scope chips filter to Estate, Spoke, Process or VDI alerts. The spoke, proposition and process filters also narrow the feed.

### 4.3 Who sees which alerts

Admins and CoE-wide users see every alert. A user attached to a hub sees estate-wide alerts plus alerts for their own hub, its processes and its VDIs. Alerts for hub-owned (shared or test) VDIs are also shown to a hub whose own processes actually ran on that machine — the machine stays a CoE concern, but its health affects that hub's own throughput too. A hub-owned VDI that never ran any of a hub's processes stays hidden from that hub.

### 4.4 Acknowledgement and snooze

**Acknowledge** is per signed-in user and expires automatically when a new data build moves the data-through date on, so a persisting problem resurfaces. **Snooze until resolved** is also per user, but survives a data build: it hides the alert for as long as the same underlying breach keeps recurring, and clears itself the first time that breach does not reappear. A **Show snoozed** toggle reveals snoozed alerts again, each with an **Unsnooze** action.

### 4.5 Header bell

The bell shows a count of unacknowledged alerts (9+ above nine), a preview of the worst five, **Acknowledge all**, and **View all alerts**. Screen readers are told when new alerts arrive. The navigation item for Alerts carries the same count.

## 5. Page: Input & Outcome

Case flow in and out, by outcome, daily or monthly.

### 5.1 Four tiles

**Volume in** (cases attempted), **Completed out** with its share of intake, **Business exceptions** with share of intake, **System exceptions** with share of intake.

### 5.2 Case flow: volume in and out by outcome

Line chart of intake (dashed) against Completed, Business exception and System exception. A **Daily / Monthly** toggle re-bins the chart to calendar months.

### 5.3 Outcome split over time

Completion % and Exception % over time with two dashed reference lines: the 95% completion target and the 6% exception ceiling.

### 5.4 Period summary

Cases attempted, Completed (straight-through), Business exceptions, System exceptions, Active days in range, and Average cases per active day.

## 6. Page: Process Analysis

Completion time, throughput and exception trends by process.

### 6.1 Process performance

Horizontal bars per process, switchable between **Avg completion time** (bot runtime per completed case, longest first, with case counts), **Throughput** (completed cases) and **Exception rate** (share of attempts ending in an exception). Click a bar to filter every page to that process.

### 6.2 Exception time trend

System and business exception volume over time, daily or monthly.

### 6.3 Process league table

Process, average cycle time, exception % and estate cost, sorted by cost. The exception % is coloured red above the exception rate target and amber within the same early-warning band the alerts use — both read live from Administration → Targets & thresholds, including any spoke override. A footer shows the weighted average cycle time across the estate. Click a row to open Process detail. Exportable to CSV.

## 7. Page: Exceptions

Exception heatmap and searchable detail.

### 7.1 Four tiles

**Total exceptions** with change against the previous window, **System exceptions** and **Business exceptions** each with their share of all exceptions, and **Exception cost (period)** split into business and system rework cost.

### 7.2 Exception heatmap

Processes down the side, exception types across the top as three-letter codes (hover for the full reason), with stronger colour meaning more exceptions. All 14 process rows are visible at once at a standard screen size, with no internal scroll needed. Each row has a total bar, and a footer totals each column. Click a process row to filter to it. System and business types are distinguished by colour.

### 7.3 Exception detail table

Every exception reason in the current filters with category, volume, share of total, rework cost and the most recent date seen. Switch between All, System and Business; search by name; sort any column. The table is a compact, three-row scrolling region — the rest of the page never scrolls to reach it. Exportable to CSV.

### 7.4 How an exception is classified

A reason already prefixed **Business Exception:** or **System Exception:** keeps that classification. Otherwise the reason text is matched against an ordered list of patterns maintained in Administration (for example anything containing *timeout* is System; anything containing *duplicate* is Business). Changing a pattern applies from the next data build; it does not re-tag history.

## 8. Page: Process detail

One process in depth. Reached by clicking a process anywhere, or from the chooser on the page.

### 8.1 Process chooser

When no process is selected: a **Needs attention** group of the three processes with the highest exception rate, then every process grouped by spoke, searchable by name, queue, spoke or acronym.

### 8.2 Process banner

Name and acronym, spoke, proposition, its queue and stages, and its tags, with a breadcrumb back to the page you came from and a **Clear drill** button.

### 8.3 Five tiles

**Completed** items, **Exceptions** with share of attempts, **Completion rate**, **Avg cycle time** (bot runtime per completed item), and **Estate cost** with cost per completed case.

### 8.4 Daily flow

Completed, business and system exceptions per day for this process.

### 8.5 Top exceptions

The seven most frequent exception reasons for this process, coloured by category, with the process's exception rework cost for the period.

### 8.6 Digital workers

Up to eight machines that ran this process in the period, with items processed and utilisation.

### 8.7 Process profile

The reference data behind the process: SMV in manual minutes per case, the colleague grade it automates against, that grade's current hourly rate, colleague time released in the period, and the process description.

## 9. Page: VDI & Capacity

Digital-worker utilisation, idle time and estate cost.

### 9.1 Four tiles

**Active digital workers** out of the estate total, **Average utilisation** against the 15% to 60% healthy band, **Spare capacity** in hours available for new automations, and **Estate cost (period)**.

### 9.2 Utilisation by digital worker

Bars per machine grouped by owning spoke: red at or above the maximum, green within the band, amber below the minimum. Low utilisation is spare capacity; high utilisation flags a bottleneck risk.

### 9.3 VDI capacity table

Per machine: spoke, processes run, items, active hours, idle % (red above 90%), utilisation bar, and estate cost share. Sortable and exportable to CSV.

### 9.4 Capacity & cost summary

A utilisation gauge against the healthy band, licensed capacity in hours, productive bot time in hours, and apportioned estate cost.

## 10. Page: Executive Summary

One screen of headline numbers for the exec and finance, for the whole estate or for a single hub. No slicer bar — it has its own period control and its own hub control, always anchored on the data-through date, never on today.

### 10.1 Hub control

A control beside the period control offering **Estate** plus every hub. A hub lead or business user (anyone scoped to one or more hubs) sees only their own hub(s) and no Estate option, defaulting to their first hub; an admin or CoE-wide user sees Estate plus every hub, defaulting to Estate. The choice is remembered per signed-in user. Selecting a hub re-scopes every figure on the page — KPIs, operations, estate health, the table, movers and the briefing — to that hub alone; nothing here compares hubs against each other.

### 10.2 Period control

**This month**, **Last month** (the full preceding calendar month), **Quarter to date** (the fiscal quarter containing the data-through date) or **FY to date**. Each is a fixed window ending at the data-through date; there is no custom range and the six slicers do not apply here.

### 10.3 Six KPI tiles

**Net benefit** with the change against the prior period, **Gross benefit**, **Estate cost** (or the hub's cost, once a hub is selected), **ROI**, **vs annual target** (fiscal-year-to-date net against the estate's — or the selected hub's own — annual net benefit target, or a prompt when none is set), and **Projected FY-end** at the current run-rate.

### 10.4 Operations this period

A compact grid, for the estate or the selected hub: Completed cases (with a trend sparkline), Completion rate, Exception rate, Cost per completed case, FTE released and Colleague hours saved — each with its change against the prior period, and a target-met dot on the three metrics that carry a target. The card title names the hub and period, e.g. "Operations this period — Risk — FY to date".

### 10.5 Estate health

Open breach and warning counts, active digital workers, average utilisation, spare capacity hours, and the three worst open alert headlines. Once a hub is selected this is scoped to that hub's own alerts, plus any estate-wide breach or warning — the same rule the Alerts page uses for a hub-scoped user.

### 10.6 By hub / By proposition table

On the **Estate** view: one row per hub — net benefit, fiscal-year-to-date net, attainment against that hub's annual target, completed cases, exception rate, cost per completed case, and a trend arrow against the prior period. Once a **hub** is selected this table becomes **By proposition** instead: the same figures (minus the hub-level target column) broken down one row per proposition within that hub. A total row reconciles to the KPI tiles either way.

### 10.7 Movers

The top three processes by net benefit, and the bottom three running at a loss, each with the reason it was flagged (the same fixed rules as Value & Finance's review candidates) — drawn only from the estate, or only from the selected hub's own processes.

### 10.8 Briefing

Three sentences generated from the live model, alerts and reference targets, scoped the same way as the rest of the page: a headline (fiscal-year-to-date net benefit and its target status), the highest-priority risk (the worst open breach, or the worst process exception rate above target when nothing has breached), and a recommended action (the top loss-making process and why).

### 10.9 Print and Copy figures

**Print** opens a print-friendly layout of the page. **Copy figures** copies every tile, table row and briefing sentence as tab-separated text to the clipboard, headed with the selected hub and period, for pasting into an email or a slide.

## 11. Page: Value & Finance

Net value, ROI, cost composition and run-rate forecast for finance and the executive.

### 11.1 Six tiles

| Tile | Shows |
| --- | --- |
| Net benefit (window) | Gross benefit less estate cost, with change against the previous window |
| Annualised run-rate net | Window net scaled to 365.25 days |
| ROI | Gross benefit per £1 of estate cost, shown as a multiple |
| Payback | Months of run-rate net needed to repay this period's estate cost |
| FTE released | Colleague full-time-equivalents released, with change |
| Cost per case vs target | Cost per completed case against the £9.00 target, with change |

### 11.2 FY target attainment

Fiscal-year-to-date net benefit against the estate's annual net benefit target, projected to fiscal-year end at the current run-rate, with an on-track or behind verdict. The fiscal year starts in April by default. No estate target is set today, so this shows a prompt to configure one.

### 11.3 Benefit waterfall

Gross benefit, less **Teams** (all people cost), less **Machines (VDIs)** (all VDI cost), equals Net. A memo bar shows idle machine cost that no work absorbed; it is shown for honesty and is not subtracted from Net. Cost is split by kind, not by owner: the CoE is one owner alongside the hubs.

### 11.4 Monthly value trend

Stacked monthly cost (Teams, Machines) with a Net line, plus fiscal-year-to-date net and the change against the same point in the prior fiscal year.

### 11.5 Spoke P&L

One row per hub: gross benefit, people cost, infrastructure cost, net, margin %, cost per case, completed cases, attainment against the hub's own annual target (fiscal-year-to-date), and a 12-week net trend. A total row reconciles to the tiles. Exportable to CSV.

### 11.6 Process value league

Processes ranked by net benefit with a cumulative line and a marker at 80% of positive net, so you can see how few processes deliver most of the value. Shows the top 15.

### 11.7 Review candidates

Processes running at a net loss, worst first, each with a reason chosen by fixed rules in order: fewer than 30 completions in the period (low volume); exception rework cost above 30% of the process's automation cost (high exception cost); unit cost above 1.5 times the target cost per case (high unit cost); otherwise cost exceeds benefit at the current volume and rate mix.

### 11.8 Run-rate projection

A closing sentence projects net benefit to fiscal-year end at the current run-rate and compares it with the prior fiscal year to the same point.

## 12. Page: Commercial Performance

Cost per case, grade-based benefit and cumulative ROI.

### 12.1 Five tiles

**Cost per completed case** against the £9.00 target, **Estate cost** (Teams plus Machines), **Gross benefit**, **Net benefit**, and **Return on automation** as benefit per £1 spent.

### 12.2 Human cost assumption (what-if slider)

By default benefit is valued at each process's grade rate in force on the day work completed, and the blended rate is shown. Dragging the slider (£15 to £60 per hour) revalues benefit at a flat rate to test sensitivity. **Use grade rates** restores the default. The slider never changes cost.

### 12.3 Cost per completed case over time

Daily cost per case against the target line, with a shaded 14-day forecast. The forecast is seasonal-naive: each future day is the average of the same weekday over the last four weeks of actuals, with a band of ± one standard deviation of that sample (floored at 5% of the mean). The card subtitle says so.

### 12.4 Cumulative benefit vs cost

Cumulative benefit and cumulative cost accruing through the period, each with a 14-day forecast built the same seasonal-naive way as the cost-per-case chart — the daily increments are forecast, same-weekday over the last four weeks, then accumulated onto the running totals. The card subtitle says so. Exportable to CSV.

## 13. Pages: Data model and Playbook (admin)

### 13.1 Data model

The data lineage, the star schema (one fact row per day and process, with process, digital worker, date and exception-reason dimensions), relationships, and the modelling rules every consumer shares. Any BI tool can connect to the same SQL views and get the same numbers.

### 13.2 Playbook

The plain-English operations guide: how data is pulled and loaded, how money is calculated, the reference data we maintain, the data API, using the dashboard, finance and alerts, sign-in, running in Google Cloud, scale, and the runbook. Also published as PLAYBOOK.md.

## 14. Metric dictionary

Every measure on the dashboard, its plain-English meaning and its formula. Attempts means completed plus business plus system exceptions. Change arrows compare the selected window with the immediately preceding window of the same length, with the same filters.

### 14.1 Completion rate

Share of attempted cases that completed first time with no exception.

`completed ÷ attempts` · Up is good · Target ≥ 95%

### 14.2 Completed cases / Throughput

Work items the bots finished successfully.

`sum of completed` · Up is good

### 14.3 Volume in / Cases attempted

Everything the bots attempted.

`completed + business exceptions + system exceptions`

### 14.4 Exceptions

Items that failed rather than completing.

`business + system` · Down is good

### 14.5 Exception rate

Share of attempts that ended in an exception.

`exceptions ÷ attempts` · Down is good · Target ≤ 6%; amber within 10% of the target

### 14.6 Business exceptions

Failures caused by the case data or business rules, where a person has to decide. Shown as a count and as a share of intake or of all exceptions.

### 14.7 System exceptions

Failures caused by systems or technology, such as an application being down or timing out.

Alert target: `system ÷ attempts` ≤ 3%

### 14.8 Outcome mix

Each outcome's share of attempts: Completed, Business exception, System exception.

### 14.9 Avg cycle time / Avg completion time

Average digital-worker runtime per completed item.

`worktime on completed items ÷ completed`, shown as 45s, 10m 21s or 1h 04m

### 14.10 Weighted avg cycle time

Estate cycle time weighted by each process's volume.

`sum(cycle time × attempts) ÷ attempts`

### 14.11 Active days in range / Avg cases per day

Days in the window with any activity, and attempts divided by those days.

### 14.12 Colleague time saved / released

Hours of colleague effort displaced by completed automations.

`sum(completed × SMV minutes) ÷ 60` · Up is good

### 14.13 Gross benefit

Money value of the displaced colleague time.

`hours saved × grade rate in force on the outcome date` for each process, where a hub's own rate for a grade wins over the universal rate. With the what-if slider, `hours × flat rate` instead.

### 14.14 Estate cost / Automation cost

Fully loaded cost of running the automations, apportioned by bot time.

`worktime × (CoE pool £ per bot-second + hub pool £ per bot-second)`. The CoE pool is the CoE team's daily run-rate plus CoE-owned VDIs' daily cost, spread across all work that day. A hub's pool is its own team's daily run-rate plus its own VDIs' daily cost, spread across that hub's work that day. Idle time is never a denominator.

### 14.15 Net benefit

What is left after paying for the automation.

`gross benefit − estate cost` · Up is good · Annual target per hub and for the estate (none set today)

### 14.16 Cost per completed case

Average estate cost of completing one case.

`estate cost ÷ completed` · Down is good · Target ≤ £9.00

### 14.17 FTE released

Colleague full-time-equivalents released.

`hours saved ÷ (window days × 252 ÷ 365.25 × 7.5 hours)` using 252 working days and 7.5 productive hours per day

### 14.18 Net/FTE value

Net benefit per FTE released, a measure of value density.

`net benefit ÷ FTE released`, shown as — when no FTE was released

### 14.19 ROI / Return on automation

Gross benefit earned per £1 of estate cost.

`gross benefit ÷ estate cost`, shown as a multiple such as 1.4×

### 14.20 Annualised run-rate net

The window's net scaled to a year.

`net benefit × 365.25 ÷ window days`

### 14.21 Payback

Months of run-rate net needed to repay this period's estate cost.

`estate cost ÷ (run-rate net ÷ 12)`, shown as — when net is not positive

### 14.22 Teams (people cost)

The people half of estate cost: the CoE team and every hub's own automation team, apportioned by bot time. Teams plus Machines always equals estate cost to the penny.

### 14.23 Machines (VDIs)

The machine half of estate cost: CoE-owned and hub-owned VDI licence cost, apportioned by bot time.

### 14.24 Unattributed idle (memo)

Pool cost on days when nothing ran anywhere. Shown on the waterfall so total spend reconciles; never subtracted from Net.

### 14.25 Exception cost / Exception rework cost

An upper bound on what it would cost a colleague to redo the failed items.

`exception count × SMV minutes ÷ 60 × grade rate in force on the exception date`, split into business and system. Not the bot runtime cost of the failures.

### 14.26 Margin % (Spoke P&L)

Share of a hub's gross benefit left as net.

`net ÷ gross`

### 14.27 FY-to-date net and prior FYTD

Net benefit from the fiscal-year start to the data-through date, independent of the date filter, and the same number of days into the previous fiscal year. Fiscal year starts in April by default.

### 14.28 Projected FY-end and vs target

`FYTD net + (window net ÷ window days) × days remaining in the fiscal year`, compared with the annual target; on track when the projection meets the target.

### 14.29 12-week trend (Spoke P&L)

Weekly net for the 12 weeks ending at the window end, regardless of the date filter. Green when the last week is at or above the first.

### 14.30 80% of positive net

The smallest number of processes whose cumulative net benefit reaches 80% of all positive net.

### 14.31 SMV (standard minutes value)

The minutes a colleague would take to do one case by hand. Set per process in Administration. Drives benefit and rework cost.

### 14.32 Grade rate

The hourly cost of the colleague grade a process automates against, effective-dated, universal or overridden per hub. Described as the single most sensitive number on the dashboard.

### 14.33 Human cost assumption (blended rate)

The effective average rate behind every benefit figure.

`gross benefit ÷ hours saved`, or the flat what-if rate when the slider is used

### 14.34 Active hours / Productive bot time

Hours a digital worker actually spent running work.

### 14.35 Licensed capacity / Available hours

Hours a digital worker was licensed and available.

`covered days in the window × 20 operating hours per day`. A day is covered when the VDI is inside its 365-day renewal window and not expired or retired.

### 14.36 Utilisation

How much of the licensed time was productive.

`active hours ÷ available hours`, capped at 100% · Healthy band 15% to 60%

### 14.37 Idle % and Spare capacity

Share of licensed time with nothing to do, and the total idle hours across machines that had work.

### 14.38 Estate cost share (per VDI)

The machine's slice of apportioned estate cost, using the same day and hub bot-time share as process cost.

### 14.39 Stale VDI

A machine that has history but no cases for more than the review threshold (14 days by default). Surfaces as a warning alert and in the VDI review queue.

### 14.40 Carried in the data but not shown

Pending or deferred item counts, retry counts, item priority and deferred dates exist in the source data but are not surfaced on any visual today.

## 15. How money is calculated

The rules the whole dashboard follows. An automated check proves the browser and the warehouse agree to four decimal places — the check fails on any difference above 0.01%.

### 15.1 Benefit rule

Benefit is valued at the grade rate in force on the day each case completed. Changing a rate today never changes history. A hub-specific rate for a grade wins over the universal rate.

### 15.2 Cost rule

Cost rides on the work that ran. The CoE's shared team and machines are spread across all work by bot time; each hub's own team and machines are spread across that hub's work only.

### 15.3 People cost rule

Each owner's people-cost record (the CoE and each hub) becomes a daily run-rate: annual cost ÷ 365.25. Records are effective-dated and never edited once past; a change is a new record from a chosen date. Only automation delivery and support headcount belongs here, never the business team whose work is automated, because their effort is already counted as benefit.

### 15.4 VDI cost rule

A renewal buys 365 days of coverage at the class rate (or a per-VDI override), spread evenly across those days. A licence expiry or a retirement ends coverage early. A class-rate change takes effect for each VDI at its next renewal, never mid-cycle.

### 15.5 Cost presentation

On the dashboard cost is shown as Teams and Machines (VDIs), by kind of cost rather than by owner. The two reconcile to estate cost to the penny.

### 15.6 Exception rework rule

Failed items are valued as if a colleague redid them: SMV × grade rate on the exception date. It is an upper bound, because some retried items later completed.

### 15.7 Fiscal year rule

Fiscal-year-to-date figures run from the fiscal-year start month (April by default, changeable by an admin) to the data-through date and ignore the date filter.

## 16. Thresholds and alerts

Alerts evaluate the trailing seven days of the latest data at four levels: estate, spoke, process and VDI.

### 16.1 Threshold settings and defaults

| Setting | Default | Direction | Evaluated at | Can be overridden per |
| --- | --- | --- | --- | --- |
| Completion rate | 95% | Floor (≥) | Estate, spoke, process | Spoke, process |
| Exception rate | 6% | Ceiling (≤) | Estate, spoke, process | Spoke, process |
| System exception rate | 3% | Ceiling (≤) | Estate, spoke, process | Spoke, process |
| Cost per case | £9.00 | Ceiling (≤) | Estate, spoke, process | Spoke, process |
| Utilisation minimum | 15% | Floor | VDI (via its spoke) | Spoke |
| Utilisation maximum | 60% | Ceiling | VDI (via its spoke) | Spoke |
| Idle VDI review threshold | 14 days | Ceiling | VDI | Spoke |

### 16.2 Which threshold applies

A process override wins; otherwise the process's spoke override; otherwise the global target.

### 16.3 Breach versus warning

Past the threshold is a **breach**. Within a 10% early-warning band of it is a **warning**. For a floor such as completion rate, the band is 10% of the remaining headroom to 100%, so a 95% floor warns below 95.5%. For a ceiling, the band is 10% below it, so a 6% ceiling warns above 5.4%.

### 16.4 Volume guard

A process with fewer than 30 completed-plus-exception items in the seven-day window is not evaluated, so a one-item process at 100% exceptions is not treated as a signal.

### 16.5 Stale VDI warning

A machine with no cases for longer than the review threshold raises a warning (never a breach) reading, for example, *VDI-RPA-COM-04 — no cases for 21 days (last case 23 Jun) — review for retirement*. Retired machines are skipped.

### 16.6 Headline wording

Examples: *Estate — Completion rate 91.2%, below the 95.0% floor*; *Consumer Lending — System exception rate 7.2%, above the 5.0% ceiling*; warnings say *only just above the floor* or *approaching the ceiling (warning: within the early-warning band)*.

### 16.7 Delivery channels

Alerts appear in the header bell, the Alerts page and the command palette. Nothing is pushed to email or Teams today.

## 17. Administration

Where reference data is maintained. Every save updates every chart immediately. Hub leads see every hub but can edit only their own; admins can edit everything. Past dated records are locked so history is never rewritten; a change is always a new record from a chosen date.

### 17.1 Squads (spokes) — admin only

Add or rename a spoke, set its short code and its light and dark accent colours, with a live contrast check (3:1 minimum). A new spoke is available in every picker immediately and shows activity once its processes have data. Spokes cannot be deleted.

### 17.2 Propositions & processes — hub lead for own spoke

Per spoke: add, edit or delete propositions; add, edit or delete processes with name, acronym, proposition, SMV minutes, grade (limited to grades in scope for the spoke), active flag, icon, tags and description; map Blue Prism queue names to processes with optional stage name and order. A proposition with processes, or a process with a mapped queue, cannot be deleted until reassigned.

### 17.3 People costs — hub lead for own spoke; CoE record admin only

Per owner (CoE or a spoke): effective-dated records of headcount and annual cost with an optional note. New records cannot be backdated. A future record can be edited or deleted; the most recent record can be deleted to undo a mistake; older records are locked.

### 17.4 VDI estate — hub lead for own spoke; shared machines admin only

Per owner: every machine with cost class, renewal date, annual cost override, licence expiry, status, current coverage window, and first and last case seen. Actions: edit, **Renew** (books a full year from a chosen date), **Retire** (from a chosen date), **Add VDI**. Machines seen in the data but not yet registered appear as **Unregistered — complete registration** with a one-step Register form. A **Review queue** lists machines idle beyond the threshold with a one-click Retire.

### 17.5 VDI class-rate card

The annual list price per machine for each cost class, effective-dated, universal (admin) or overridden per spoke (hub lead). Admins can make a backdated correction behind a confirmation that warns it revalues reported cost history.

### 17.6 Targets & thresholds

Global targets (admin): completion rate, exception rate, system exception rate, cost per case, utilisation minimum and maximum, idle VDI review days, and the fiscal-year start month. Spoke and process overrides (hub lead for own spoke) for the rate and cost metrics; utilisation and idle thresholds per spoke only. Net benefit targets: an estate target (admin) and a per-spoke annual target (hub lead for own spoke), used by Value & Finance. These are the single source of truth for the whole dashboard: every page reads them live, so a save here moves the alerts, the dashed target lines on charts, and every KPI target chip together, immediately — including Process Analysis, which colours its league table against the same threshold and warn band the alerts use.

### 17.7 Grade rate card — definitions admin only; hub overrides by hub lead

Grade definitions with code, name and scope (all spokes or named spokes); a grade in use cannot be deleted or narrowed. Per grade: an effective-dated universal hourly rate (admin) and per-spoke override rates (hub lead), with the same history locking and admin-only backdated corrections.

### 17.8 Exception patterns — admin only

The ordered list of text patterns that classify a raw exception reason as System or Business. Explicit prefixes on the reason always win. Changes apply from the next data build.

### 17.9 Users & roles — admin only

A working stand-in for the demo directory: name, email, roles, spokes, passphrase reset, remove. In production this is replaced by Entra ID group membership.

### 17.10 Data & sync

Download the current reference data as JSON or as a SQL script; a change log of every save (when, section, who); and, for editors, a guarded **Discard local edits**.

### 17.11 Concurrent edits

In production every save is version-checked. If someone else saved first, a dialog names them and the time, lists the sections that differ, and requires a choice: **Reload theirs** or **Overwrite with mine**. Every accepted write is logged with who and when.

## 18. Reference data loaded today

Please check your hub's rows. These figures drive every benefit and cost number.

### 18.1 Spokes

| Spoke | Short code |
| --- | --- |
| Insurance, Pensions & Investments | IP&I |
| Risk | RSK |
| Commercial | COM |
| Consumer Lending | CLD |

### 18.2 Processes, SMV and grade

| Spoke | Proposition | Process | Acronym | SMV (min) | Grade | Queue(s) | Tags |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IP&I | General Insurance | Insurance New Business | INB | 18 | OPS3 | INSURANCE_NEW_BUS | Onboarding; Customer-facing |
| IP&I | General Insurance | Insurance Renewals | IRN | 12 | OPS3 | INSURANCE_RENEWALS | Renewals; Batch |
| IP&I | Home Insurance | Home Claims | HCL | 35 | SOPS | HOME_CLAIMS | Claims; Customer-facing |
| IP&I | Pensions | Pension Transfers | PTR | 55 | PSPC | PENSIONS_TRANSFER (Initiation), PENSIONS_TRF_FINAL (Completion) | Transfers; Regulatory |
| IP&I | Pensions | Pension Valuations | PVL | 10 | PANL | PENSIONS_VALUATION | Valuations; Batch |
| IP&I | Life & Protection | Life Underwriting | LUW | 40 | UWSP | LIFE_UNDERWRITING | Underwriting; Regulatory |
| IP&I | Investments | Investment Rebalancing | IRB | 22 | IANL | INVEST_REBALANCE | Batch |
| IP&I | Investments | Investment Onboarding | ION | 45 | KYCS | INVEST_ONBOARDING | Onboarding; KYC |
| Risk | Financial Crime | Sanctions Screening Referrals | SSR | 15 | RANL | RISK_SANCTIONS | Screening; Regulatory |
| Risk | Financial Crime | Fraud Case Triage | FCT | 30 | RANL | RISK_FRAUD_TRIAGE | Triage; Regulatory |
| Commercial | Commercial Insurance | Commercial Quote Ingestion | CQI | 25 | CUAS | COMM_QUOTE_INGEST | Onboarding; Batch |
| Commercial | Commercial Insurance | Broker Commission Reconciliation | BCR | 20 | FANL | COMM_BROKER_RECON | Reconciliation; Batch |
| Consumer Lending | Personal Loans | Loan Application Processing | LAP | 28 | LOPS | LEND_APPLICATIONS | Onboarding; Customer-facing |
| Consumer Lending | Personal Loans | Arrears Payment Plans | APL | 22 | LOPS | LEND_ARREARS_PLANS | Collections; Customer-facing |

### 18.3 Grades and hourly rates

All rates are universal today; no hub overrides are set. CL-SUP is scoped to Consumer Lending only.

| Grade | Name | £/hour from 1 Jan 2023 | £/hour from 1 Apr 2026 |
| --- | --- | --- | --- |
| OPS3 | Ops Grade 3 | 28.00 | 29.00 |
| SOPS | Senior Ops | 32.00 | 33.20 |
| PSPC | Pensions Specialist | 38.00 | 39.40 |
| PANL | Pensions Analyst | 30.00 | 31.10 |
| UWSP | Underwriting Support | 42.00 | 43.50 |
| IANL | Investment Analyst | 36.00 | 37.30 |
| KYCS | KYC Specialist | 40.00 | 41.40 |
| RANL | Risk Analyst | 34.00 | 35.20 |
| CUAS | Commercial Underwriting Assistant | 36.00 | 37.30 |
| FANL | Finance Analyst | 32.00 | 33.10 |
| LOPS | Lending Ops | 27.00 | 28.00 |
| CL-SUP | Consumer Lending Support | 26.00 | — |

### 18.4 People cost records

| Owner | Headcount | Annual cost | Effective from |
| --- | --- | --- | --- |
| CoE | 14 | £780,000 | 1 Jan 2023 |
| CoE | 16 | £860,000 | 1 Apr 2025 |
| Insurance, Pensions & Investments | 4 | £220,000 | 1 Jan 2023 |
| Risk | 2 | £112,000 | 1 Jan 2023 |
| Commercial | 2 | £106,000 | 1 Jan 2023 |
| Consumer Lending | 3 | £152,000 | 1 Jan 2023 |

### 18.5 VDI estate

Twelve machines. Operating hours: 20 per day.

| Resource | Owner | Class | Active from | Renewal | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| VDI-RPA-PROD-01 | IP&I | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-02 | IP&I | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-03 | IP&I | prod | 1 Jan 2023 | 1 Jan 2023 | Retired 31 Mar 2025 | Licence expired 31 Mar 2025 |
| VDI-RPA-PROD-04 | IP&I | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-05 | IP&I | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-06 | IP&I | prod | 1 Jan 2023 | 1 Jan 2023 | Active | Deliberately idle in the demo data |
| VDI-RPA-PROD-07 | IP&I | prod | 1 Jun 2025 | 1 Jun 2025 | Active | £10,200 negotiated override |
| VDI-RPA-PROD-08 | Risk | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-09 | Commercial | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-10 | Consumer Lending | prod | 1 Jan 2023 | 1 Jan 2023 | Active |  |
| VDI-RPA-PROD-11 | Consumer Lending | prod | 1 Sep 2025 | 1 Sep 2025 | Active | Added Sep 2025 |
| VDI-RPA-TEST-01 | CoE (shared/test) | test | 1 Jan 2023 | 1 Jan 2023 | Active | Hub-owned test machine |

### 18.6 VDI class rates (annual, per machine)

| Class | From 1 Jan 2023 | From 1 Jul 2025 |
| --- | --- | --- |
| prod | £9,000 | £9,600 |
| test | £6,000 | £6,400 |

### 18.7 Targets in force

Completion rate 95%; exception rate 6%; system exception rate 3%; cost per case £9.00; utilisation 15% to 60%; idle VDI review 14 days; fiscal year starts April. No spoke or process overrides and no net benefit targets are set yet.

### 18.8 Exception classification patterns

System: timeout, not found on screen, failed to launch, login failed, dialog, citrix, connection, session disconnected. Business: not found in core system, invalid for processing, documentation, outside tolerance, duplicate, manual referral, incomplete.

### 18.9 Working assumptions

252 working days per year and 7.5 productive hours per day for FTE conversion. 20 VDI operating hours per day for capacity.

## 19. Roles and sign-in

### 19.1 Four roles

| Role | Sees | Can edit |
| --- | --- | --- |
| Admin | Every page including Administration, Data model and Playbook | Everything, including estate-wide settings and backdated corrections |
| Hub lead | Every dashboard page and Administration | Only their own hub's propositions, processes, queue mappings, people costs, VDIs, grade-rate overrides, threshold overrides and net benefit target |
| Hub member | Every dashboard page and Administration, read-only | Nothing; can export reference data |
| Business user | Dashboard pages only, alerts scoped to their hub | Nothing |

### 19.2 Production sign-in

Sign in with Microsoft (Entra ID). Group membership maps to a role and hub: SG-RPA-Admins → Admin; SG-RPA-IPI-Lead, SG-RPA-RSK-Lead, SG-RPA-COM-Lead, SG-RPA-CLD-Lead → Hub lead for that hub; SG-RPA-HubMembers → Hub member; SG-RPA-BusinessUsers → Business user. Anyone signed in with no matching group is a Business user. The server re-checks permission on every write.

### 19.3 Demo sign-in

Six seeded accounts sharing the passphrase *demo*: an admin, hub leads for IP&I and Risk, a CoE hub member, and business users for Commercial and Consumer Lending. Used for demonstrations only.

### 19.4 Server-side enforcement

The interface hides what a user may not change, and the data API rejects any write outside the user's permissions regardless of what the browser sent.

## 20. Export and how numbers are shown

### 20.1 CSV export

Available on the Watchlist, Alerts, Process league table, Exception detail, VDI capacity table, Spoke P&L and Cumulative benefit vs cost. The file contains exactly the rows on screen after filters, sorting and search, named **{table}-{data-through date}.csv**. Values that look like spreadsheet formulas are neutralised so nothing runs when opened in Excel.

### 20.2 Number conventions

Money is compact on tiles and axes (£382.7k, £1.0M) and in full elsewhere (£53,320), with pence only below £100. A negative sign always comes before the £. Percentages show one decimal. Durations read 45s, 10m 21s, 1h 04m. Anything that cannot be computed shows as — rather than a misleading zero. Dates are UK format.

### 20.3 Colour conventions

Red means a negative or a breach, never a neutral series. Each hub has its own accent colour used for swatches, rails, tints and chart series, never as a fill behind text. Positive is green, warning is amber.

## 21. Accessibility and personalisation

Opened with Shift+A or the header icon. Every setting is remembered per user.

### 21.1 Theme and contrast

Light, Dark, or High contrast (true black and white, visible borders, no reliance on colour or shadow alone). Follows the operating system by default.

### 21.2 Liquid glass

Translucent surfaces on the navigation, filter band, menus and dialogs. Can be switched off, and switches itself off in high contrast or when the device asks for reduced transparency.

### 21.3 Text size

100%, 115% or 130%, scaling text and layout together.

### 21.4 Dyslexia-friendly mode

A clearer humanist font with more letter and line spacing, following British Dyslexia Association guidance.

### 21.5 Bionic reading

Bolds the start of each word in descriptions to guide the eye; never applied to chart numbers or axis labels.

### 21.6 Reading ruler

A soft highlighted band that follows the pointer or keyboard focus.

### 21.7 Colour-vision-safe palette

Swaps chart colours for a palette distinguishable with the most common forms of colour blindness and adds distinct line patterns.

### 21.8 Reduce motion

Turns off animations and transitions; otherwise the device setting is followed.

### 21.9 Personalisation

A greeting by first name with a small seasonal accent, and live UK and India clocks in the header. Both can be turned off.

### 21.10 Keyboard and screen readers

A skip-to-content link, visible focus outlines everywhere, focus returned to the opener when a dialog closes, keyboard-only operation of every control, tooltips on collapsed navigation items, and announcements for page changes, filter counts, results and new alerts.

## 22. Platform, freshness and resilience

### 22.1 Refresh cadence

Data is pulled from Elastic every 15 minutes. Each pull re-reads a 24-hour overlap so an item that changed state late is never missed, and the merge is safe to repeat.

### 22.2 History

The demonstration data spans January 2025 to July 2026. In production, history depth is set by Elastic retention; an initial backfill loads older history in bounded windows.

### 22.3 Loading and errors

A themed loading skeleton appears instantly. If data cannot be loaded, a plain-English error offers **Retry** without reloading the page. A fault on one page shows **This page went wrong** with **Try again** while the rest of the dashboard keeps working. Background errors appear as a dismissable notice.

### 22.4 When the data service is down

The last loaded data stays on screen, the header dot turns amber with an explanation, and the dashboard recovers automatically on the next successful check.

### 22.5 Session expiry

One silent token renewal is attempted; if that fails you are asked to sign in again.

### 22.6 Hosting

Google Cloud: Cloud SQL for SQL Server as the warehouse, a scheduled Cloud Run job for the pull, and Cloud Run services for the data API and the dashboard, behind a single HTTPS load balancer in production.

### 22.7 Scale

Designed and indexed for 50 to 100 million work items; the path to 250 to 500 million is documented (monthly partitioning, materialised aggregates, server-side paging for item-level search).

### 22.8 Browser support

Current versions of Edge, Chrome, Safari and Firefox are expected to work. No formal supported-browser statement exists yet; the glass effect degrades gracefully on older engines.

## 23. Known gaps and limitations

What we already know is missing or constrained. Please confirm, reprioritise or add to this list.

### 23.1 No email or Teams alerts

Alerts are in-app only. Pushing to email or Teams needs a small scheduled job in the data API.

### 23.2 No item-level search

Pages show aggregates by day, process and reason. There is no search for an individual case reference or item.

### 23.3 Pending, deferred, retries and priority not shown

These fields exist in the source but have no visual today.

### 23.4 Exception reclassification is not retroactive

A changed pattern applies from the next data build only.

### 23.5 No net benefit targets set

FY attainment and the vs-target column stay empty until an admin or hub lead enters targets.

### 23.6 No hub-specific rates or thresholds set

All grade rates, VDI class rates and thresholds are universal today.

### 23.7 No supported-browser statement

To be agreed with IT.

### 23.8 Acknowledgements still reset with each data build

By design, so a persisting breach resurfaces; use **Snooze until resolved** instead when you want an alert to stay hidden across builds for as long as the same breach keeps recurring.

### 23.9 No undo for reference edits

Writes are versioned and logged, but reverting means re-entering the previous value.

## 24. Questions for your hub

The answers we most need. A short note against each is enough.

### 24.1 Which measures are missing?

Is there a number your hub reports today, or is asked for, that the dictionary does not contain?

### 24.2 Do the definitions match yours?

In particular completion rate, exception rate, cost per case, and the treatment of business versus system exceptions.

### 24.3 Are the SMVs and grades right?

Section 18 lists each process's standard minutes and the grade it automates against.

### 24.4 Is your people cost record right?

Headcount and annual cost for your automation delivery and support team only.

### 24.5 Is your VDI list complete and correct?

Machines, cost class, renewal dates, and anything that should be retired.

### 24.6 What should your targets be?

Completion, exception and cost-per-case thresholds for your hub, and an annual net benefit target.

### 24.7 Who should receive alerts and how?

In-app only, or email or Teams as well, and to whom.

### 24.8 Is a 15-minute refresh right?

Faster, slower, or does it not matter for your use?

### 24.9 Who in your hub needs access, and at what role?

Names or groups for hub lead, hub member and business user.

### 24.10 Which pages will you actually use, and what is missing from them?

Anything you would expect to see on a page that is not there.

### 24.11 What do you need to export or share?

Tables, images, scheduled reports, or a link into a specific filtered view.

---

24 sections, 191 reviewable items.
