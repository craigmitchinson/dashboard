# Power BI RPA Monitoring Dashboard — Design & Structure

## Overview

Transform the Blue Prism RPA automation dashboard into a professional Power BI prototype, emphasizing operational visibility, cost measurement, and reactive filtering.

---

## Page Architecture

### **1. Executive Summary** (Landing Page)
**Purpose**: High-level operational health and financial impact at a glance.

**Top Section — Key Metrics (Cards)**
- **Completed Tasks** (total, 90-day period) — primary number, green accent
- **FTE Value Generated** (calculated: colleague hours saved × hourly rate)
- **Total Cost Savings** (FTE × hourly rate) — financial headline
- **System Exception Rate %** — red accent if >5%, amber if 2-5%
- **Average Case Cost** (total cost ÷ completed cases) — trend indicator

**Bottom Section — Dashboard Snapshot**
- **Case Volume Trend** (30-day): Line chart (completed, system exceptions, business exceptions)
- **Cost Impact by Process** (Top 5): Stacked bar (labour cost saved vs. process cost)
- **Health Scorecard** (Process × Sentiment): Matrix visual (green/amber/red by process)

**Filters** (Global — impact all pages)
- Proposition (multi-select dropdown)
- Process Name (multi-select dropdown)
- Date Range (date slicer, default last 90 days)

---

### **2. Case Flow & Outcomes**
**Purpose**: Track volume and outcomes of work processing.

**Top Section**
- **Case Volume by Outcome** (toggle: daily/monthly)
  - Line chart with dual axis: Cases In (blue) vs. Cases Out by outcome type (green=completed, orange=system exception, red=business exception)
  - Secondary axis: Exception rate % (line)

**Middle Section**
- **Outcome Distribution** (Pie / Donut)
  - % Completed, % System Exceptions, % Business Exceptions
  - Alternate: Waterfall showing In → Completed → System Exceptions → Business Exceptions → Backlog

**Bottom Section**
- **Queue Health** (Table or Card visual)
  - Process Name, Queue Name, Cases In (24h), Cases Completed (24h), Cases in Queue, Avg Wait (hours)
  - Conditional formatting: Red if wait >8h, amber >4h

---

### **3. Process Performance**
**Purpose**: Understand where time goes and where process optimization matters.

**Left Section — Time Distribution**
- **Case Completion Time by Process** (Horizontal bar, sorted descending)
  - Average time, P50, P90, P99 as stacked segments
  - Hover shows "50% complete in X hrs, 90% complete in Y hrs"

**Right Section — Cost Drivers**
- **Total Cost by Process** (Horizontal bar, stacked: labour cost + process cost)
  - Shows why some processes are expensive (high labour hours vs. high process cost)
  - Hover: breakdown by labour, tools, infrastructure

**Bottom Section — Time Trend**
- **Completion Time Trend** (Line chart, 30-day rolling average by top 3 processes)
  - Highlight improvements or degradation
  - Benchmark line: SLA target time

**Filters** (Page-specific additions)
- Queue Name (multi-select)
- Tags (multi-select, e.g., "high-volume", "regression")

---

### **4. Exceptions Detail**
**Purpose**: Debug and prioritize exception handling.

**Top Section — Exception Overview**
- **Exception Heatmap** (Matrix visual: Process × Exception Type)
  - Cell color intensity: exception volume
  - Cell value: count + % of process exceptions
  - Hover: total cost of that exception category

**Middle Section — Top Exceptions Table**
- **Searchable, sortable table**
  - Exception Name, Volume (24h), Volume (30d), % of Total, Most Recent, Trend (sparkline), Avg Resolution Time
  - Conditional formatting: Row highlight if volume spike detected
  - Color code: System (orange), Business (red), Unclassified (grey)

**Bottom Section — Exception Deep Dive**
- **Selected Exception Trend** (Line chart)
  - Volume, avg resolution time, FTE cost per exception (over 30 days)
  - Forecast next week's volume

