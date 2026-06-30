import { useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { fmtDate, monthKey } from "../rpaData";
import { VisualCard, LineChart, HBarChart, Legend, PageGrid, Row, useViz, fmtCompact, fmtInt, fmtPct, fmtMoney2 } from "../components/viz";

type Metric = "time" | "throughput" | "exrate";
const METRICS: { key: Metric; label: string }[] = [
  { key: "time", label: "Avg completion time" },
  { key: "throughput", label: "Throughput" },
  { key: "exrate", label: "Exception rate" },
];

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  const t = useTheme();
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${t.ruleSoft}`, borderRadius: 8, overflow: "hidden" }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", padding: "5px 11px", border: "none", cursor: "pointer", background: value === o.key ? t.ink : "transparent", color: value === o.key ? t.paper : t.inkSoft, fontWeight: 700 }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProcessAnalysis() {
  const { model } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const [metric, setMetric] = useState<Metric>("time");
  const [grain, setGrain] = useState<"daily" | "monthly">("daily");

  const fmtSec = (n: number) => `${Math.round(n)}s`;

  const barRows = (() => {
    if (metric === "time")
      return [...m.byProcess].sort((a, b) => b.avgCycleSec - a.avgCycleSec).map((p) => ({ label: p.name, value: p.avgCycleSec, sub: `${fmtCompact(p.completed)} cases`, color: v.accent }));
    if (metric === "throughput")
      return [...m.byProcess].sort((a, b) => b.completed - a.completed).map((p) => ({ label: p.name, value: p.completed, color: v.completed }));
    return [...m.byProcess]
      .map((p) => ({ label: p.name, value: p.attempts ? (p.exceptions / p.attempts) * 100 : 0, sub: `${fmtInt(p.exceptions)} exc`, color: v.system }))
      .sort((a, b) => b.value - a.value);
  })();

  const barFormat = metric === "time" ? fmtSec : metric === "throughput" ? fmtCompact : (n: number) => `${n.toFixed(1)}%`;

  const pts = grain === "daily" ? m.daily : m.monthly;
  const labels = pts.map((p) => (grain === "daily" ? fmtDate(p.ts) : monthKey(p.ts)));

  // weighted average cycle time across the filtered processes
  const wCycle = m.byProcess.reduce((s, p) => s + p.avgCycleSec * p.attempts, 0) / Math.max(1, m.attempts);

  return (
    <PageGrid>
      <Row cols="1fr" style={{ flex: 1.1 }}>
        <VisualCard
          title="Process performance"
          subtitle={metric === "time" ? "Average digital-worker runtime per case, longest first" : metric === "throughput" ? "Completed cases per process" : "Share of attempts ending in an exception"}
          right={<Segmented value={metric} onChange={setMetric} options={METRICS} />}
        >
          <HBarChart rows={barRows} valueFormat={barFormat} />
        </VisualCard>
      </Row>

      <Row cols="minmax(0,1.5fr) minmax(0,1fr)">
        <VisualCard
          title="Exception time trend"
          subtitle="Exception volume over time, system vs business"
          right={
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Legend items={[{ label: "System", color: v.system }, { label: "Business", color: v.business }]} />
              <Segmented value={grain} onChange={setGrain} options={[{ key: "daily", label: "Daily" }, { key: "monthly", label: "Monthly" }]} />
            </div>
          }
        >
          <LineChart
            labels={labels}
            series={[
              { name: "System exception", color: v.system, values: pts.map((p) => p.system), area: true },
              { name: "Business exception", color: v.business, values: pts.map((p) => p.business) },
            ]}
          />
        </VisualCard>

        <VisualCard title="Process league table" subtitle="Sorted by cost contribution">
          <div style={{ overflow: "auto", height: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 56px 64px", gap: 8, padding: "0 2px 8px", fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, borderBottom: `1px solid ${t.ruleSoft}` }}>
              <span>Process</span><span style={{ textAlign: "right" }}>Cycle</span><span style={{ textAlign: "right" }}>Exc %</span><span style={{ textAlign: "right" }}>Cost</span>
            </div>
            {[...m.byProcess].sort((a, b) => b.runtimeCost - a.runtimeCost).map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 56px 64px", gap: 8, padding: "8px 2px", alignItems: "center", borderBottom: `1px solid ${t.ruleSoft}` }}>
                <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: t.ink }}>{Math.round(p.avgCycleSec)}s</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: p.attempts && p.exceptions / p.attempts > 0.1 ? v.bad : t.ink }}>{fmtPct(p.attempts ? p.exceptions / p.attempts : 0, 1)}</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink }}>{fmtMoney2(p.runtimeCost)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 2px 2px", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft }}>
              <span>Weighted avg cycle time</span>
              <span style={{ fontFamily: fonts.mono, fontWeight: 700, color: t.ink }}>{Math.round(wCycle)}s</span>
            </div>
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
