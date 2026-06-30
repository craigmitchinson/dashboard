import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { VisualCard, useViz } from "../components/viz";

// In-app reference: how to rebuild each visual in Power BI. Most map to native
// visuals + standard features; Deneb is only needed for pixel-exact styling.

interface VizRow {
  visual: string;
  pbi: string;
  build: "Native" | "Native+" | "Deneb";
  fields: string;
}
const PAGES: { page: string; rows: VizRow[] }[] = [
  {
    page: "Overview",
    rows: [
      { visual: "KPI cards (with sparkline + delta)", pbi: "Card (new) — sparkline + reference-label", build: "Native", fields: "1 measure each; trend = same measure by date; delta = PoP measure" },
      { visual: "Daily case flow", pbi: "Line chart (Legend = Outcome)", build: "Native", fields: "Axis: Date · Values: case count · Legend: Outcome" },
      { visual: "Outcome mix", pbi: "100% stacked bar + Table", build: "Native", fields: "Values: count · Legend: Outcome" },
      { visual: "Throughput by process", pbi: "Clustered bar chart", build: "Native", fields: "Axis: Process · Values: Completed" },
      { visual: "Watchlist", pbi: "Table — data bars + colour rules", build: "Native+", fields: "Process, Exceptions, Exc % (conditional format), Cost" },
    ],
  },
  {
    page: "Input & Outcome",
    rows: [
      { visual: "Case flow in & out", pbi: "Line chart; daily/monthly = Field Parameter", build: "Native+", fields: "Axis: Date hierarchy · Values: Attempted + each outcome" },
      { visual: "Daily / Monthly toggle", pbi: "Field Parameter or bookmark buttons", build: "Native+", fields: "Parameter switches the date grain" },
      { visual: "Outcome split over time", pbi: "100% stacked area chart", build: "Native", fields: "Axis: Date · Legend: Outcome" },
      { visual: "Period summary", pbi: "Multi-row card / Table", build: "Native", fields: "The headline measures" },
    ],
  },
  {
    page: "Process Analysis",
    rows: [
      { visual: "Process performance bars", pbi: "Clustered bar + Field Parameter for the metric", build: "Native+", fields: "Axis: Process · Values: [Avg cycle | Throughput | Exc %]" },
      { visual: "Metric toggle", pbi: "Field Parameter (3 measures)", build: "Native+", fields: "Swaps the bar's value field" },
      { visual: "Exception time trend", pbi: "Line/area chart", build: "Native", fields: "Axis: Date · Legend: Exception category" },
      { visual: "Process league table", pbi: "Matrix / Table with conditional format", build: "Native", fields: "Process rows · Cycle, Exc %, Cost measures" },
    ],
  },
  {
    page: "Exceptions",
    rows: [
      { visual: "Exception heatmap", pbi: "Matrix — background colour scale (conditional format)", build: "Native", fields: "Rows: Process · Cols: Exception type · Values: Volume" },
      { visual: "Exception detail", pbi: "Table — built-in search + sort", build: "Native", fields: "Exception, Volume, % of total, Last seen (MAX date)" },
      { visual: "Category filter", pbi: "Slicer (tile) on Exception category", build: "Native", fields: "System / Business / All" },
    ],
  },
  {
    page: "VDI & Capacity",
    rows: [
      { visual: "Utilisation bars", pbi: "Clustered bar (or table data bars)", build: "Native", fields: "Axis: Digital worker · Values: Utilisation %" },
      { visual: "VDI capacity table", pbi: "Table / Matrix — sort + data bars", build: "Native", fields: "Worker, Processes, Cases, Active hrs, Idle %, Util, Cost" },
      { visual: "Capacity & cost summary", pbi: "100% stacked bar + cards", build: "Native", fields: "Utilised vs idle hours; licence & idle cost" },
    ],
  },
  {
    page: "Commercial Performance",
    rows: [
      { visual: "People cost slider", pbi: "What-if parameter + numeric range slicer", build: "Native", fields: "Creates a rate measure that flows into benefit" },
      { visual: "Cost per completed case", pbi: "Area/line chart", build: "Native", fields: "Axis: Date · Value: [Cost per case] measure" },
      { visual: "Cumulative benefit vs cost", pbi: "Line chart with running-total measures", build: "Native", fields: "Axis: Date · Values: cumulative benefit & cost" },
    ],
  },
];

