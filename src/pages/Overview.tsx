import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { useNav } from "../nav-context";
import { fmtDate, TARGETS } from "../rpaData";
import {
  KpiCard,
  VisualCard,
  LineChart,
  HBarChart,
  Legend,
  PageGrid,
  Row,
  useViz,
  fmtInt,
  fmtCompact,
  fmtPct,
  fmtGBP,
  fmtMoney2,
} from "../components/viz";

export function Overview() {
  const { model, filters, setFilters } = useFilters();
  const nav = useNav();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const activeProc = filters.processId !== "All" ? filters.processId : undefined;

  const delta = (cur: number, prev: number) => (prev ? (cur - prev) / prev : 0);
  const completedSpark = m.daily.map((d) => d.completed);
  const excSpark = m.daily.map((d) => d.business + d.system);
  const labels = m.daily.map((d) => fmtDate(d.ts));

  const outcomeMix = [
    { label: "Completed", value: m.completed, color: v.completed },
    { label: "Business exception", value: m.business, color: v.business },
    { label: "System exception", value: m.system, color: v.system },
  ];
  const mixTotal = m.attempts || 1;

  // operational watchlist: processes with the highest exception rate and the
  // cost that sits behind them.
  const watch = [...m.byProcess]
    .filter((p) => p.attempts > 0)
    .map((p) => ({ ...p, rate: p.exceptions / p.attempts }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  return (
    <PageGrid>
      {/* KPI cards */}
      <div className="kpi-row">
        <KpiCard label="Completed cases" value={fmtCompact(m.completed)} accent={v.completed} delta={delta(m.completed, m.prev.completed)} sub="vs prev. period" spark={completedSpark} />
        <KpiCard label="Colleague time saved" value={`${fmtCompact(m.timeSavedHours)} h`} accent={v.accent} delta={delta(m.timeSavedHours, m.prev.timeSavedHours)} sub="vs prev. period" />
        <KpiCard label="Exceptions" value={fmtCompact(m.exceptions)} accent={v.system} delta={delta(m.exceptions, m.prev.exceptions)} deltaGood="down" sub="vs prev. period" spark={excSpark} />
        <KpiCard label="FTE value released" value={`${m.fte.toFixed(1)} FTE`} accent={v.business} sub={`${fmtGBP(m.grossBenefit)} benefit`} />
        <KpiCard label="Completion rate" value={fmtPct(m.completionPct, 1)} accent={v.good} delta={delta(m.completionPct, m.prev.completionPct)} sub="straight-through" target={{ label: `Target ≥ ${fmtPct(TARGETS.completionPct, 0)}`, met: m.completionPct >= TARGETS.completionPct }} />
        <KpiCard label="Cost per completed case" value={fmtMoney2(m.costPerCase)} accent={v.accent} delta={delta(m.costPerCase, m.prev.costPerCase)} deltaGood="down" sub="fully-loaded estate" target={{ label: `Target ≤ ${fmtMoney2(TARGETS.costPerCase)}`, met: m.costPerCase <= TARGETS.costPerCase }} />
      </div>

      {/* outcome mix + daily flow */}
      <Row cols="minmax(0,1.55fr) minmax(0,1fr)">
        <VisualCard title="Daily case flow" subtitle="Cases processed per day by outcome" right={<Legend items={outcomeMix.map((o) => ({ label: o.label, color: o.color }))} />}>
          <LineChart
            labels={labels}
            series={[
              { name: "Completed", color: v.completed, values: m.daily.map((d) => d.completed), area: true },
              { name: "Business exception", color: v.business, values: m.daily.map((d) => d.business) },
              { name: "System exception", color: v.system, values: m.daily.map((d) => d.system) },
            ]}
          />
        </VisualCard>

        <VisualCard title="Outcome mix" subtitle={`${fmtInt(m.attempts)} cases attempted`}>
          {/* Content (bar + legend rows + footer) is inherently short next to
              the line chart it sits beside, which previously left a large
              empty void below the footer at tall viewports — the card's
              content area (VisualCard's own flex:1 wrapper) always stretched
              to the row's full height, but this inner div never grew to
              claim it, just top-aligned its own natural height. flex:1 here
              lets it fill that height, and justify-content:space-between
              spaces the three logical groups (bar / legend rows / footer)
              out across it so the card reads as deliberately composed at any
              height instead of leaving dead space at the bottom. */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "space-between", paddingTop: 6 }}>
            <div style={{ display: "flex", height: 26, borderRadius: 7, overflow: "hidden", gap: 2, flex: "0 0 auto" }}>
              {outcomeMix.map((o) => (
                <div key={o.label} title={`${o.label} · ${fmtInt(o.value)}`} style={{ width: `${(o.value / mixTotal) * 100}%`, background: o.color, minWidth: 2 }} />
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {outcomeMix.map((o) => (
                <div key={o.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: o.color, flex: "0 0 auto" }} />
                  <span style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, color: t.ink }}>{o.label}</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 13, fontWeight: 700, color: t.ink }}>{fmtInt(o.value)}</span>
                  <span style={{ width: 52, textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: t.inkSoft }}>{fmtPct(o.value / mixTotal, 1)}</span>
                </div>
              ))}
            </div>
            <div style={{ paddingTop: 12, borderTop: `1px solid ${t.ruleSoft}`, display: "flex", justifyContent: "space-between", fontFamily: fonts.body, fontSize: 13, color: t.inkSoft, flex: "0 0 auto" }}>
              <span>Estate cost (period, apportioned)</span>
              <span style={{ fontFamily: fonts.mono, fontWeight: 700, color: t.ink }}>{fmtGBP(m.automationCost)}</span>
            </div>
          </div>
        </VisualCard>
      </Row>

      {/* throughput by process + watchlist */}
      <Row cols="minmax(0,1.3fr) minmax(0,1fr)">
        <VisualCard title="Throughput by process" subtitle="Click a bar to cross-filter every page">
          <HBarChart
            barColor={v.completed}
            valueFormat={fmtCompact}
            activeId={activeProc}
            onRowClick={(id) => setFilters({ processId: id })}
            rows={[...m.byProcess].sort((a, b) => b.completed - a.completed).slice(0, 7).map((p) => ({ id: p.id, label: p.name, value: p.completed }))}
          />
        </VisualCard>

        <VisualCard title="Watchlist" subtitle="Click a row to drill through to process detail">
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
            {watch.map((p, i) => (
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
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 5px", margin: "0 -5px", borderRadius: 6, cursor: "pointer", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: fonts.body, fontSize: 13.5, fontWeight: 600, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft }}>{p.queue} · {fmtInt(p.exceptions)} exceptions</span>
                </span>
                <span style={{ fontFamily: fonts.mono, fontSize: 11.5, color: t.inkSoft }}>{fmtGBP(p.runtimeCost)}</span>
                <span style={{ width: 56, textAlign: "right", fontFamily: fonts.mono, fontSize: 14, fontWeight: 700, color: p.rate > 0.12 ? v.bad : p.rate > 0.08 ? v.business : v.ink }}>{fmtPct(p.rate, 1)}</span>
              </div>
            ))}
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
