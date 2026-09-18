import { useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters, DEFAULT_FILTERS } from "../filters-context";
import { useNav } from "../nav-context";
import { fmtDate } from "../rpaData";
import { WARN_MARGIN } from "../alerts/engine";
import { useReference } from "../reference/reference-context";
import { resolvedTarget, targetMetAtLeast, targetMetAtMost, rateBand } from "./target-rules";
import {
  KpiCard,
  VisualCard,
  LineChart,
  HBarChart,
  Legend,
  PageGrid,
  Row,
  Segmented,
  useViz,
  fmtInt,
  fmtCompact,
  fmtPct,
  fmtGBP,
  fmtMoney,
  fmtMoney2,
  StackedShareTrend,
  EmptyState,
} from "../components/viz";
import { ExportCsvButton } from "../components/PageActions";

export function Overview() {
  const { model, filters, setFilters } = useFilters();
  const { reference } = useReference();
  const nav = useNav();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const completionTarget = resolvedTarget(reference, "completionPct", filters.spoke);
  const costPerCaseTarget = resolvedTarget(reference, "costPerCase", filters.spoke);
  const exceptionRateTarget = resolvedTarget(reference, "exceptionRate", filters.spoke);
  const activeProc = filters.processId !== "All" ? filters.processId : undefined;
  // 7-day trailing average overlay for the daily flow chart — only offered
  // once there's enough range for a week-long window to mean anything
  // (see the toggle's render guard below), off by default so the raw daily
  // series is what a short/default range shows.
  const [smoothOn, setSmoothOn] = useState(false);

  const delta = (cur: number, prev: number) => (prev ? (cur - prev) / prev : 0);
  const completedSpark = m.daily.map((d) => d.completed);
  const excSpark = m.daily.map((d) => d.business + d.system);
  const labels = m.daily.map((d) => fmtDate(d.ts));
  const weekendMask = m.daily.map((d) => {
    const day = new Date(d.ts).getUTCDay();
    return day === 0 || day === 6;
  });
  const canSmooth = labels.length >= 60;

  // Watchlist rate colour bands — reuse the alerting system's own warn-band
  // convention (WARN_MARGIN, alerts/engine.ts) against the resolved
  // exception-rate target (reference.targets, spoke-override-aware — see
  // target-rules.ts) rather than the previous unexplained 0.12/0.08 literals,
  // so "bad"/"warn" here means the same thing it does everywhere else that
  // watches this rate.

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
      <div className="kpi-row kpi-row--6">
        <KpiCard label="Completion rate" value={fmtPct(m.completionPct, 1)} accent={v.good} delta={delta(m.completionPct, m.prev.completionPct)} sub="straight-through" target={{ label: `Target ≥ ${fmtPct(completionTarget, 0)}`, met: targetMetAtLeast(m.completionPct, completionTarget) }} />
        <KpiCard label="Cost per completed case" value={fmtMoney2(m.costPerCase)} accent={v.accent} delta={delta(m.costPerCase, m.prev.costPerCase)} deltaGood="down" sub="fully-loaded estate" target={{ label: `Target ≤ ${fmtMoney2(costPerCaseTarget)}`, met: targetMetAtMost(m.costPerCase, costPerCaseTarget) }} />
        <KpiCard label="Exceptions" value={fmtCompact(m.exceptions)} accent={v.system} delta={delta(m.exceptions, m.prev.exceptions)} deltaGood="down" sub="vs prev. period" spark={excSpark} />
        <KpiCard label="Net/FTE value" value={m.fte > 0 ? fmtMoney(m.netBenefit / m.fte, { compact: true }) : "—"} accent={v.business} sub={`${m.fte.toFixed(1)} FTE released`} />
        <KpiCard label="Completed cases" value={fmtCompact(m.completed)} accent={v.completed} delta={delta(m.completed, m.prev.completed)} sub="vs prev. period" spark={completedSpark} />
        <KpiCard label="Colleague time saved" value={`${fmtCompact(m.timeSavedHours)} h`} accent={v.accent} delta={delta(m.timeSavedHours, m.prev.timeSavedHours)} sub="vs prev. period" />
      </div>

      {/* daily flow + watchlist */}
      <Row cols="minmax(0,1.55fr) minmax(0,1fr)">
        <VisualCard
          title="Daily case flow"
          subtitle="Cases processed per day by outcome"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Legend items={outcomeMix.map((o) => ({ label: o.label, color: o.color }))} />
              {canSmooth && (
                <Segmented
                  ariaLabel="7-day average overlay"
                  value={smoothOn ? "on" : "off"}
                  onChange={(val) => setSmoothOn(val === "on")}
                  options={[{ value: "off", label: "Daily" }, { value: "on", label: "7-day avg" }]}
                />
              )}
            </div>
          }
        >
          <LineChart
            labels={labels}
            weekendMask={weekendMask}
            bandWeekends
            smooth={smoothOn && canSmooth ? 7 : undefined}
            series={[
              { name: "Completed", color: v.completed, values: m.daily.map((d) => d.completed), area: true },
              { name: "Business exception", color: v.business, values: m.daily.map((d) => d.business) },
              { name: "System exception", color: v.system, values: m.daily.map((d) => d.system) },
            ]}
          />
        </VisualCard>

        <VisualCard
          title="Watchlist"
          subtitle="Click a row to drill through to process detail"
          scroll
          right={<ExportCsvButton filename="watchlist" rows={() => watch.map((p) => ({ Process: p.name, Queue: p.queue, Exceptions: p.exceptions, "Exception rate %": (p.rate * 100).toFixed(2), Cost: p.runtimeCost.toFixed(2) }))} />}
        >
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {watch.length === 0 && <EmptyState onReset={() => setFilters(DEFAULT_FILTERS)} />}
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
                style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "7px 5px", margin: "0 -5px", borderRadius: 6, cursor: "pointer", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: fonts.body, fontSize: 13.5, fontWeight: 600, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft }}>{p.queue} · {fmtInt(p.exceptions)} exceptions</span>
                </span>
                <span style={{ fontFamily: fonts.mono, fontSize: 11.5, color: t.inkSoft }}>{fmtGBP(p.runtimeCost)}</span>
                <span style={{ width: 56, textAlign: "right", fontFamily: fonts.mono, fontSize: 14, fontWeight: 700, color: (() => { const b = rateBand(p.rate, exceptionRateTarget, WARN_MARGIN); return b === "bad" ? v.bad : b === "warn" ? v.business : v.ink; })() }}>{fmtPct(p.rate, 1)}</span>
              </div>
            ))}
          </div>
        </VisualCard>
      </Row>

      {/* throughput by process + outcome mix */}
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

        <VisualCard
          title="Outcome mix"
          subtitle={`${fmtInt(m.attempts)} cases attempted`}
          summary={`${fmtInt(m.completed)} completed (${fmtPct(m.completed / mixTotal, 1)}), ${fmtInt(m.business)} business exceptions, ${fmtInt(m.system)} system exceptions, out of ${fmtInt(mixTotal)} attempted this period. Estate cost ${fmtGBP(m.automationCost)}.`}
        >
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 10, paddingTop: 6 }}>
            <div style={{ display: "flex", height: 26, borderRadius: 7, overflow: "hidden", gap: 2, flex: "0 0 auto" }}>
              {outcomeMix.map((o) => (
                // minWidth only applies when this segment actually has volume — otherwise
                // a zero-attempts period (mixTotal falls back to 1) would still render a
                // visible sliver for every outcome, implying a split that isn't there.
                <div key={o.label} title={`${o.label} · ${fmtInt(o.value)}`} style={{ width: `${(o.value / mixTotal) * 100}%`, background: o.color, minWidth: o.value > 0 ? 2 : 0 }} />
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
            {/* The daily 100%-stacked strip repeats what the aggregate bar
                above already shows once the range is short enough that a
                handful of days can't add any texture over the period total
                — drop it rather than render a near-duplicate. */}
            {labels.length > 14 && (
              <div style={{ flex: 1, minHeight: 56, display: "flex", flexDirection: "column", gap: 4 }}>
                <StackedShareTrend
                  labels={labels}
                  series={[
                    { name: "Completed", color: v.completed, values: m.daily.map((d) => d.completed) },
                    { name: "Business exception", color: v.business, values: m.daily.map((d) => d.business) },
                    { name: "System exception", color: v.system, values: m.daily.map((d) => d.system) },
                  ]}
                />
              </div>
            )}
            <div style={{ paddingTop: 12, borderTop: `1px solid ${t.ruleSoft}`, display: "flex", justifyContent: "space-between", fontFamily: fonts.body, fontSize: 13, color: t.inkSoft, flex: "0 0 auto" }}>
              <span>Estate cost (period, apportioned)</span>
              <span style={{ fontFamily: fonts.mono, fontWeight: 700, color: t.ink }}>{fmtGBP(m.automationCost)}</span>
            </div>
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
