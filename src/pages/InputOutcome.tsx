import { useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { fmtDate, monthKey } from "../rpaData";
import { KpiCard, VisualCard, LineChart, Legend, PageGrid, Row, useViz, fmtInt, fmtCompact, fmtPct } from "../components/viz";

type Grain = "daily" | "monthly";

function Toggle({ value, onChange }: { value: Grain; onChange: (g: Grain) => void }) {
  const t = useTheme();
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${t.ruleSoft}`, borderRadius: 8, overflow: "hidden" }}>
      {(["daily", "monthly"] as Grain[]).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          style={{
            fontFamily: fonts.mono,
            fontSize: 11,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            padding: "5px 12px",
            border: "none",
            cursor: "pointer",
            background: value === g ? t.ink : "transparent",
            color: value === g ? t.paper : t.inkSoft,
            fontWeight: 700,
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

export function InputOutcome() {
  const { model } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const [grain, setGrain] = useState<Grain>("daily");

  const pts = grain === "daily" ? m.daily : m.monthly;
  const labels = pts.map((p) => (grain === "daily" ? fmtDate(p.ts) : monthKey(p.ts)));
  const inSeries = pts.map((p) => p.completed + p.business + p.system);

  const legend = [
    { label: "Volume in (attempted)", color: v.accent },
    { label: "Completed", color: v.completed },
    { label: "Business exception", color: v.business },
    { label: "System exception", color: v.system },
  ];

  const busPct = m.attempts ? m.business / m.attempts : 0;
  const sysPct = m.attempts ? m.system / m.attempts : 0;

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Volume in" value={fmtCompact(m.attempts)} accent={v.accent} sub="cases attempted" />
        <KpiCard label="Completed out" value={fmtCompact(m.completed)} accent={v.completed} sub={`${fmtPct(m.completionPct, 1)} of intake`} />
        <KpiCard label="Business exceptions" value={fmtCompact(m.business)} accent={v.business} sub={`${fmtPct(busPct, 1)} of intake`} />
        <KpiCard label="System exceptions" value={fmtCompact(m.system)} accent={v.system} sub={`${fmtPct(sysPct, 1)} of intake`} />
      </div>

      <Row cols="1fr" style={{ flex: 1.4 }}>
        <VisualCard
          title="Case flow — volume in and out by outcome"
          subtitle="Daily intake against the outcome it resolves to"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Legend items={legend} />
              <Toggle value={grain} onChange={setGrain} />
            </div>
          }
        >
          <LineChart
            labels={labels}
            series={[
              { name: "Volume in (attempted)", color: v.accent, values: inSeries, dashed: true },
              { name: "Completed", color: v.completed, values: pts.map((p) => p.completed), area: true },
              { name: "Business exception", color: v.business, values: pts.map((p) => p.business) },
              { name: "System exception", color: v.system, values: pts.map((p) => p.system) },
            ]}
          />
        </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)">
        <VisualCard title="Outcome split over time" subtitle={`${grain === "daily" ? "Daily" : "Monthly"} share of completed vs exceptions`}>
          <LineChart
            labels={labels}
            yFormat={(n) => `${Math.round(n)}%`}
            tipFormat={(n) => `${n.toFixed(1)}%`}
            series={[
              { name: "Completion %", color: v.completed, values: pts.map((p) => { const a = p.completed + p.business + p.system; return a ? (p.completed / a) * 100 : 0; }), area: true },
              { name: "Exception %", color: v.system, values: pts.map((p) => { const a = p.completed + p.business + p.system; return a ? ((p.business + p.system) / a) * 100 : 0; }) },
            ]}
          />
        </VisualCard>

        <VisualCard title="Period summary" subtitle="Across the current slicers">
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
            {[
              { k: "Cases attempted", val: fmtInt(m.attempts) },
              { k: "Completed (straight-through)", val: fmtInt(m.completed) },
              { k: "Business exceptions", val: fmtInt(m.business) },
              { k: "System exceptions", val: fmtInt(m.system) },
              { k: "Active days in range", val: String(m.daily.length) },
              { k: "Avg cases / day", val: fmtInt(m.attempts / Math.max(1, m.daily.length)) },
            ].map((r, i) => (
              <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>{r.k}</span>
                <span style={{ fontFamily: fonts.mono, fontSize: 14, fontWeight: 700, color: t.ink }}>{r.val}</span>
              </div>
            ))}
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