**Filters** (Page-specific)
- Exception Type (multi-select: System, Business, Unclassified)
- Severity/Volume Threshold (slider)
- Date Range (inherited from global, can override)

---

### **5. Capacity & Resources**
**Purpose**: Understand automation capacity and resource utilization.

**Left Section — VDI Utilization (Real-time)**
- **VDI Status Table** (scrollable)
  - VDI Name, Status (Active/Idle/Offline), Current Process, Hours on Case (24h), Idle Time (%), Availability, Last Activity
  - Conditional formatting: Green if >80% busy, amber 50-80%, red <50%
  - Sort by utilization or availability
  
**Right Section — Capacity Trend**
- **VDI Utilization Over Time** (Area chart, 7-day rolling)
  - % VDIs in use, total hours deployed, hours on cases vs. overhead
  - Goal line: 75% utilization

**Bottom Section — Capacity Planning**
- **Forecasted Volume vs. Capacity** (Combo chart, next 7 days)
  - Forecasted case volume (bars), current VDI capacity (line), risk zones shaded
  - "In 2 days, you'll be at 92% capacity" warning

**Filters** (Page-specific)
- VDI Pool / Environment (multi-select)
- Process (to see VDI allocation by process)

---

### **6. Commercial & Cost**
**Purpose**: Business value and cost justification.

**Top Section — Cost Impact Cards**
- **Total Cost Saved** (labour hours × hourly rate) — green, prominent
- **Cost per Completed Case** (total cost ÷ cases) — metric with trend
- **FTE Equivalent** (total hours ÷ 2080) — how many people worth of work
- **ROI %** ((savings - tool cost) ÷ tool cost × 100) — red if <0%, green if >100%

**Middle Section — Cost Composition (Stacked Area)**
- **Cumulative Cost Over Time** (30-day)
  - Labour cost, Process cost (tools/infrastructure), Total cost line
  - Hover: daily breakdown

**Bottom Section — Sensitivity Analysis**
- **Cost Slider / What-If**
  - "Adjust hourly rate" slider (e.g., £25–50/hr)
  - Live update to Cost Saved, FTE Equivalent, ROI cards
  - Alternate: "Adjust case volume" slider to show scaling impact

**Footer — Benefit Realization**
- **Colleague Time Freed** (Card: hours saved)
- **Colleague Capacity Redistributed** (description: "equivalent to 12 FTE freed for higher-value work")

**Filters** (Page-specific)
- Cost Centre / Business Unit (multi-select, to allocate savings)
- Include/Exclude Process Cost (toggle, to compare gross vs. net savings)

---

## Design System & Theme

