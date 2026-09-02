import { useEffect, useState } from "react";
import { fonts, type as typeScale } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { useNavOrigin } from "../nav-context";
import { PROCESS_BY_ID, PROCESSES, fmtDate } from "../rpaData";
import type { ProcessDim } from "../rpaData";
import { KpiCard, VisualCard, LineChart, HBarChart, Legend, PageGrid, Row, SearchBox, useViz, fmtInt, fmtCompact, fmtPct, fmtMoney2, fmtGBP } from "../components/viz";
import { SpokeSwatch, spokeColorFor } from "../components/SpokeSwatch";

// Origin page id -> display label for the drill-through breadcrumb. Kept
// local (rather than reusing src/page-labels.ts) because that shared module
// intentionally only carries the subset of labels the Alerts feature needs
// (see its header comment) — "process" (Process Analysis) and
// "input-outcome" in particular are missing there, and this page can be
// drilled into from either. Falls back to "Process Analysis" (the primary,
// most common drill-through origin) when the origin is unknown or absent.
const ORIGIN_LABEL: Record<string, string> = {
  overview: "Overview",
  alerts: "Alerts",
  "input-outcome": "Input & Outcome",
  process: "Process Analysis",
  exceptions: "Exceptions",
  capacity: "VDI & Capacity",
  value: "Value & Finance",
  commercial: "Commercial Performance",
};

