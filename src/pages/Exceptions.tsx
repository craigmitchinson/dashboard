import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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

  // ONE CSS grid for the whole heatmap — header row, every process row and
  // the totals row are all direct children of a single grid container
  // (React fragments per row, so they contribute cells without an
  // intervening DOM element), not three separate grids. Three separate
  // grids (the previous approach) each recomputed their own track widths
  // off their own content, which is exactly what drifted them out of
  // alignment; one grid has exactly one set of tracks, so every row is
  // structurally guaranteed to share them. The label and totals columns are
  // fixed px (170/72); every exception-type column is `minmax(0, 1fr)` —
  // NOT `minmax(30px, 1fr)` — so the coloured cell inside actually stretches
  // edge-to-edge to fill its track at any width instead of leaving slack.
  const colW = `170px repeat(${types.length}, minmax(0, 1fr)) 72px`;
  // Uniform row height for the heatmap body — tightened further to 20px (2px
  // below the original 22–28px "still reads as a heatmap" range) because
  // 22px alone still left the full 14-row grid ~65px taller than the space
  // left over once the detail table below claims its own fixed 3-row
  // region — the last row or two would otherwise only be reachable via the
  // heatmap's OWN internal scroll (`.heat-scroll--fade`), which technically
  // keeps `.report__canvas` itself unscrolled but defeats "all 14 rows
  // visible at once". Paired with tighter header/totals padding below, this
  // closes that gap with the grid still comfortably legible at 1440×900.
  const ROW_H = 20;
  const gridTemplateRows = `auto repeat(${processes.length}, ${ROW_H}px) auto`;
  const headerCellStyle: CSSProperties = { paddingBottom: 3, borderBottom: `1px solid ${t.ruleSoft}` };
  const totalCellStyle: CSSProperties = { paddingTop: 3, borderTop: `1px solid ${t.ruleSoft}` };

  // The heatmap card is now SIZED TO ITS CONTENT (Row grow={false} below),
  // not stretched to a fixed flex share of the page — every process row is
  // guaranteed to be on screen at once by construction, instead of being at
  // the mercy of a fixed height that content taller than it silently clips.
  // heatScrollRef + heatOverflowing exist only for the pathological case (a
  // hub with far more processes than today's ~14): heatMaxH caps growth so
  // one enormous heatmap can't push the whole page absurdly tall, and if
  // that cap is ever actually hit, `.heat-scroll--fade` (styles.css) adds
  // the bottom fade + the app's normal styled scrollbar so the cut-off reads
  // as "more below, scroll" rather than silently missing rows again.
  const heatMaxH = 640;
  const heatScrollRef = useRef<HTMLDivElement>(null);
  const [heatOverflowing, setHeatOverflowing] = useState(false);
  useEffect(() => {
    const el = heatScrollRef.current;
    if (!el) return;
    const check = () => setHeatOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [processes.length, types.length]);

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--4">
        <KpiCard label="Total exceptions" value={fmtCompact(m.exceptions)} accent={t.series} delta={m.prev.exceptions ? (m.exceptions - m.prev.exceptions) / m.prev.exceptions : 0} deltaGood="down" sub="vs prev. period" />
        <KpiCard label="System exceptions" value={fmtCompact(m.system)} accent={v.system} sub={`${fmtPct(m.exceptions ? m.system / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Business exceptions" value={fmtCompact(m.business)} accent={v.business} sub={`${fmtPct(m.exceptions ? m.business / m.exceptions : 0, 0)} of exceptions`} />
        <KpiCard label="Exception cost (period)" value={fmtGBP(m.exceptionCostGBP)} accent={v.bad} sub={`${fmtGBP(m.exceptionCostBusinessGBP)} business · ${fmtGBP(m.exceptionCostSystemGBP)} system`} />
      </div>

      {/* Takes the REMAINING canvas height (grow, default weight) once the
          detail Row below claims its own small fixed region — every process
          row is still guaranteed on screen by construction (the grid's rows
          are fixed ROW_H px each; growing the Row only ever adds slack
          space around the card, it never shrinks the grid below its content
          height). */}
      <Row cols="1fr">
        <VisualCard title="Exception heatmap" subtitle="Volume by process (rows), exception type (columns) — stronger colour = more. Column codes are initials; hover a cell or header for the full name.">
        {processes.length === 0 ? (
          <EmptyState onReset={() => setFilters(DEFAULT_FILTERS)} />
        ) : (
        <div ref={heatScrollRef} className={heatOverflowing ? "heat-scroll--fade" : undefined} style={{ overflow: "auto", maxHeight: heatMaxH }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: colW, gridTemplateRows, columnGap: 1, rowGap: 0 }}>
              {/* header row */}
              <span style={headerCellStyle} />
              {types.map((ty) => (
                <CellTip key={ty.name} tip={ty.name} below style={{ justifyContent: "center", alignItems: "end", ...headerCellStyle }}>
                  <span style={{ fontFamily: typeScale.micro.fontFamily, fontSize: typeScale.micro.fontSize, fontWeight: 700, color: ty.category === "system" ? v.system : v.business, textAlign: "center", letterSpacing: "0.02em" }}>{EX_CODE[ty.name] ?? abbr(ty.name)}</span>
                </CellTip>
              ))}
              <span style={{ fontFamily: typeScale.micro.fontFamily, fontSize: typeScale.micro.fontSize, fontWeight: 700, color: t.inkSoft, textAlign: "center", letterSpacing: "0.02em", display: "flex", alignItems: "end", justifyContent: "center", ...headerCellStyle }}>TOTAL</span>

              {/* one process row per iteration — a Fragment contributes its
                  children straight to the single grid, no wrapping element */}
              {processes.map((p, ri) => (
                <Fragment key={p.id}>
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
                    style={{ minWidth: 0, padding: "0 6px 0 4px", margin: "0 0 0 -4px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, opacity: activeProc && activeProc !== p.id ? 0.4 : 1 }}
                    title={`Filter to ${p.name}`}
                  >
                    <SpokeSwatch spoke={p.spoke} decorative />
                    <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: activeProc === p.id ? 700 : 400, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>{p.name}</span>
                  </span>
                  {types.map((ty, ci) => {
                    const val = cell[ri][ci];
                    const strong = max && val / max > 0.55;
                    return (
                      <CellTip key={ty.name} tip={`${p.name} · ${ty.name}: ${fmtInt(val)}`} style={{ height: "100%", opacity: activeProc && activeProc !== p.id ? 0.4 : 1 }}>
                        {/* explicit width:100% — the `.tip` wrapper (display:
                            inline-flex) stretches to fill the grid column,
                            but a flex CHILD with no width/flex-grow of its
                            own still shrinks to its number's content width
                            and centres inside that stretched wrapper — a
                            small coloured square floating in a wide column
                            instead of a block that fills it. Width 100% is
                            what actually makes the tint fill the cell. */}
                        <span style={{ background: heat(val, ty.category), borderRadius: 3, height: "100%", width: "100%", display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 600, color: strong ? t.paper : t.inkSoft }}>
                          {val > 0 ? fmtCompact(val) : ""}
                        </span>
                      </CellTip>
                    );
                  })}
                  <CellTip tip={`${p.name} · total: ${fmtInt(rowTotals[ri])}`} style={{ display: "flex", alignItems: "center", gap: 6, height: "100%", opacity: activeProc && activeProc !== p.id ? 0.4 : 1 }}>
                    <span style={{ flex: 1, height: 7, background: v.grid, borderRadius: 3, overflow: "hidden", position: "relative" }}>
                      <span style={{ position: "absolute", inset: 0, width: `${Math.max(2, (rowTotals[ri] / rowMax) * 100)}%`, background: t.series, borderRadius: 3 }} />
                    </span>
                    <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink, textAlign: "right", minWidth: 20 }}>{fmtCompact(rowTotals[ri])}</span>
                  </CellTip>
                </Fragment>
              ))}

              {/* totals row */}
              <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: t.inkSoft, display: "flex", alignItems: "center", padding: "0 6px 0 4px", ...totalCellStyle }}>Total</span>
              {types.map((ty, ci) => (
                <CellTip key={ty.name} tip={`${ty.name} total: ${fmtInt(colTotals[ci])}`} style={{ display: "grid", placeItems: "center", ...totalCellStyle }}>
                  <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink }}>{fmtCompact(colTotals[ci])}</span>
                </CellTip>
              ))}
              <span style={{ display: "grid", placeItems: "center", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.ink, ...totalCellStyle }}>{fmtCompact(rowTotals.reduce((s, val) => s + val, 0))}</span>
            </div>
            {/* The System/Business colour-key + "hover for full name" hint
                used to live in its own row here — folded into the card's
                subtitle above instead (the column header codes are already
                tinted system/business, same as before) so it no longer
                costs its own ~21px of scrollable content height, which was
                the difference between all 14 rows fitting at 1440×900
                without the heatmap's own internal scroll kicking in. */}
          </div>
        </div>
        )}
        </VisualCard>
      </Row>

      {/* grow={false}: sized to its OWN small content — a 3-row visible
          region (DataTable's maxBodyHeight below) that scrolls internally
          for the rest, rather than a flex share of the page. This (plus
          ROW_H 22 on the heatmap above) is what makes the whole page fit
          .report__canvas with no page scroll at 1440×900 while still
          showing all 14 heatmap rows — the previous ≥5-row fixed floor
          (296px) was the ~160px of overflow this trades away. */}
      <Row cols="1fr" grow={false}>
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
        {/* A 3-row visible region (DataTable's own header ~29.5px + 3 data
            rows at ~36.3px each ≈ 138px) that scrolls internally for the
            rest — `.viz-scroll` (primitives.css) adds the same bottom-fade
            affordance the heatmap card already uses (`.heat-scroll--fade`)
            so "more below, scroll" reads the same way in both places. This
            wrapper's own fixed height is what the Row above (grow={false})
            sizes itself to. */}
        <div className="viz-scroll" style={{ height: 138 }}>
          <DataTable columns={columns} rows={tableRows} initialSort={{ key: "volume", dir: "desc" }} onSortedChange={setSortedRows} />
        </div>
      </VisualCard>
      </Row>
    </PageGrid>
  );
}
