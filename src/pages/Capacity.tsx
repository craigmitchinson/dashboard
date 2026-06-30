import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import type { VdiAgg } from "../filters-context";
import { KpiCard, VisualCard, DataTable, CellBar, PageGrid, Row, useViz, fmtInt, fmtCompact, fmtPct, fmtGBP } from "../components/viz";
import type { Column } from "../components/viz";
import { fonts } from "../theme";

export function Capacity() {
  const { model } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();

  const active = m.vdis.filter((d) => d.cases > 0);
  const totalAvail = active.reduce((s, d) => s + d.availableHours, 0);
  const totalActive = active.reduce((s, d) => s + d.activeHours, 0);
  const totalIdle = active.reduce((s, d) => s + d.idleHours, 0);
  const avgUtil = totalAvail ? totalActive / totalAvail : 0;
  const idleCost = m.vdis.reduce((s, d) => s + d.idlePct * d.cost, 0);
  const totalCost = m.vdis.reduce((s, d) => s + d.cost, 0);

  const utilColor = (u: number) => (u >= 0.75 ? v.bad : u >= 0.4 ? v.business : v.good);

  const columns: Column<VdiAgg>[] = [
    { key: "name", header: "Digital worker", render: (r) => (
      <span>
        <span style={{ fontWeight: 600 }}>{r.name}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 10.5, color: t.inkSoft, marginLeft: 8 }}>{r.pool}</span>
      </span>
    ) },
    { key: "processes", header: "Processes", align: "right" },
    { key: "cases", header: "Cases", align: "right", render: (r) => fmtInt(r.cases) },
    { key: "activeHours", header: "Active hrs", align: "right", render: (r) => fmtCompact(r.activeHours) },
    { key: "idlePct", header: "Idle %", align: "right", render: (r) => <span style={{ color: r.idlePct > 0.6 ? v.bad : t.ink }}>{fmtPct(r.idlePct, 0)}</span> },
    { key: "utilPct", header: "Utilisation", align: "right", width: 150, render: (r) => <CellBar value={r.utilPct} max={1} color={utilColor(r.utilPct)} /> },
    { key: "cost", header: "Licence cost", align: "right", render: (r) => fmtGBP(r.cost) },
  ];

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Active digital workers" value={String(active.length)} accent={v.accent} sub={`of ${m.vdis.length} licensed`} />
        <KpiCard label="Average utilisation" value={fmtPct(avgUtil, 0)} accent={utilColor(avgUtil)} sub={`${fmtCompact(totalActive)} of ${fmtCompact(totalAvail)} hrs`} />
        <KpiCard label="Idle hours" value={fmtCompact(totalIdle)} accent={v.business} sub="unused licensed capacity" />
        <KpiCard label="Cost of idle capacity" value={fmtGBP(idleCost)} accent={v.bad} sub="licence spend not utilised" />
      </div>

      <Row cols="minmax(0,1fr) minmax(0,1.15fr)">
        <VisualCard title="Utilisation by digital worker" subtitle="Active runtime against licensed operating hours">
          <div style={{ display: "flex", flexDirection: "column", paddingTop: 4, height: "100%" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              {m.vdis.map((d) => (
                <div key={d.id} style={{ display: "grid", gridTemplateColumns: "92px 1fr 46px", gap: 10, alignItems: "center" }}>
                  <span style={{ fontFamily: fonts.mono, fontSize: 12, color: t.ink }}>{d.name}</span>
                  <span style={{ height: 18, background: v.grid, borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <span style={{ position: "absolute", inset: 0, width: `${Math.max(1, d.utilPct * 100)}%`, background: utilColor(d.utilPct), borderRadius: 5 }} />
                  </span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink, textAlign: "right" }}>{fmtPct(d.utilPct, 0)}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, lineHeight: 1.5 }}>
              Low utilisation is spare capacity available for new automations; high utilisation flags a worker at risk of becoming a bottleneck.
            </p>
          </div>
        </VisualCard>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <VisualCard title="VDI capacity table" subtitle="Sortable — default by utilisation" style={{ flex: 1.45 }}>
            <DataTable columns={columns} rows={m.vdis} initialSort={{ key: "utilPct", dir: "desc" }} />
          </VisualCard>

          <VisualCard title="Capacity & cost summary" subtitle="Licensed hours and where the spend goes" style={{ flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, height: "100%", justifyContent: "flex-start", paddingTop: 4 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, marginBottom: 6 }}>
                  <span>Utilised {fmtPct(avgUtil, 0)}</span>
                  <span>Idle {fmtPct(1 - avgUtil, 0)}</span>
                </div>
                <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                  <div title={`Utilised ${fmtCompact(totalActive)} h`} style={{ width: `${Math.max(2, avgUtil * 100)}%`, background: v.good }} />
                  <div title={`Idle ${fmtCompact(totalIdle)} h`} style={{ flex: 1, background: v.business }} />
                </div>
              </div>
              {[
                { k: "Licensed capacity", val: `${fmtCompact(totalAvail)} h` },
                { k: "Total licence cost", val: fmtGBP(totalCost) },
                { k: "Cost of idle capacity", val: fmtGBP(idleCost), bad: true },
              ].map((r, i) => (
                <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                  <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>{r.k}</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 13.5, fontWeight: 700, color: r.bad ? v.bad : t.ink }}>{r.val}</span>
                </div>
              ))}
            </div>
          </VisualCard>
        </div>
      </Row>
    </PageGrid>
  );
}