export function ProcessDetail() {
  const { model, filters, setFilters, processOptions } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const navOrigin = useNavOrigin();
  const [query, setQuery] = useState("");

  // processOptions is already cascade-filtered by filters.spoke + filters.proposition
  // (see filters-context.tsx) — the chooser and every list on this page must be
  // built from it (or from PROCESSES narrowed to its ids), never straight from
  // PROCESSES, or a spoke/proposition slicer stops narrowing this page (the bug
  // this guards against: the chooser used to render every spoke's processes
  // regardless of the active slicer).
  const inScopeIds = new Set(processOptions.map((p) => p.id));
  const rawProc = filters.processId !== "All" ? PROCESS_BY_ID.get(filters.processId) : undefined;
  const proc = rawProc && inScopeIds.has(rawProc.id) ? rawProc : undefined;

  // If a process is drilled in but falls outside the now-active spoke/
  // proposition filter (e.g. the slicer changed after the drill), deselect it
  // — return to the chooser rather than showing a mismatched drill-through —
  // instead of merely rendering as if unselected while filters.processId
  // stays stale (which would leave other pages/breadcrumbs pointing at a
  // process that's no longer in scope).
  useEffect(() => {
    if (rawProc && !proc) setFilters({ processId: "All" });
  }, [rawProc, proc, setFilters]);

  // no selection → a mini-league chooser: the three worst-performing
  // processes (by exception rate, from the filtered model) surfaced first,
  // then every in-scope process grouped by spoke under a swatch header (when
  // no spoke slicer already narrows to one), searchable by name/queue.
  if (!proc) {
    const q = query.trim().toLowerCase();
    const matches = (p: ProcessDim) => !q || p.name.toLowerCase().includes(q) || p.queue.toLowerCase().includes(q) || p.spoke.toLowerCase().includes(q) || p.acronym.toLowerCase().includes(q);
    const chooserProcs = PROCESSES.filter((p) => inScopeIds.has(p.id) && matches(p));
    const groupedBySpoke = filters.spoke === "All";
    const groups: [string, ProcessDim[]][] = groupedBySpoke
      ? Array.from(
          chooserProcs.reduce((acc, p) => {
            if (!acc.has(p.spoke)) acc.set(p.spoke, []);
            acc.get(p.spoke)!.push(p);
            return acc;
          }, new Map<string, ProcessDim[]>()),
        )
      : [[filters.spoke, chooserProcs]];

    // Worst 3 by exception rate, from the same filtered model every other
    // page reads — hidden once the user is actively searching, so it doesn't
    // compete with search results for attention.
    const worst = q
      ? []
      : [...m.byProcess]
          .filter((p) => inScopeIds.has(p.id) && p.attempts > 0)
          .sort((a, b) => b.exceptions / b.attempts - a.exceptions / a.attempts)
          .slice(0, 3);

    const Tile = ({ p, rateBadge }: { p: ProcessDim; rateBadge?: string }) => (
      <button
        key={p.id}
        onClick={() => setFilters({ processId: p.id })}
        className="click-row tile-lift"
        style={{
          textAlign: "left",
          border: `1px solid ${t.ruleSoft}`,
          borderLeft: `3px solid ${rateBadge ? v.bad : (spokeColorFor(p.spoke, t.mode) ?? t.ruleSoft)}`,
          background: t.themeBand,
          borderRadius: 10,
          padding: "12px 14px 12px 11px",
          cursor: "pointer",
          color: t.ink,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          {rateBadge && (
            <span style={{ flex: "0 0 auto", fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, color: v.bad }}>{rateBadge}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, marginTop: 3 }}>
          <SpokeSwatch spoke={p.spoke} decorative />
          {p.spoke} · {p.queue}
        </div>
      </button>
    );

    return (
      <PageGrid>
        <Row cols="1fr">
          <VisualCard
            title="Drill into a process"
            subtitle="Pick one — or click any process bar / row on another page"
            right={<SearchBox value={query} onChange={setQuery} placeholder="Search processes…" />}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 4, height: "100%" }}>
              {chooserProcs.length === 0 && (
                <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>No processes match{q ? " your search" : " the current filters"}.</span>
              )}

              {worst.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 8px", fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: t.inkSoft }}>
                    Needs attention · highest exception rate
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    {worst.map((p) => (
                      <Tile key={p.id} p={PROCESS_BY_ID.get(p.id)!} rateBadge={fmtPct(p.exceptions / p.attempts, 1)} />
                    ))}
                  </div>
                </div>
              )}

              {groups.map(([spoke, procs]) => (
                <div key={spoke}>
                  {groupedBySpoke && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 8px", fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: t.inkSoft }}>
                      <SpokeSwatch spoke={spoke} size="md" decorative />
                      {spoke}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, alignContent: "start" }}>
                    {procs.map((p) => (
                      <Tile key={p.id} p={p} />
                    ))}
                  </div>
                </div>
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
  const workers = m.vdis.filter((d) => d.cases > 0).slice(0, 8);

  const originLabel = (navOrigin.from && ORIGIN_LABEL[navOrigin.from]) || "Process Analysis";

  return (
    <PageGrid>
      {/* breadcrumb — left edge (16px) matches the banner's icon/title/tags
          inset below (border 4px + padding-left 12px = 16px), so the
          breadcrumb text, the process icon+title, and the tag chips all line
          up on the same left edge instead of the breadcrumb sitting flush
          against the page gutter while the banner's rail+padding pushed its
          content 20px in. */}
      <Row cols="1fr" grow={false} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingLeft: 16 }}>
        <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: t.inkSoft, minWidth: 0 }}>
          <span>Operate</span>
          <span aria-hidden>›</span>
          {navOrigin.from ? (
            <button
              onClick={navOrigin.back}
              style={{ font: "inherit", letterSpacing: "inherit", textTransform: "inherit", color: t.inkSoft, background: "transparent", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              {originLabel}
            </button>
          ) : (
            <span>{originLabel}</span>
          )}
          <span aria-hidden>›</span>
          <span style={{ color: t.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proc.name}</span>
        </nav>
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          {navOrigin.from && (
            <button
              onClick={navOrigin.back}
              className="bar-btn"
              style={{ border: `1px solid ${t.ruleSoft}`, background: "transparent", color: t.inkSoft, whiteSpace: "nowrap" }}
            >
              ← Back
            </button>
          )}
          <button onClick={() => setFilters({ processId: "All" })} style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer", border: `1px solid ${t.ruleSoft}`, background: "transparent", color: t.inkSoft, whiteSpace: "nowrap" }}>
            Clear drill
          </button>
        </div>
      </Row>

      {/* banner — the accent rail (border-left) is 4px and the box's own
          padding-left is 12px, totalling the same 16px inset the breadcrumb
          above now uses, so the icon and title sit flush on one left edge
          instead of drifting 4px right of it (previously 16px padding on
          top of the 4px rail). Tags stay beside the title block (not
          stacked below it) — this is a height-locked page (PageGrid
          fit={true}), and stacking them added a row's worth of height that
          squeezed the cards below into overlapping their own headers. */}
      <Row cols="1fr" grow={false}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: `linear-gradient(168deg, ${t.paper}, ${t.themeBand})`, border: `1px solid ${t.ruleSoft}`, borderLeft: `4px solid ${spokeColorFor(proc.spoke, t.mode) ?? t.accent}`, borderRadius: 12, padding: "12px 16px 12px 12px" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SpokeSwatch spoke={proc.spoke} decorative size="md" />
              <div style={{ fontFamily: typeScale.displayL.fontFamily, fontSize: typeScale.displayL.fontSize, lineHeight: typeScale.displayL.lineHeight, fontWeight: typeScale.displayL.fontWeight, color: t.ink }}>
                {proc.name} <span style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, fontWeight: 400 }}>{proc.acronym}</span>
              </div>
            </div>
            <div style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, marginTop: 2 }} title={proc.description}>
              {proc.spoke} · {proc.proposition} · {proc.queues.map((q2) => (q2.stage ? `${q2.queue} (${q2.stage})` : q2.queue)).join(" → ")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {proc.tags.map((tag) => (
              <span key={tag} style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: t.inkSoft, border: `1px solid ${t.ruleSoft}`, background: t.themeBand, borderRadius: 999, padding: "3px 9px" }}>{tag}</span>
            ))}
          </div>
        </div>
      </Row>

      {/* KPIs for this process */}
      <div className="kpi-row kpi-row--5">
        <KpiCard label="Completed" value={fmtCompact(pa?.completed ?? 0)} accent={v.completed} sub="items" />
        <KpiCard label="Exceptions" value={fmtCompact(pa?.exceptions ?? 0)} accent={v.system} sub={`${fmtPct(pa && pa.attempts ? pa.exceptions / pa.attempts : 0, 1)} of attempts`} />
        <KpiCard label="Completion rate" value={fmtPct(pa?.completionPct ?? 0, 1)} accent={v.good} sub="straight-through" />
        <KpiCard label="Avg cycle time" value={`${Math.round(pa?.avgCycleSec ?? 0)}s`} accent={v.business} sub="bot runtime per completed item" />
        <KpiCard label="Estate cost" value={fmtGBP(pa?.runtimeCost ?? 0)} accent={t.series} sub={`${fmtMoney2(pa?.completed ? pa.runtimeCost / pa.completed : 0)} / completed case`} />
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

      <Row cols="minmax(0,1fr) minmax(0,1fr)" style={{ flex: 1.25 }}>
        <VisualCard title="Digital workers" subtitle={`${proc.spoke} machines that ran this process in the period`}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: workers.length > 1 ? "space-between" : "center", gap: 8, height: "100%", minHeight: 0, overflow: "auto" }}>
            {workers.length === 0 && <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>No runs in the selected period.</span>}
            {workers.map((w, i) => (
              <div key={w.id} style={{ display: "grid", gridTemplateColumns: "1fr 62px 90px 70px", gap: 10, alignItems: "center", padding: "7px 2px", borderTop: i ? `1px solid ${t.ruleSoft}` : undefined }}>
                <span style={{ fontFamily: fonts.mono, fontSize: 12, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, color: t.inkSoft }}>{fmtInt(w.cases)}</span>
                <span style={{ height: 14, background: v.grid, borderRadius: 4, overflow: "hidden", position: "relative" }}>
                  <span style={{ position: "absolute", inset: 0, width: `${Math.max(2, w.utilPct * 100)}%`, background: t.series, borderRadius: 4 }} />
                </span>
                <span style={{ textAlign: "right", fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink }}>{fmtPct(w.utilPct, 0)} util</span>
              </div>
            ))}
          </div>
        </VisualCard>
        <VisualCard title="Process profile" subtitle="Team-owned configuration (reference data)">
          {/* justifyContent:"center" on a flex column that's TALLER than its
              box (4 rows + a variable-length description block, some
              processes' descriptions run to 2-3 lines) had no minHeight:0/
              overflow of its own, so it overflowed symmetrically up AND
              down — bleeding into this card's own header above it. flex
              items default to flex-start (removing the top-overflow) and
              overflow:auto lets genuinely-too-tall content scroll instead
              of visually escaping the card. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0, overflow: "auto" }}>
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
            <div style={{ padding: "7px 2px", borderTop: `1px solid ${t.ruleSoft}` }}>
              <div style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, marginBottom: 3 }}>What this process does</div>
              <div style={{ fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.45 }}>{proc.description}</div>
            </div>
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
