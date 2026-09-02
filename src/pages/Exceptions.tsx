import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { fonts, type as typeScale } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters, DEFAULT_FILTERS } from "../filters-context";
import { fmtDate, EX_CODE } from "../rpaData";
import type { ExceptionAgg } from "../filters-context";
import { KpiCard, VisualCard, DataTable, SearchBox, PageGrid, Row, Segmented, EmptyState, useViz, fmtInt, fmtCompact, fmtPct, fmtGBP } from "../components/viz";
import type { Column } from "../components/viz";
import { ExportCsvButton } from "../components/PageActions";
import { SpokeSwatch } from "../components/SpokeSwatch";

// Small hover/focus tooltip using the app's existing `.tip`/`.tip__bubble`
// CSS pattern (styles.css) instead of the native `title` attribute — same
// convention already used by admin/shared.tsx's LockBadge inside a
// scrollable table body. `below` flips the bubble under the trigger (used
// for the header row, so it never renders above the card's own top edge).
function CellTip({ children, tip, below, style }: { children: ReactNode; tip: string; below?: boolean; style?: CSSProperties }) {
  const t = useTheme();
  return (
    <span className="tip" tabIndex={0} style={{ position: "relative", width: "100%", ...style }}>
      {children}
      <span role="tooltip" className={`tip__bubble${below ? " tip__bubble--below" : ""}`} style={{ width: "auto", maxWidth: 240 }}>
        <span style={{ display: "block", whiteSpace: "nowrap", background: t.paper, color: t.ink, border: `1px solid ${t.ruleSoft}`, borderRadius: 7, padding: "6px 9px", fontFamily: fonts.body, fontSize: 12, boxShadow: t.shadow }}>
          {tip}
        </span>
      </span>
    </span>
  );
}

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
  const [sortedRows, setSortedRows] = useState<ExceptionAgg[]>([]);

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

  // Memoized (not recomputed as a fresh array every render): DataTable's
  // onSortedChange feeds this page's own sortedRows state, so an unmemoized
  // `.filter().filter()` here — a new array reference every render even
  // when cat/q/m.byException haven't changed — would retrigger DataTable's
  // internal sort memo, refire its onSortedChange effect, setState here,
  // and loop forever (React's "Maximum update depth exceeded").
  const tableRows = useMemo(
    () => m.byException.filter((e) => (cat === "all" ? true : e.category === cat)).filter((e) => e.name.toLowerCase().includes(q.toLowerCase())),
    [m.byException, cat, q],
  );

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

  // Fixed-px label and total columns (not `minmax(…, fr)`) so the header
  // row, every process row and the totals row — three SEPARATE CSS grids,
  // not one table — always compute the SAME track widths. With a flexible
  // first column, each grid's track width depended on THAT grid's own
  // content (a long process name in one row's min-content could force a
  // wider column than a header/other row with shorter content), so columns
  // silently drifted out of alignment row to row — the reported "icons
  // misaligned, columns squashed" heatmap mess. Only the label/total ends
  // are content-length-sensitive; the exception-type columns hold short,
  // consistently-sized numbers so `minmax(30px, 1fr)` stays safe there.
  const colW = `160px repeat(${types.length}, minmax(30px, 1fr)) 72px`;

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Total exceptions" value={fmtCompact(m.exceptions)} accent={t.series} delta={m.prev.exceptions ? (m.exceptions - m.prev.exceptions) / m.prev.exceptions : 0} deltaGood="down" sub="vs prev. period" />
        <KpiCard label="System exceptions" value={fmtCompact(m.system)} accent={v.system} sub={`${fmtPct(m.exceptions ? m.system / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Business exceptions" value={fmtCompact(m.business)} accent={v.business} sub={`${fmtPct(m.exceptions ? m.business / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Exception cost (period)" value={fmtGBP(m.exceptionCostGBP)} accent={v.bad} sub={`${fmtGBP(m.exceptionCostBusinessGBP)} business · ${fmtGBP(m.exceptionCostSystemGBP)} system`} />
      </div>

      <Row cols="1fr" style={{ flex: 1.6 }}>
        <VisualCard title="Exception heatmap" subtitle="Volume by process (rows) and exception type (columns) — darker is more">
        {processes.length === 0 ? (
          <EmptyState onReset={() => setFilters(DEFAULT_FILTERS)} />
        ) : (
        <div style={{ overflow: "auto", paddingBottom: 4, height: "100%" }}>
          <div style={{ minWidth: 720, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* header */}
            <div style={{ flex: "0 0 auto", display: "grid", gridTemplateColumns: colW, gap: 2, alignItems: "end", marginBottom: 3 }}>
              <span />
              {types.map((ty) => (
                <CellTip key={ty.name} tip={ty.name} below style={{ justifyContent: "center" }}>
                  <span style={{ fontFamily: typeScale.micro.fontFamily, fontSize: typeScale.micro.fontSize, fontWeight: 700, color: ty.category === "system" ? v.system : v.business, textAlign: "center", letterSpacing: "0.02em" }}>{EX_CODE[ty.name] ?? abbr(ty.name)}</span>
                </CellTip>
              ))}
              <span style={{ fontFamily: typeScale.micro.fontFamily, fontSize: typeScale.micro.fontSize, fontWeight: 700, color: t.inkSoft, textAlign: "center", letterSpacing: "0.02em" }}>TOTAL</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 2 }}>
              {processes.map((p, ri) => (
                <div key={p.id} style={{ flex: "1 1 22px", minHeight: 22, display: "grid", gridTemplateColumns: colW, gap: 2, alignItems: "stretch", opacity: activeProc && activeProc !== p.id ? 0.4 : 1 }}>
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
                    style={{ minWidth: 0, padding: "0 6px 0 4px", margin: "0 0 0 -4px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                    title={`Filter to ${p.name}`}
                  >
                    <SpokeSwatch spoke={p.spoke} decorative />
                    <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: activeProc === p.id ? 700 : 400, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>{p.name}</span>
                  </span>
                  {types.map((ty, ci) => {
                    const val = cell[ri][ci];
                    const strong = max && val / max > 0.55;
                    return (
                      <CellTip key={ty.name} tip={`${p.name} · ${ty.name}: ${fmtInt(val)}`} style={{ height: "100%" }}>
                        <span style={{ background: heat(val, ty.category), borderRadius: 4, height: "100%", minHeight: 22, display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 600, color: strong ? t.paper : t.inkSoft }}>
                          {val > 0 ? fmtCompact(val) : ""}
                        </span>
                      </CellTip>
                    );
                  })}
                  <CellTip tip={`${p.name} · total: ${fmtInt(rowTotals[ri])}`} style={{ display: "flex", alignItems: "center", gap: 6, height: "100%", minHeight: 22 }}>
                    <span style={{ flex: 1, height: 7, background: v.grid, borderRadius: 3, overflow: "hidden", position: "relative" }}>
                      <span style={{ position: "absolute", inset: 0, width: `${Math.max(2, (rowTotals[ri] / rowMax) * 100)}%`, background: t.series, borderRadius: 3 }} />
                    </span>
                    <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink, textAlign: "right", minWidth: 20 }}>{fmtCompact(rowTotals[ri])}</span>
                  </CellTip>
                </div>
              ))}
            </div>
            <div style={{ flex: "0 0 auto", display: "grid", gridTemplateColumns: colW, gap: 2, marginTop: 4, paddingTop: 4, borderTop: `1px solid ${t.ruleSoft}` }}>
              <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: t.inkSoft, display: "flex", alignItems: "center", padding: "0 6px 0 4px" }}>Total</span>
              {types.map((ty, ci) => (
                <CellTip key={ty.name} tip={`${ty.name} total: ${fmtInt(colTotals[ci])}`} style={{ display: "grid", placeItems: "center" }}>
                  <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink }}>{fmtCompact(colTotals[ci])}</span>
                </CellTip>
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
        )}
        </VisualCard>
      </Row>

      <Row cols="1fr">
      <VisualCard
        title="Exception detail"
        subtitle="Every exception type across the current filters"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Segmented
              value={cat}
              onChange={setCat}
              options={[{ value: "all", label: "All" }, { value: "system", label: "System" }, { value: "business", label: "Business" }]}
            />
            <SearchBox value={q} onChange={setQ} placeholder="Search exception…" />
            <ExportCsvButton
              filename="exceptions"
              rows={() => sortedRows.map((r) => ({ Exception: r.name, Category: r.category, Volume: r.volume, "% of total": (r.pct * 100).toFixed(2), Cost: r.costGBP.toFixed(2), "Most recent": r.lastSeenTs ? fmtDate(r.lastSeenTs) : "" }))}
            />
          </div>
        }
      >
        {/* maxBodyHeight caps the table's own natural/intrinsic height instead
            of letting it grow to fit every row unconstrained — without this,
            DataTable (viz.tsx) happily renders all rows at full height, which
            (via how `.report__canvas`'s flex column sizes itself off its
            content when unconstrained by the viewport) was the real reason
            the detail table needed scrolling well below the fold at 1440×900
            even after the heatmap's flex share above was cut from 2.1 to 1.6.
            360px comfortably clears the ≥6-row bar (header + ~9 rows) while
            still leaving its own internal scrollbar for the rest. */}
        <DataTable columns={columns} rows={tableRows} initialSort={{ key: "volume", dir: "desc" }} maxBodyHeight={360} onSortedChange={setSortedRows} />
      </VisualCard>
      </Row>
    </PageGrid>
  );
}