const MEASURES: { name: string; dax: string }[] = [
  { name: "Completed", dax: "SUM ( Fact[Completed] )" },
  { name: "Exceptions", dax: "SUM ( Fact[Business] ) + SUM ( Fact[System] )" },
  { name: "Attempts", dax: "[Completed] + [Exceptions]" },
  { name: "Completion %", dax: "DIVIDE ( [Completed], [Attempts] )" },
  { name: "Time saved (h)", dax: "SUMX ( Fact, Fact[Completed] * RELATED ( Process[AhtSavedMin] ) ) / 60" },
  { name: "Automation cost", dax: "SUMX ( Fact, [Attempts row] * RELATED ( Process[RuntimeSec] ) / 3600 * RELATED ( Vdi[Rate] ) )" },
  { name: "Cost per case", dax: "DIVIDE ( [Automation cost], [Completed] )" },
  { name: "Gross benefit", dax: "[Time saved (h)] * 'People rate'[People rate Value]" },
  { name: "FTE released", dax: "DIVIDE ( [Time saved (h)], <productive hours in period> )" },
  { name: "vs previous period", dax: "VAR Prev = CALCULATE ( [m], DATEADD ( Date[Date], -<n>, DAY ) ) RETURN DIVIDE ( [m] - Prev, Prev )" },
  { name: "Cumulative benefit", dax: "CALCULATE ( [Gross benefit], FILTER ( ALLSELECTED ( Date[Date] ), Date[Date] <= MAX ( Date[Date] ) ) )" },
];

export function BuildGuide() {
  const t = useTheme();
  const v = useViz();

  const badge = (b: VizRow["build"]) => {
    const c = b === "Deneb" ? v.business : b === "Native+" ? v.accent : v.good;
    return <span style={{ fontFamily: fonts.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: c, background: `${c}1c`, border: `1px solid ${c}`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>{b}</span>;
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", paddingRight: 4 }} className="anim-up">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 8 }}>
        <VisualCard title="How to rebuild this in Power BI" subtitle="This prototype is a layout + data reference. Almost every visual maps to a native Power BI visual plus a standard feature — Deneb is only needed where you want pixel-exact styling.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, paddingTop: 4 }}>
            {[
              { k: "Report & pages", d: "One report, six pages grouped Monitor / Optimise via the page-navigation pane. In Power BI use the Page Navigator visual or bookmark buttons." },
              { k: "Slicers", d: "Proposition, Process, Queue, Tags, Date range as slicer visuals, synced across pages (Sync slicers pane). Date = a relative-date slicer + a Between slicer for custom." },
              { k: "Theme", d: "Set a report theme JSON: bg #071316, card #0C2329, text #F4F1EB, accent #FF222F. Outcome colours — Completed #86C7BD, Business #C9B3F0, System #FF6A6F." },
            ].map((c) => (
              <div key={c.k} style={{ border: `1px solid ${t.ruleSoft}`, borderRadius: 10, padding: "11px 13px", background: t.themeBand }}>
                <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: v.accent, fontWeight: 700, marginBottom: 5 }}>{c.k}</div>
                <div style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.ink, lineHeight: 1.45 }}>{c.d}</div>
              </div>
            ))}
          </div>
        </VisualCard>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {PAGES.map((p) => (
            <VisualCard key={p.page} title={p.page} subtitle="Visual → Power BI build">
              <div style={{ display: "flex", flexDirection: "column" }}>
                {p.rows.map((r, i) => (
                  <div key={r.visual} style={{ padding: "9px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ flex: 1, fontFamily: fonts.body, fontSize: 13.5, fontWeight: 700, color: t.ink }}>{r.visual}</span>
                      {badge(r.build)}
                    </div>
                    <div style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.ink }}>{r.pbi}</div>
                    <div style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, marginTop: 2 }}>{r.fields}</div>
                  </div>
                ))}
              </div>
            </VisualCard>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 14 }}>
          <VisualCard title="Core measures (DAX sketch)" subtitle="Build these once on a star schema: Fact × Process × Vdi × Date">
            <div style={{ display: "flex", flexDirection: "column" }}>
              {MEASURES.map((m, i) => (
                <div key={m.name} style={{ padding: "8px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                  <div style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: 700, color: t.ink }}>{m.name}</div>
                  <code style={{ fontFamily: fonts.mono, fontSize: 11, color: v.accent, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.dax}</code>
                </div>
              ))}
            </div>
          </VisualCard>

          <VisualCard title="When to reach for Deneb" subtitle="Vega-Lite custom visual — only where native styling falls short">
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 2 }}>
              <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.5 }}>
                ~90% of this report is native Power BI. Reach for Deneb only for:
              </p>
              {[
                ["Combined dashed line + filled area in one chart", "Native line charts can't mix per-series dash + area cleanly. Deneb layer: an area mark + a line mark with strokeDash."],
                ["Bespoke heatmap cells (rounded, labelled, gapped)", "The native Matrix heatmap works; use Deneb only if you want the exact rounded, gapped cells shown here (rect marks + text)."],
                ["KPI cards with this exact typography", "Card (new) is close. Deneb gives full control of the number/sparkline/delta layout."],
              ].map(([h, d]) => (
                <div key={h} style={{ borderLeft: `3px solid ${v.business}`, paddingLeft: 11 }}>
                  <div style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: 700, color: t.ink }}>{h}</div>
                  <div style={{ fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, lineHeight: 1.45, marginTop: 2 }}>{d}</div>
                </div>
              ))}
              <p style={{ margin: "2px 0 0", fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, lineHeight: 1.5 }}>
                Deneb pattern: bind a dataset → write a Vega-Lite spec → map fields to encodings → reference the theme palette as named colours.
              </p>
            </div>
          </VisualCard>
        </div>
      </div>
    </div>
  );
}
