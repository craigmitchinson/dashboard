import { useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { fmtDate, EX_CODE } from "../rpaData";
import type { ExceptionAgg } from "../filters-context";
import { KpiCard, VisualCard, DataTable, SearchBox, PageGrid, Row, useViz, fmtInt, fmtCompact, fmtPct, fmtGBP } from "../components/viz";
import type { Column } from "../components/viz";

function abbr(name: string) {
  return name
    .split(/[\s/]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function Exceptions() {
  const { model, filters, setFilters } = useFilters();
  const activeProc = filters.processId !== "All" ? filters.processId : undefined;
  const m = model;
  const v = useViz();
  const t = useTheme();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "system" | "business">("all");

  const { processes, types, cell, max } = m.matrix;

  const colTotals = types.map((_, ci) => cell.reduce((s, row) => s + row[ci], 0));
  const rowTotals = cell.map((row) => row.reduce((s, val) => s + val, 0));
  const rowMax = Math.max(1, ...rowTotals);

  const heat = (val: number, category: "system" | "business") => {
    const base = category === "system" ? v.system : v.business;
    const a = max ? val / max : 0;
    const alpha = val === 0 ? 0 : 0.12 + a * 0.8;
    return `${base}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  };

  const tableRows = m.byException
    .filter((e) => (cat === "all" ? true : e.category === cat))
    .filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));

  const columns: Column<ExceptionAgg>[] = [
    {
      key: "name",
      header: "Exception",
      render: (r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.category === "system" ? v.system : v.business, flex: "0 0 auto" }} />
          {r.name}
          <span style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft }}>{r.category === "system" ? "Sys" : "Bus"}</span>
        </span>
      ),
    },
    { key: "volume", header: "Volume", align: "right", render: (r) => fmtInt(r.volume) },
    { key: "pct", header: "% of total", align: "right", render: (r) => fmtPct(r.pct, 1) },
    { key: "costGBP", header: "Cost", align: "right", render: (r) => fmtGBP(r.costGBP) },
    { key: "lastSeenTs", header: "Most recent", align: "right", render: (r) => (r.lastSeenTs ? fmtDate(r.lastSeenTs) : "—") },
  ];

  const colW = `minmax(150px, 1.4fr) repeat(${types.length}, minmax(30px, 1fr)) minmax(56px, 0.95fr)`;

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Total exceptions" value={fmtCompact(m.exceptions)} accent={v.accent} delta={m.prev.exceptions ? (m.exceptions - m.prev.exceptions) / m.prev.exceptions : 0} deltaGood="down" sub="vs prev. period" />
        <KpiCard label="System exceptions" value={fmtCompact(m.system)} accent={v.system} sub={`${fmtPct(m.exceptions ? m.system / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Business exceptions" value={fmtCompact(m.business)} accent={v.business} sub={`${fmtPct(m.exceptions ? m.business / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Exception cost (period)" value={fmtGBP(m.exceptionCostGBP)} accent={v.bad} sub={`${fmtGBP(m.exceptionCostBusinessGBP)} business · ${fmtGBP(m.exceptionCostSystemGBP)} system`} />
      </div>

      <Row cols="1fr" style={{ flex: 2.1 }}>
        <VisualCard title="Exception heatmap" subtitle="Volume by process (rows) and exception type (columns) — darker is more">
        <div style={{ overflow: "auto", paddingBottom: 4, height: "100%" }}>
          <div style={{ minWidth: 720, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* header */}
            <div style={{ flex: "0 0 auto", display: "grid", gridTemplateColumns: colW, gap: 2, alignItems: "end", marginBottom: 3 }}>
              <span />
              {types.map((ty) => (
                <span key={ty.name} title={ty.name} style={{ fontFamily: fonts.mono, fontSize: 9.5, fontWeight: 700, color: ty.category === "system" ? v.system : v.business, textAlign: "center", letterSpacing: "0.02em" }}>{EX_CODE[ty.name] ?? abbr(ty.name)}</span>
              ))}
              <span style={{ fontFamily: fonts.mono, fontSize: 9.5, fontWeight: 700, color: t.inkSoft, textAlign: "center", letterSpacing: "0.02em" }}>TOTAL</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 2 }}>
              {processes.map((p, ri) => (
                <div key={p.id} style={{ flex: "1 1 21px", minHeight: 21, display: "grid", gridTemplateColumns: colW, gap: 2, opacity: activeProc && activeProc !== p.id ? 0.4 : 1 }}>
                  <span
                    className="click-row"
                    role="button"
                    tabIndex={0}
                    aria-pressed={activeProc === p.id}
                    onClick={() => setFilters({ processId: activeProc === p.id ? "All" : p.id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setFilters({ processId: activeProc === p.id ? "All" : p.id });
                      }
                    }}
                    style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: activeProc === p.id ? 700 : 400, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 6px 0 4px", margin: "0 0 0 -4px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center" }}
                    title={`Filter to ${p.name}`}
                  >{p.name}</span>
                  {types.map((ty, ci) => {
                    const val = cell[ri][ci];
                    const strong = max && val / max > 0.55;
                    return (
                      <span key={ty.name} title={`${p.name} · ${ty.name}: ${fmtInt(val)}`} style={{ background: heat(val, ty.category), borderRadius: 4, height: "100%", minHeight: 21, display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 600, color: strong ? t.paper : t.inkSoft }}>
                        {val > 0 ? fmtCompact(val) : ""}
                      </span>
                    );
                  })}
                  <span title={`${p.name} · total: ${fmtInt(rowTotals[ri])}`} style={{ display: "flex", alignItems: "center", gap: 6, height: "100%", minHeight: 21 }}>
                    <span style={{ flex: 1, height: 7, background: v.grid, borderRadius: 3, overflow: "hidden", position: "relative" }}>
                      <span style={{ position: "absolute", inset: 0, width: `${Math.max(2, (rowTotals[ri] / rowMax) * 100)}%`, background: v.accent, borderRadius: 3 }} />
                    </span>
                    <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink, textAlign: "right", minWidth: 20 }}>{fmtCompact(rowTotals[ri])}</span>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ flex: "0 0 auto", display: "grid", gridTemplateColumns: colW, gap: 2, marginTop: 4, paddingTop: 4, borderTop: `1px solid ${t.ruleSoft}` }}>
              <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: t.inkSoft, display: "flex", alignItems: "center", padding: "0 6px 0 4px" }}>Total</span>
              {types.map((ty, ci) => (
                <span key={ty.name} title={`${ty.name} total: ${fmtInt(colTotals[ci])}`} style={{ display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink }}>{fmtCompact(colTotals[ci])}</span>
              ))}
              <span style={{ display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink }}>{fmtCompact(rowTotals.reduce((s, val) => s + val, 0))}</span>
            </div>
            <div style={{ flex: "0 0 auto", display: "flex", gap: 16, marginTop: 8, fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: v.system }} /> System types</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: v.business }} /> Business types</span>
              <span>Column codes are initials — hover a cell or header for the full name.</span>
            </div>
          </div>
        </div>
        </VisualCard>
      </Row>

      <Row cols="1fr">
      <VisualCard
        title="Exception detail"
        subtitle="Every exception type across the current filters"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "inline-flex", border: `1px solid ${t.ruleSoft}`, borderRadius: 8, overflow: "hidden" }}>
              {(["all", "system", "business"] as const).map((c) => (
                <button key={c} onClick={() => setCat(c)} style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", padding: "5px 10px", border: "none", cursor: "pointer", background: cat === c ? t.ink : "transparent", color: cat === c ? t.paper : t.inkSoft, fontWeight: 700 }}>{c}</button>
              ))}
            </div>
            <SearchBox value={q} onChange={setQ} placeholder="Search exception…" />
          </div>
        }
      >
        <DataTable columns={columns} rows={tableRows} initialSort={{ key: "volume", dir: "desc" }} />
      </VisualCard>
      </Row>
    </PageGrid>
  );
}
