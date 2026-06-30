import { useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { fmtDate, EX_CODE } from "../rpaData";
import type { ExceptionAgg } from "../filters-context";
import { KpiCard, VisualCard, DataTable, SearchBox, PageGrid, Row, useViz, fmtInt, fmtCompact, fmtPct, fmtGBP } from "../components/viz";
import type { Column } from "../components/viz";

// average manual effort to triage/rework an exception (mins) — the cost lever
// behind the exception count.
const REWORK_MIN = 10;

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
  const { model } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "system" | "business">("all");

  const reworkHours = (m.exceptions * REWORK_MIN) / 60;
  const reworkCost = reworkHours * m.peopleRate;

  const { processes, types, cell, max } = m.matrix;

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
    { key: "lastSeenTs", header: "Most recent", align: "right", render: (r) => (r.lastSeenTs ? fmtDate(r.lastSeenTs) : "—") },
  ];

  const colW = `minmax(150px, 1.4fr) repeat(${types.length}, minmax(30px, 1fr))`;

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Total exceptions" value={fmtCompact(m.exceptions)} accent={v.accent} delta={m.prev.exceptions ? (m.exceptions - m.prev.exceptions) / m.prev.exceptions : 0} deltaGood="down" sub="vs prev. period" />
        <KpiCard label="System exceptions" value={fmtCompact(m.system)} accent={v.system} sub={`${fmtPct(m.exceptions ? m.system / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Business exceptions" value={fmtCompact(m.business)} accent={v.business} sub={`${fmtPct(m.exceptions ? m.business / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Est. manual rework cost" value={fmtGBP(reworkCost)} accent={v.bad} sub={`${fmtCompact(reworkHours)} h at ${REWORK_MIN}m each`} />
      </div>

      <Row cols="1fr" style={{ flex: 1.7 }}>
        <VisualCard title="Exception heatmap" subtitle="Volume by process (rows) and exception type (columns) — darker is more">
        <div style={{ overflow: "auto", paddingBottom: 4, height: "100%" }}>
          <div style={{ minWidth: 720 }}>
            {/* header */}
            <div style={{ display: "grid", gridTemplateColumns: colW, gap: 2, alignItems: "end", marginBottom: 3 }}>
              <span />
              {types.map((ty) => (
                <span key={ty.name} title={ty.name} style={{ fontFamily: fonts.mono, fontSize: 9.5, fontWeight: 700, color: ty.category === "system" ? v.system : v.business, textAlign: "center", letterSpacing: "0.02em" }}>{EX_CODE[ty.name] ?? abbr(ty.name)}</span>
              ))}
            </div>
            {processes.map((p, ri) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: colW, gap: 2, marginBottom: 2 }}>
                <span style={{ fontFamily: fonts.body, fontSize: 12, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 6, display: "flex", alignItems: "center" }} title={p.name}>{p.name}</span>
                {types.map((ty, ci) => {
                  const val = cell[ri][ci];
                  const strong = max && val / max > 0.55;
                  return (
                    <span key={ty.name} title={`${p.name} · ${ty.name}: ${fmtInt(val)}`} style={{ background: heat(val, ty.category), borderRadius: 4, height: 21, display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 600, color: strong ? t.paper : t.inkSoft }}>
                      {val > 0 ? fmtCompact(val) : ""}
                    </span>
                  );
                })}
              </div>
            ))}
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft }}>
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
