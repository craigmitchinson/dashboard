import { useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { useNav } from "../nav-context";
import { fmtDate, monthKey } from "../rpaData";
import { VisualCard, LineChart, HBarChart, Legend, PageGrid, Row, useViz, fmtCompact, fmtInt, fmtPct } from "../components/viz";
import { SpokeSwatch } from "../components/SpokeSwatch";

type Metric = "time" | "throughput" | "exrate";
const METRICS: { key: Metric; label: string }[] = [
  { key: "time", label: "Avg completion time" },
  { key: "throughput", label: "Throughput" },
  { key: "exrate", label: "Exception rate" },
];

// TODO (re-touch when it lands): adopt the shared `Segmented` from
// components/viz.tsx once the primitives worker exports it — this local copy
// is sized 32px/radius 8 to already match that spec so swapping it in later
// is a drop-in (same height/shape, just de-duplicated).
function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  const t = useTheme();
  return (
    <div style={{ display: "inline-flex", height: 32, border: `1px solid ${t.ruleSoft}`, borderRadius: 8, overflow: "hidden" }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", padding: "0 11px", height: "100%", border: "none", cursor: "pointer", background: value === o.key ? t.ink : "transparent", color: value === o.key ? t.paper : t.inkSoft, fontWeight: 700 }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// TODO (re-touch when it lands): swap for viz.tsx's `fmtDuration` once the
// primitives worker exports it — human durations ("10m 21s") instead of raw
// seconds, in the league table and the bar-value labels below.
function fmtHuman(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

// TODO (re-touch when it lands): swap for viz.tsx's `fmtMoney` (full,
// grouped) once the primitives worker exports it — fmtMoney2 (the only
// "full precision" money formatter viz.tsx has today) has no thousands
// separator, which reads badly for this league table's larger cost figures.
function fmtMoneyFull(n: number): string {
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ProcessAnalysis() {
  const { model, filters, setFilters } = useFilters();
  const nav = useNav();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const activeProc = filters.processId !== "All" ? filters.processId : undefined;
  const [metric, setMetric] = useState<Metric>("time");
  const [grain, setGrain] = useState<"daily" | "monthly">("daily");

  const barRows = (() => {
    if (metric === "time")
      return [...m.byProcess].sort((a, b) => b.avgCycleSec - a.avgCycleSec).map((p) => ({ id: p.id, label: p.name, value: p.avgCycleSec, sub: `${fmtCompact(p.completed)} cases`, color: t.series }));
    if (metric === "throughput")
      return [...m.byProcess].sort((a, b) => b.completed - a.completed).map((p) => ({ id: p.id, label: p.name, value: p.completed, color: v.completed }));
    return [...m.byProcess]
      .map((p) => ({ id: p.id, label: p.name, value: p.attempts ? (p.exceptions / p.attempts) * 100 : 0, sub: `${fmtInt(p.exceptions)} exc`, color: v.system }))
      .sort((a, b) => b.value - a.value);
  })();

  const barFormat = metric === "time" ? fmtHuman : metric === "throughput" ? fmtCompact : (n: number) => `${n.toFixed(1)}%`;

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
          <HBarChart rows={barRows} valueFormat={barFormat} activeId={activeProc} onRowClick={(id) => setFilters({ processId: id })} />
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
          {/* TODO (re-touch when it lands): swap this inline WebkitMaskImage
              fade for primitives.css's `.viz-scroll` class once the
              primitives worker exports it — that version can be scroll-
              position-aware (fade only where there's actually more below);
              this static bottom fade is the best approximation without JS
              scroll tracking that this page owns. */}
          <div style={{ overflow: "auto", height: "100%", WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent 100%)", maskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent 100%)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 56px 88px", gap: 8, padding: "0 2px 8px 2px", fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, borderBottom: `1px solid ${t.ruleSoft}` }}>
              <span>Process</span><span style={{ textAlign: "right" }}>Cycle</span><span style={{ textAlign: "right" }}>Exc %</span><span style={{ textAlign: "right" }}>Cost</span>
            </div>
            {[...m.byProcess].sort((a, b) => b.runtimeCost - a.runtimeCost).map((p) => (
              <div
                key={p.id}
                className="click-row"
                role="button"
                tabIndex={0}
                onClick={() => { setFilters({ processId: p.id }); nav("process-detail"); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setFilters({ processId: p.id });
                    nav("process-detail");
                  }
                }}
                style={{ display: "grid", gridTemplateColumns: "1fr 64px 56px 88px", gap: 8, padding: "8px 4px", margin: "0 -4px", borderRadius: 5, cursor: "pointer", alignItems: "center", borderBottom: `1px solid ${t.ruleSoft}` }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <SpokeSwatch spoke={p.spoke} decorative />
                  <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</span>
                </span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: t.ink }}>{fmtHuman(p.avgCycleSec)}</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: p.attempts && p.exceptions / p.attempts > 0.1 ? v.bad : t.ink }}>{fmtPct(p.attempts ? p.exceptions / p.attempts : 0, 1)}</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink }}>{fmtMoneyFull(p.runtimeCost)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 2px 2px", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft }}>
              <span>Weighted avg cycle time</span>
              <span style={{ fontFamily: fonts.mono, fontWeight: 700, color: t.ink }}>{fmtHuman(wCycle)}</span>
            </div>
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
