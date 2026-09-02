import { useState } from "react";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import type { VdiAgg } from "../filters-context";
import { KpiCard, VisualCard, DataTable, CellBar, Gauge, PageGrid, Row, useViz, fmtInt, fmtCompact, fmtPct, fmtGBP } from "../components/viz";
import type { Column } from "../components/viz";
import { ExportCsvButton } from "../components/PageActions";
import { SpokeSwatch } from "../components/SpokeSwatch";
import { fonts } from "../theme";
import { TARGETS } from "../rpaData";

export function Capacity() {
  const { model } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();

  const [sortedRows, setSortedRows] = useState<VdiAgg[]>([]);

  const active = m.vdis.filter((d) => d.cases > 0);
  const totalAvail = active.reduce((s, d) => s + d.availableHours, 0);
  const totalActive = active.reduce((s, d) => s + d.activeHours, 0);
  const totalIdle = active.reduce((s, d) => s + d.idleHours, 0);
  const avgUtil = totalAvail ? totalActive / totalAvail : 0;
  const totalCost = m.vdis.reduce((s, d) => s + d.cost, 0);

  const utilColor = (u: number) => (u >= TARGETS.utilMax ? v.bad : u >= TARGETS.utilMin ? v.good : v.business);

  // Spoke-grouped utilisation strip (left card): group every digital worker
  // by owning spoke, each group sorted busiest-first — a flat, ungrouped
  // list didn't give any orientation for which spoke's workers a bar
  // belonged to besides a truncated inline label.
  const spokeGroups = (() => {
    const byGroupSpoke = new Map<string, VdiAgg[]>();
    for (const d of m.vdis) {
      if (!byGroupSpoke.has(d.spoke)) byGroupSpoke.set(d.spoke, []);
      byGroupSpoke.get(d.spoke)!.push(d);
    }
    return [...byGroupSpoke.entries()]
      .map(([spoke, ds]) => [spoke, [...ds].sort((a, b) => b.utilPct - a.utilPct)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const columns: Column<VdiAgg>[] = [
    { key: "name", header: "Digital worker", render: (r) => (
      <span>
        <span style={{ fontWeight: 600 }}>{r.name}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 10.5, color: t.inkSoft, marginLeft: 8 }}>{r.spoke}</span>
      </span>
    ) },
    { key: "processes", header: "Processes", align: "right" },
    { key: "cases", header: "Items", align: "right", render: (r) => fmtInt(r.cases) },
    { key: "activeHours", header: "Active hrs", align: "right", render: (r) => fmtCompact(r.activeHours) },
    { key: "idlePct", header: "Idle %", align: "right", render: (r) => <span style={{ color: r.idlePct > 0.9 ? v.bad : t.ink }}>{fmtPct(r.idlePct, 0)}</span> },
    { key: "utilPct", header: "Utilisation", align: "right", width: 150, render: (r) => <CellBar value={r.utilPct} max={1} color={utilColor(r.utilPct)} /> },
    { key: "cost", header: "Estate cost share", align: "right", render: (r) => fmtGBP(r.cost) },
  ];

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Active digital workers" value={String(active.length)} accent={t.series} sub={`of ${m.vdis.length} in the estate`} />
        <KpiCard label="Average utilisation" value={fmtPct(avgUtil, 0)} accent={utilColor(avgUtil)} sub={`${fmtCompact(totalActive)} of ${fmtCompact(totalAvail)} hrs`} target={{ label: `Target ${fmtPct(TARGETS.utilMin, 0)}–${fmtPct(TARGETS.utilMax, 0)}`, met: avgUtil >= TARGETS.utilMin && avgUtil <= TARGETS.utilMax }} />
        <KpiCard label="Spare capacity" value={fmtCompact(totalIdle)} accent={v.business} sub="hours available for new automations" />
        <KpiCard label="Estate cost (period)" value={fmtGBP(totalCost)} accent={v.system} sub="hub pool + spoke infra, apportioned" />
      </div>

      <Row cols="minmax(0,1fr) minmax(0,1.15fr)">
        <VisualCard title="Utilisation by digital worker" subtitle="Active runtime against licensed operating hours — grouped by owning spoke" scroll>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
            {spokeGroups.map(([spoke, ds]) => (
              <div key={spoke}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 6px", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: t.inkSoft }}>
                  <SpokeSwatch spoke={spoke} decorative />
                  {spoke}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {ds.map((d) => (
                    <div key={d.id} style={{ display: "grid", gridTemplateColumns: "84px 1fr 46px", gap: 10, alignItems: "center" }}>
                      <span style={{ fontFamily: fonts.mono, fontSize: 11.5, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${d.spoke} · ${d.pool}`}>{d.name.replace("VDI-RPA-", "")}</span>
                      <span style={{ height: 18, background: v.grid, borderRadius: 5, overflow: "hidden", position: "relative" }}>
                        <span style={{ position: "absolute", inset: 0, width: `${Math.max(1, d.utilPct * 100)}%`, background: utilColor(d.utilPct), borderRadius: 5 }} />
                      </span>
                      <span style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink, textAlign: "right" }}>{fmtPct(d.utilPct, 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, lineHeight: 1.5 }}>
              Low utilisation is spare capacity available for new automations; high utilisation flags a worker at risk of becoming a bottleneck. Each spoke runs on its own VDIs, so the spoke slicer shows exactly the machines that spoke pays for.
            </p>
          </div>
        </VisualCard>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <VisualCard
            title="VDI capacity table"
            subtitle="Sortable — default by utilisation"
            style={{ flex: "1 1 auto", minHeight: 0 }}
            right={<ExportCsvButton filename="vdi-capacity" rows={() => sortedRows.map((r) => ({ "Digital worker": r.name, Spoke: r.spoke, Processes: r.processes, Items: r.cases, "Active hrs": r.activeHours.toFixed(1), "Idle %": (r.idlePct * 100).toFixed(1), "Utilisation %": (r.utilPct * 100).toFixed(1), "Estate cost share": r.cost.toFixed(2) }))} />}
          >
            <DataTable columns={columns} rows={m.vdis} initialSort={{ key: "utilPct", dir: "desc" }} onSortedChange={setSortedRows} />
          </VisualCard>

          <VisualCard
            title="Capacity & cost summary"
            subtitle="Utilisation vs healthy band, and where the spend goes"
            style={{ flex: "0 0 auto" }}
            summary={`Average utilisation ${fmtPct(avgUtil, 0)}, target ${fmtPct(TARGETS.utilMax, 0)}. Licensed capacity ${fmtCompact(totalAvail)} hours. Productive bot time ${fmtCompact(totalActive)} hours. Estate cost, apportioned, ${fmtGBP(totalCost)}.`}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16, height: "100%", paddingTop: 2 }}>
              <div style={{ flex: "0 0 auto" }}>
                <Gauge value={avgUtil} min={0} max={1} size={120} band={[TARGETS.utilMin, TARGETS.utilMax]} target={TARGETS.utilMax} color={utilColor(avgUtil)} format={(n) => fmtPct(n, 0)} label="Utilisation" />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {[
                { k: "Licensed capacity", val: `${fmtCompact(totalAvail)} h` },
                { k: "Productive bot time", val: `${fmtCompact(totalActive)} h` },
                { k: "Estate cost, apportioned", val: fmtGBP(totalCost) },
              ].map((r, i) => (
                <div key={r.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                  <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>{r.k}</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 13.5, fontWeight: 700, color: t.ink }}>{r.val}</span>
                </div>
              ))}
              </div>
            </div>
          </VisualCard>
        </div>
      </Row>
    </PageGrid>
  );
}