### **Colour Palette**
- **Background**: Dark grey/charcoal (#1a1a1a or #2a2a2a)
- **Data**: 
  - Completed (Success): Bright green (#00b050)
  - System Exception: Warm orange (#ffc000)
  - Business Exception: Alert red (#d43a2f)
  - Neutral: Cool grey (#6c757d)
- **Accent**: Bright blue (#0099ff or #0078d4) for highlights/selections
- **Text**: Off-white (#f0f0f0) on dark, dark grey on light cards

### **Typography**
- Font: Segoe UI (Power BI default) or similar sans-serif
- Hierarchy:
  - Card titles: 12pt, medium weight, caps
  - Card values: 32–48pt, bold (or 2xl if Power BI card size permits)
  - Chart labels: 10pt
  - Table headers: 11pt, bold

### **Visuals & Layout**
- **Cards**: Minimal, number-focused, no decorative icons unless colour-coded sentiment
- **Charts**: 
  - No chart junk (gridlines only if necessary)
  - Axis labels clear and uncluttered
  - Legend only if >2 series; use data labels on bars/pie
- **Tables**: Sortable columns, conditional formatting for status, alternating row colours (subtle)
- **Spacing**: Consistent gutters, breathing room between visuals

---

## Filtering & Interactivity

### **Global Filters** (Shared across all pages)
1. **Proposition** — multi-select dropdown (e.g., "Underwriting", "Claims")
2. **Process Name** — multi-select dropdown (filters by selected processes)
3. **Date Range** — date slicer (default: last 90 days)

### **Reactive Filtering**
- Change any filter → all charts on the current page + global KPI cards update immediately
- Breadcrumb or filter state display: "Showing: [Proposition] | [Process] | [Date Range]"
- "Clear All Filters" button to reset to defaults

### **Page-Specific Interactions**
- **Case Flow**: Toggle between daily/monthly trend
- **Exceptions Detail**: Click exception name → shows trend, recent cases
- **Capacity & Resources**: Click VDI → shows active process, recent job history
- **Commercial**: Drag slider → live re-calculation of cost cards

---

## Data Model & Metrics

### **Core Tables**
1. **Cases** (Fact): CaseID, CaseOpenDate, CaseCloseDate, ProcessID, Outcome (Completed/SysEx/BizEx), CreatedMinutes, CostAmount, FTEHours
2. **Processes** (Dimension): ProcessID, ProcessName, Proposition, Queue, SLA, CostPerHour
3. **Exceptions** (Fact): ExceptionID, CaseID, ExceptionType, ExceptionName, DetectedTime, ResolvedTime, ResolutionHours, ImpactedVDIs
4. **VDI** (Dimension): VDIID, VDIName, Environment, Status, LastHeartbeat
5. **VDI_Activity** (Fact): VDIID, ActivityDate, HoursOnCases, IdleHours, ProcessesRun
6. **Rates** (Parameters): HourlyRate (for cost calculation)

### **Key Measures (DAX)**
- **TotalCasesCompleted** = CALCULATE(COUNTROWS(Cases), Cases[Outcome]="Completed")
- **TotalSystemExceptions** = CALCULATE(COUNTROWS(Cases), Cases[Outcome]="SysEx")
- **TotalBusinessExceptions** = CALCULATE(COUNTROWS(Cases), Cases[Outcome]="BizEx")
- **FTEHoursSaved** = SUM(Cases[FTEHours])
- **CostSavedLabour** = [FTEHoursSaved] × VALUES(Rates[HourlyRate])
- **CostPerCase** = [CostSavedLabour] / [TotalCasesCompleted]
- **ExceptionRate%** = ([TotalSystemExceptions] + [TotalBusinessExceptions]) / ([TotalCasesCompleted] + [TotalSystemExceptions] + [TotalBusinessExceptions])
- **AvgCompletionHours** = AVERAGE(Cases[CreatedMinutes]) / 60
- **VDIUtilization%** = SUM(VDI_Activity[HoursOnCases]) / (SUM(VDI_Activity[HoursOnCases]) + SUM(VDI_Activity[IdleHours]))

---

## Page Grouping & Navigation

**Power BI Navigation Structure:**
```
Home (Bookmarks or Page Navigation visual)
├── Executive Summary
├── Case Flow & Outcomes
├── Process Performance
├── Exceptions Detail
├── Capacity & Resources
└── Commercial & Cost
```

**Optional**: Add a mobile-optimized view for phone preview (simplified, focusing on Executive Summary and Cost cards).

---

## Implementation Notes

1. **Responsive Design**: Power BI Desktop-first, but design mobile layout for power bi.com
2. **Performance**: Use aggregated tables for 90-day views; real-time VDI status via refresh schedule
3. **Drill-Through**: Consider drill-through from Process Performance → Exceptions Detail (filtered to that process)
4. **Tooltips**: Rich tooltips on all charts showing context (e.g., "P90 completion: 4.2 hours, cost: £18.50")
5. **Refresh**: Daily for historical data; 15-min for VDI activity and exceptions

---

## Success Metrics

- Dashboard loads in <2 seconds
- Filtering updates all visuals <1 second
- Cost cards and FTE values match business expectations (validated with stakeholders)
- Exceptions table identifies top 3 issues within 24h of detection
- Capacity warnings trigger before overload (at 85% utilization)

