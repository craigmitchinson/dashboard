import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { PROCESS_BY_ID, PROCESSES, fmtDate } from "../rpaData";
import { KpiCard, VisualCard, LineChart, HBarChart, Legend, PageGrid, Row, useViz, fmtInt, fmtCompact, fmtPct, fmtMoney2, fmtGBP } from "../components/viz";

export function ProcessDetail() {
  const { model, filters, setFilters } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();

  const proc = filters.processId !== "All" ? PROCESS_BY_ID.get(filters.processId) : undefined;

  // no selection → a chooser
  if (!proc) {
    return (
      <PageGrid>
        <Row cols="1fr">
          <VisualCard title="Drill into a process" subtitle="Pick one — or click any process bar / row on another page">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, alignContent: "start", paddingTop: 4 }}>
              {PROCESSES.map((p) => (
                <button key={p.id} onClick={() => setFilters({ processId: p.id })} className="click-row" style={{ textAlign: "left", border: `1px solid ${t.ruleSoft}`, background: t.themeBand, borderRadius: 10, padding: "12px 14px", cursor: "pointer", color: t.ink }}>
                  <div style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, marginTop: 3 }}>{p.spoke} · {p.queue}</div>
                </button>
              ))}
            </div>
          </VisualCard>
        </Row>
      </PageGrid>
    );
  }

  const pa = m.byProcess.find((p) => p.id === proc.id);
  const labels = m.daily.map((d) => fmtDate(d.ts));
  const excRows = m.byException.slice(0, 7).map((e) => ({ label: e.name, value: e.volume, color: e.category === "system" ? v.system : v.business }));
  // with the process drill active, m.vdis is already just the workers that ran it
  const workers = m.vdis.filter((d) => d.cases > 0).slice(0, 4);

  return (
    <PageGrid>
      {/* banner */}
      <Row cols="1fr" grow={false}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: `linear-gradient(168deg, ${t.paper}, ${t.themeBand})`, border: `1px solid ${t.ruleSoft}`, borderLeft: `4px solid ${v.accent}`, borderRadius: 12, padding: "12px 16px" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: fonts.display, fontSize: 19, fontWeight: 700, color: t.ink }}>{proc.name} <span style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, fontWeight: 400 }}>{proc.acronym}</span></div>
            <div style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, marginTop: 2 }} title={proc.description}>
              {proc.spoke} · {proc.proposition} · {proc.queues.map((q) => (q.stage ? `${q.queue} (${q.stage})` : q.queue)).join(" → ")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {proc.tags.map((tag) => (
              <span key={tag} style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: t.inkSoft, border: `1px solid ${t.ruleSoft}`, borderRadius: 999, padding: "3px 9px" }}>{tag}</span>
            ))}
          </div>
          <button onClick={() => setFilters({ processId: "All" })} style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer", border: `1px solid ${t.ruleSoft}`, background: "transparent", color: t.inkSoft }}>Clear drill</button>
        </div>
      </Row>

      {/* KPIs for this process */}
      <div className="kpi-row kpi-row--5">
        <KpiCard label="Completed" value={fmtCompact(pa?.completed ?? 0)} accent={v.completed} sub="items" />
        <KpiCard label="Exceptions" value={fmtCompact(pa?.exceptions ?? 0)} accent={v.system} sub={`${fmtPct(pa && pa.attempts ? pa.exceptions / pa.attempts : 0, 1)} of attempts`} />
        <KpiCard label="Completion rate" value={fmtPct(pa?.completionPct ?? 0, 1)} accent={v.good} sub="straight-through" />
        <KpiCard label="Avg cycle time" value={`${Math.round(pa?.avgCycleSec ?? 0)}s`} accent={v.business} sub="bot runtime per completed item" />
        <KpiCard label="Estate cost" value={fmtGBP(pa?.runtimeCost ?? 0)} accent={v.accent} sub={`${fmtMoney2(pa?.completed ? pa.runtimeCost / pa.completed : 0)} / completed case`} />
      </div>

      <Row cols="minmax(0,1.5fr) minmax(0,1fr)">
        <VisualCard title="Daily flow" subtitle="Outcomes for this process over the period" right={<Legend items={[{ label: "Completed", color: v.completed }, { label: "Business", color: v.business }, { label: "System", color: v.system }]} />}>
          <LineChart
            labels={labels}
            series={[
              { name: "Completed", color: v.completed, values: m.daily.map((d) => d.completed), area: true },
              { name: "Business exception", color: v.business, values: m.daily.map((d) => d.business) },
              { name: "System exception", color: v.system, values: m.daily.map((d) => d.system) },
            ]}
          />
        </VisualCard>
        <VisualCard title="Top exceptions" subtitle={`By volume for this process · ${fmtGBP(pa?.exceptionCostGBP ?? 0)} exception cost (period)`}>
          <HBarChart rows={excRows} valueFormat={fmtCompact} />
        </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)" style={{ flex: 0.8 }}>
        <VisualCard title="Digital workers" subtitle={`${proc.spoke} machines that ran this process in the period`}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, height: "100%" }}>
            {workers.length === 0 && <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>No runs in the selected period.</span>}
            {workers.map((w, i) => (
              <div key={w.id} style={{ display: "grid", gridTemplateColumns: "1fr 62px 90px 70px", gap: 10, alignItems: "center", padding: "7px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                <span style={{ fontFamily: fonts.mono, fontSize: 12, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: t.inkSoft }}>{fmtInt(w.cases)}</span>
                <span style={{ height: 14, background: v.grid, borderRadius: 4, overflow: "hidden", position: "relative" }}>
                  <span style={{ position: "absolute", inset: 0, width: `${Math.max(2, w.utilPct * 100)}%`, background: v.accent, borderRadius: 4 }} />
                </span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink }}>{fmtPct(w.utilPct, 0)} util</span>
              </div>
            ))}
          </div>
        </VisualCard>
        <VisualCard title="Process profile" subtitle="Team-owned configuration (reference data)">
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, height: "100%" }}>
            {[
              { k: "SMV — manual minutes / case", val: `${proc.smvMinutes} min` },
              { k: "Automates against grade", val: `${proc.gradeName} (${proc.grade})` },
              { k: "Current grade rate", val: `£${proc.colleagueHourly.toFixed(2)}/hr` },
              { k: "Colleague time released (period)", val: `${fmtCompact(pa?.timeSavedHours ?? 0)} h` },
            ].map((r, i) => (
              <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>{r.k}</span>
                <span style={{ fontFamily: fonts.mono, fontSize: 12.5, fontWeight: 700, color: t.ink, textAlign: "right" }}>{r.val}</span>
              </div>
            ))}
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
