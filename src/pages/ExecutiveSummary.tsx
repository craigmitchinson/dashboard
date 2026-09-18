import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { fonts, radius } from "../theme";
import { useTheme } from "../theme-context";
import { computeModel, DEFAULT_FILTERS, fiscalYearBounds, FISCAL_YEAR_START_MONTH_DEFAULT } from "../filters-context";
import type { Filters } from "../filters-context";
import { useReference } from "../reference/reference-context";
import { useAuth } from "../auth/auth-context";
import { useDisplayPrefs } from "../a11y/prefs-context";
import { useAlerts } from "../alerts/alerts-context";
import { headlineFor } from "../alerts/format";
import { buildRateTables } from "../reference/economics";
import { ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS, DATE_MAX, SPOKE_INFO } from "../rpaData";
import { SpokeSwatch } from "../components/SpokeSwatch";
import { KpiCard, VisualCard, PageGrid, Row, Segmented, Sparkline, useViz, fmtGBPc, fmtPct, fmtMoney2, fmtInt } from "../components/viz";
import { ActionButton } from "../components/PageActions";
import { classifyReviewCandidate, fyAttainment } from "./value-rules";
import { fyToDateWindow, fmtDateShort, buildBriefing, topMovers, bottomLossMakers, deriveScopeOptions, resolveStoredScope, aggregateByProposition, orderHubAlerts, comparePeriods, trendLabel, ESTATE_SCOPE } from "./exec-rules";

// ---------------------------------------------------------------------------
// src/pages/ExecutiveSummary.tsx
// ---------------------------------------------------------------------------
// The headline numbers for the exec and finance, on one screen — for the
// whole estate, or for a single hub. This is NOT a hub-comparison page: once
// a hub is picked, every figure (KPIs, operations, estate health, the table,
// movers, the briefing) is that hub's own numbers, computed the same way
// Overview/ValueFinance would for someone with the global spoke slicer set to
// that hub. This page ignores the global slicer bar (noSlicers: true in
// App.tsx's PAGES entry) and computes its own Model for a FIXED
// fiscal-year-to-date window (there is no period picker — this page always
// shows FY to date, see fyToDateWindow in exec-rules.ts) and hub control
// (Estate / a spoke), always anchored on DATE_MAX (the data-through date),
// never on today. Every "vs prior period" comparison on this page compares
// against the equivalent day-offset window in the PRIOR fiscal year (not the
// immediately-preceding calendar window) — see `prevFilters` below.
//
// Locally-built primitives (no existing equivalent in components/viz.tsx):
//   - MiniStat: a compact figure tile (label/value/delta/target dot) for the
//     "Operations this period" 2x3 grid — a full KpiCard's padding didn't
//     leave enough vertical budget for six of them plus four more page rows
//     inside one no-scroll 1440x900 canvas. The one figure whose sparkline
//     is required (Completed cases) uses the real KpiCard component instead
//     so it can carry the `spark` prop, per the design brief.
//   - MonthlyNetBars: a compact bar-per-month strip (FY months so far, net
//     per month) inside the Movers card.
//   - ValueLeague: top-5-by-net-FYTD mini list with a share-of-total bar,
//     replacing the old "Top 3" (which would have duplicated it once the
//     page became FY-to-date-only — a process's "net (period)" and "net
//     FYTD" are now the same number).
//   - a scoped <style> block providing @media print rules (this file may not
//     touch styles.css) that turns the page into a proper one-page A4
//     landscape report: hides on-screen-only chrome (nav, header, the hub/
//     print controls), removes the viewport-fit height constraints so
//     content flows instead of being clipped, and a print-only header line.
//
// Hub tint (from an earlier pass's spec item 5, still true): App.tsx's
// ThemedReport derives `ambientAccent` (the spoke-coloured room tint) SOLELY
// from the global `useFilters().filters.spoke` — this page's hub control is
// deliberately local state, independent of that global filter (this page has
// noSlicers: true precisely so the global slicer bar doesn't apply here).
// Driving the same ambient tint from this page's own hub choice would
// require ThemedReport/App.tsx to read page-local state, which isn't exposed
// and is out of this file's ownership — skipped, not implemented.
// ---------------------------------------------------------------------------

const DAY = 86400000;
const isoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);

// --- hub scope persistence ---------------------------------------------------
// `bp-exec-scope-v1::{userId}` — same per-user namespacing idiom as App.tsx's
// own PERSIST/VIEWS_KEY and a11y/prefs-context.tsx's PREFS_KEY (each module
// keeps its own tiny copy rather than sharing one to avoid a circular
// import). Validated on read via exec-rules.ts's resolveStoredScope, never
// trusted as-is.
const SCOPE_KEY = "bp-exec-scope-v1";
function scopeKeyFor(userId: string | undefined): string {
  return userId ? `${SCOPE_KEY}::${userId}` : SCOPE_KEY;
}
function readStoredScope(userId: string | undefined): string | null {
  try {
    return localStorage.getItem(scopeKeyFor(userId));
  } catch {
    return null;
  }
}
function writeStoredScope(userId: string | undefined, scope: string): void {
  try {
    localStorage.setItem(scopeKeyFor(userId), scope);
  } catch {
    /* ignore — storage unavailable/full, the choice just won't persist */
  }
}

// Turns the page into a proper one-page A4-landscape report. `zoom` (not a
// standard CSS property, but well-supported in Chromium's print/PDF engine —
// which is what actually renders this, both in real browsers and in
// Playwright's page.pdf() used to verify it) is used to fit the content to
// one sheet: every size in this file is a literal px value rather than a
// relative unit, so a font-size cascade on an ancestor wouldn't rescale
// anything, but `zoom` scales the whole rendered box (including layout, not
// just text) the same way a browser's own page-zoom does.
// Print colours: inline theme colours (t.ink, t.themeBand, …) are set as
// literal style props all over this page, so a CSS override here — even
// `!important` on an ancestor — can never win against them (inline beats
// inherited, full stop). Rather than fight that in CSS, handlePrint() below
// switches the actual display-preference theme to "light" before printing
// and restores it after — the real fix, done at the source; `color: #000`
// here is just a harmless extra safety net on top of that.
const PRINT_CSS = `
@page { size: A4 landscape; margin: 12mm; }
@media print {
  .report, .report__canvas, .report__main { background: #fff !important; background-image: none !important; }
  .exec-page .viz-card { background: #fff !important; box-shadow: none !important; border-color: #bbb !important; }
  body:has(.exec-page) .report__nav,
  body:has(.exec-page) .report__top { display: none !important; }
  body:has(.exec-page) .report__main { width: 100% !important; }
  body:has(.exec-page) .report__canvas { height: auto !important; min-height: 0 !important; overflow: visible !important; }
  /* The "Press ⌘K to jump anywhere" coach toast (CommandPalette.tsx) is a
     role="status" + glass-overlay portal mounted outside .exec-page (hence
     body:has(), the same pattern already used above), so an .exec-page-
     scoped rule can't reach it directly. Not a general "hide every status
     toast" rule — glass-overlay + role="status" together are unique to it
     (see CommandPalette.tsx; every other role="status" in the app is a
     visually-hidden .sr-only live region already invisible on screen). */
  body:has(.exec-page) [role="status"].glass-overlay { display: none !important; }
  .exec-page { color: #000 !important; height: auto !important; min-height: 0 !important; flex: none !important; zoom: 0.62; }
  .exec-page .page-grid { height: auto !important; min-height: 0 !important; flex: none !important; }
  .exec-page .page-row { flex: none !important; }
  .exec-controls, .exec-page .hdr-page-actions { display: none !important; }
  .exec-print-header { display: block !important; }
  .exec-page .viz-card { break-inside: avoid; page-break-inside: avoid; }
  .exec-page .viz-card [style*="overflow"],
  .exec-page .exec-scroll-region,
  .exec-page .viz-scroll { overflow: visible !important; max-height: none !important; flex: none !important; }
}
.exec-print-header { display: none; }
/* Value league: top 5 on screen, but the 5th row is dropped below ~1300px
   (matches the 1280x800 target) rather than ever scrolling — three Bottom-3
   rows plus five league rows don't both fit in the Movers card at that
   width. Always shown in print (A4 landscape has plenty of width). */
@media screen and (max-width: 1300px) {
  .exec-value-league-row-5 { display: none !important; }
}
@media screen and (max-height: 840px) {
  .exec-page { --exec-bar-region: 8px; }
  .exec-page .exec-bar-value { display: none !important; }
  .exec-page .exec-brief-p { font-size: 10.5px !important; line-height: 1.1 !important; }
}
`;

export function ExecutiveSummary() {
  const t = useTheme();
  const v = useViz();
  const { reference } = useReference();
  const { user } = useAuth();
  const { prefs, setPrefs } = useDisplayPrefs();
  const { sortedAlerts, acked } = useAlerts();
  const [copied, setCopied] = useState(false);

  // --- hub scope -----------------------------------------------------------
  // Each hub gets its OWN Executive Summary, not a comparison across hubs —
  // see exec-rules.ts's deriveScopeOptions for the visibility/default rules.
  // `hub` is derived from the raw stored value + the CURRENT option set on
  // every render (rather than held as the validated value in state) so it
  // self-corrects if the option set ever changes under it (e.g. a stale
  // choice from before a role change) without a separate effect.
  const allSpokes = useMemo(() => Object.keys(SPOKE_INFO), []);
  const { options: scopeOptions, defaultScope } = useMemo(() => deriveScopeOptions(user?.spokeIds ?? [], allSpokes), [user, allSpokes]);
  const [storedHub, setStoredHub] = useState<string | null>(() => readStoredScope(user?.id));
  const hub = resolveStoredScope(storedHub, scopeOptions, defaultScope);
  const setHub = (next: string) => {
    setStoredHub(next);
    writeStoredScope(user?.id, next);
  };
  const hubSpokeFilter = hub === ESTATE_SCOPE ? "All" : hub;

  const fyStartMonth = reference.targets.fiscalYearStartMonth ?? FISCAL_YEAR_START_MONTH_DEFAULT;
  // No period picker — this page always shows fiscal-year-to-date, anchored
  // on DATE_MAX. `win.label` ("FY 2026/27 · 1 Apr 2026 to 14 Jul 2026 (105
  // days)") is shown as a static line beside the hub control.
  const win = useMemo(() => fyToDateWindow(DATE_MAX, fyStartMonth), [fyStartMonth]);

  // Reference-data-driven rate tables — same construction filters-context.tsx
  // itself uses, memoised on `reference` only (see useFilters()'s doc note:
  // `tables` isn't exposed on the context, so this page builds its own).
  const tables = useMemo(() => buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS), [reference]);

  const execFilters: Filters = useMemo(() => ({ ...DEFAULT_FILTERS, spoke: hubSpokeFilter, range: "custom", from: isoDate(win.lo), to: isoDate(win.hi) }), [hubSpokeFilter, win.lo, win.hi]);
  const m = useMemo(() => computeModel(execFilters, 0, reference, tables), [execFilters, reference, tables]);
  // The window IS the fiscal year, so m.netBenefit/m.byProcess already ARE
  // this hub's fiscal-year-to-date figures — there is no separate "period"
  // vs "FYTD" any more (an earlier pass's `fyModel`/`fyFilters`, computing a
  // second, redundant model for exactly this same window, has been removed).
  const windowHiTs = m.cutoffTs + (m.rangeDays - 1) * DAY;

  // Prior-year comparison model (same hub scope): the equivalent day-offset
  // window in the PRIOR fiscal year, NOT the immediately-preceding calendar
  // window — every "vs prior period" comparison on this page now means "vs
  // the same point last FY". Mirrors exactly the math computeModel uses
  // internally for Model.fyToDatePriorNet (filters-context.tsx), just done
  // here too because that field is estate/hub-level only, not broken down
  // by spoke/proposition/process for the table trend cells and MiniStat
  // deltas this page also needs.
  const prevFilters: Filters = useMemo(() => {
    const priorFyStart = fiscalYearBounds(m.fyStartTs - DAY, fyStartMonth).start;
    const priorFyHi = priorFyStart + (windowHiTs - m.fyStartTs);
    return { ...DEFAULT_FILTERS, spoke: hubSpokeFilter, range: "custom", from: isoDate(priorFyStart), to: isoDate(priorFyHi) };
  }, [hubSpokeFilter, m.fyStartTs, windowHiTs, fyStartMonth]);
  const prevModel = useMemo(() => computeModel(prevFilters, 0, reference, tables), [prevFilters, reference, tables]);
  const prevNetBySpoke = useMemo(() => new Map(prevModel.bySpoke.map((s) => [s.spoke, s.net])), [prevModel]);

  const hasRows = m.rows.length > 0;
  const delta = (cur: number, prev: number) => (prev ? (cur - prev) / prev : 0);

  // --- KPI row -----------------------------------------------------------
  const roi = m.automationCost ? m.grossBenefit / m.automationCost : 0;
  const financeTargets = reference.financeTargets ?? [];
  // "ESTATE" for the whole-estate view, else the hub's own financeTargets
  // entry — spokeId there is the spoke's full display name, see viz-finance
  // .tsx's SpokePLTable / ValueFinance.tsx's spokeFinanceTargets for the same
  // convention.
  const periodTargetSpokeId = hub === ESTATE_SCOPE ? "ESTATE" : hub;
  const periodTargetGBP = financeTargets.find((f) => f.spokeId === periodTargetSpokeId)?.annualNetBenefitTargetGBP;
  const fyEnd = fiscalYearBounds(m.fyStartTs, fyStartMonth).end;
  const daysRemainingInFY = Math.max(0, Math.round((fyEnd - windowHiTs) / DAY) - 1);
  const runRatePerDay = m.rangeDays ? m.netBenefit / m.rangeDays : 0;
  const projectedFyEndNet = m.fyToDateNet + runRatePerDay * daysRemainingInFY;
  const attainment = periodTargetGBP != null ? fyAttainment({ fyToDateNet: m.fyToDateNet, runRateNetPerDay: runRatePerDay, daysRemaining: daysRemainingInFY, target: periodTargetGBP }) : undefined;

  const monthlyNetSpark = m.monthly.map((mo) => mo.benefit - mo.cost);
  const monthlyCompletedSpark = m.monthly.map((mo) => mo.completed);

  // Net benefit KPI's delta/sub-line: a plain "up 92.3%" is nonsense once
  // either side is negative (e.g. "-£236.18, up 92.3%", seen on a
  // loss-making hub) — comparePeriods (exec-rules.ts, shared with the
  // Briefing headline) only hands back a percentage when both this period
  // and the prior period are strictly positive; otherwise the sub-line
  // states the prior figure in cash terms instead, and the misleading
  // percentage arrow is suppressed by passing `delta: undefined`. Compares
  // against m.fyToDatePriorNet (the same point last FY), not m.prev — this
  // page has no shorter "period" any more, so every comparison is FY-to-date
  // vs the equivalent point last fiscal year.
  const netCmp = comparePeriods(m.netBenefit, m.fyToDatePriorNet);
  const netKpiDelta = netCmp.kind === "pct" ? netCmp.pct : undefined;
  const netKpiSub = netCmp.kind === "none" ? "no comparable figure" : netCmp.kind === "pct" ? "vs same point last FY" : `${netCmp.kind} from ${fmtGBPc(netCmp.prior)}`;

  // --- Operations this period ----------------------------------------------
  const exceptionRate = m.attempts ? m.exceptions / m.attempts : 0;
  const prevAttempts = prevModel.attempts;
  const prevExceptionRate = prevAttempts ? prevModel.exceptions / prevAttempts : 0;
  const targets = reference.targets;

  // --- Estate health ---------------------------------------------------
  // Scoped to the selected hub once one is picked: estate-scope alerts still
  // count (same rule AlertsPage.tsx's filterAlertsForSlicers uses for
  // filters.spoke), plus any alert whose own spokeFilter is this hub.
  // Hub view: the hub's OWN alerts (spokeFilter === hub) come before
  // estate-scope alerts (orderHubAlerts, exec-rules.ts) — a hub lead should
  // see their own problems first, with estate alerts only filling remaining
  // slots. Estate view: every alert, in sortAlerts' own order, unchanged.
  const hubAlerts = useMemo(() => {
    if (hub === ESTATE_SCOPE) return sortedAlerts;
    const scoped = sortedAlerts.filter((a) => a.scope === "estate" || a.spokeFilter === hub);
    return orderHubAlerts(scoped, hub);
  }, [sortedAlerts, hub]);
  const hubBreachCount = useMemo(() => hubAlerts.filter((a) => !acked.has(a.id) && a.severity === "breach").length, [hubAlerts, acked]);
  const hubWarnCount = useMemo(() => hubAlerts.filter((a) => !acked.has(a.id) && a.severity === "warn").length, [hubAlerts, acked]);
  const hubAckedCount = useMemo(() => hubAlerts.filter((a) => acked.has(a.id)).length, [hubAlerts, acked]);
  const worstAlerts = hubAlerts.slice(0, 3);
  const active = m.vdis.filter((d) => d.cases > 0);
  const totalAvail = active.reduce((s, d) => s + d.availableHours, 0);
  const totalActive = active.reduce((s, d) => s + d.activeHours, 0);
  const totalIdle = active.reduce((s, d) => s + d.idleHours, 0);
  const avgUtil = totalAvail ? totalActive / totalAvail : 0;

  // --- By hub (Estate view) -------------------------------------------------
  const spokeExcRate = useMemo(() => {
    const agg = new Map<string, { exc: number; attempts: number }>();
    for (const p of m.byProcess) {
      const e = agg.get(p.spoke) ?? { exc: 0, attempts: 0 };
      e.exc += p.exceptions;
      e.attempts += p.attempts;
      agg.set(p.spoke, e);
    }
    return new Map([...agg.entries()].map(([spoke, e]) => [spoke, e.attempts ? e.exc / e.attempts : 0]));
  }, [m.byProcess]);
  const spokeTargetMap = useMemo(() => new Map(financeTargets.filter((f) => f.spokeId !== "ESTATE").map((f) => [f.spokeId, f.annualNetBenefitTargetGBP])), [financeTargets]);
  const hubRows = m.bySpoke;
  const hubTotals = hubRows.reduce(
    (acc, s) => {
      acc.net += s.net;
      acc.fyToDateNet += s.fyToDateNet;
      acc.completed += s.completed;
      return acc;
    },
    { net: 0, fyToDateNet: 0, completed: 0 },
  );

  // --- By proposition (hub view) --------------------------------------------
  // The window IS the fiscal year now, so a process's "net" already IS its
  // FYTD net — no second, FYTD-only aggregation needed any more.
  const propRows = useMemo(() => aggregateByProposition(m.byProcess), [m.byProcess]);
  const propPrevNetMap = useMemo(() => new Map(aggregateByProposition(prevModel.byProcess).map((p) => [p.proposition, p.net])), [prevModel]);
  const propTotals = propRows.reduce(
    (acc, p) => {
      acc.net += p.net;
      acc.completed += p.completed;
      return acc;
    },
    { net: 0, completed: 0 },
  );

  // --- Movers / Value league --------------------------------------------
  // m.byProcess is already scoped to the selected hub (matchProcess filters
  // every row by filters.spoke inside computeModel/aggregate) — no extra
  // filtering needed here for hub scoping. Net (this FY-to-date window) IS
  // net FYTD now, so "top movers" and "top by net FYTD" are the same
  // ranking — ValueLeague below replaces the old separate "Top 3" block.
  const movers = topMovers(m.byProcess, 5);
  const losers = bottomLossMakers(m.byProcess, 3);
  const totalPositiveNet = m.byProcess.reduce((s, p) => (p.net > 0 ? s + p.net : s), 0);
  const monthlyNet = m.monthly.map((mo) => ({ label: mo.key, net: mo.benefit - mo.cost }));
  // Per-process prior-FY net, for the Value league's muted "vs last FY"
  // secondary figure — reuses prevModel.byProcess (already computed, same
  // hub scope, prior-FY-equivalent window), no extra computeModel calls.
  const prevNetByProcess = useMemo(() => new Map(prevModel.byProcess.map((p) => [p.id, p.net])), [prevModel]);

  // --- Briefing ----------------------------------------------------------
  const worstBreach = hubAlerts.find((a) => a.severity === "breach");
  const excCandidates = m.byProcess.filter((p) => p.attempts > 0 && p.exceptions / p.attempts > targets.exceptionRate).sort((a, b) => b.exceptions / b.attempts - a.exceptions / a.attempts);
  const worstExceptionProcess = !worstBreach && excCandidates.length ? { name: excCandidates[0].name, rate: excCandidates[0].exceptions / excCandidates[0].attempts } : undefined;
  const topCandidate = losers[0];
  const briefing = buildBriefing({
    fyToDateNet: m.fyToDateNet,
    fyToDatePriorNet: m.fyToDatePriorNet,
    estateTarget: periodTargetGBP,
    onTrack: attainment?.onTrack,
    worstBreachHeadline: worstBreach ? headlineFor(worstBreach) : undefined,
    worstExceptionProcess,
    topReviewCandidate: topCandidate ? { name: topCandidate.name, reason: classifyReviewCandidate(topCandidate, targets) } : undefined,
  });

  // --- actions: print / copy figures --------------------------------------
  // Print must be black-on-white regardless of the signed-in theme — since
  // inline theme colours can never be beaten by a CSS override (see
  // PRINT_CSS's comment), this switches the actual display-preference theme
  // to "light" for the duration of the print, then restores whatever it was.
  // One rAF after the switch before calling window.print() lets React commit
  // the theme change (and the app re-render with light tokens) before the
  // browser captures the page; `afterprint` restores the prior theme once
  // the print dialog closes, with a 1s timeout as a fallback for browsers
  // that don't fire it reliably (e.g. print-to-PDF in some automation).
  const handlePrint = () => {
    const prevTheme = prefs.theme;
    if (prevTheme === "light") {
      window.print();
      return;
    }
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      setPrefs({ theme: prevTheme });
      window.removeEventListener("afterprint", restore);
    };
    setPrefs({ theme: "light" });
    window.addEventListener("afterprint", restore);
    requestAnimationFrame(() => window.print());
    setTimeout(restore, 1000);
  };
  const handleCopy = () => {
    const lines: string[] = [
      `Executive Summary — ${hub}\t${win.label}`,
      `Net benefit\t${fmtGBPc(m.netBenefit)}`,
      `Gross benefit\t${fmtGBPc(m.grossBenefit)}`,
      `Estate cost\t${fmtGBPc(m.automationCost)}`,
      `ROI\t${m.automationCost ? roi.toFixed(1) + "×" : "—"}`,
      `vs annual target\t${attainment ? fmtPct(attainment.pct) : "—"}`,
      `Projected FY-end\t${fmtGBPc(projectedFyEndNet)}`,
      `Completed cases\t${fmtInt(m.completed)}`,
      `Completion rate\t${fmtPct(m.completionPct)}`,
      `Exception rate\t${fmtPct(exceptionRate)}`,
      `Cost per completed case\t${fmtMoney2(m.costPerCase)}`,
      `FTE released\t${m.fte.toFixed(1)}`,
      `Colleague hours saved\t${m.timeSavedHours.toFixed(0)}`,
      `Open breaches\t${hubBreachCount}`,
      `Open warnings\t${hubWarnCount}`,
      `Active digital workers\t${active.length} of ${m.vdis.length}`,
      `Average utilisation\t${fmtPct(avgUtil)}`,
      `Spare capacity hours\t${totalIdle.toFixed(0)}`,
      ...(hub === ESTATE_SCOPE
        ? hubRows.map((s) => `Hub: ${s.spoke}\tNet (FYTD) ${fmtGBPc(s.fyToDateNet)}\tCompleted ${fmtInt(s.completed)}`)
        : propRows.map((p) => `Proposition: ${p.proposition}\tNet (FYTD) ${fmtGBPc(p.net)}\tCompleted ${fmtInt(p.completed)}`)),
      `Briefing headline\t${briefing.headline}`,
      `Briefing risk\t${briefing.risk}`,
      `Briefing action\t${briefing.action}`,
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  // Print-only header line (hidden on screen, shown only under @media print
  // via PRINT_CSS's `.exec-print-header` rule) — the printed page has no
  // on-screen chrome (nav/top bar/controls all hidden in print), so this is
  // the only place the hub, fiscal year and print date appear on paper.
  const printHeaderText = `Intelligent Automation — Executive Summary — ${hub} — ${win.fyLabel} to ${fmtDateShort(win.hi)} — printed ${fmtDateShort(Date.now())}`;

  return (
    <div className="exec-page" style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", height: "100%", minHeight: 0 }}>
      <style>{PRINT_CSS}</style>
      <div className="exec-print-header" style={{ fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, color: "#000", marginBottom: 8 }}>
        {printHeaderText}
      </div>
      <PageGrid>
        <div className="exec-controls" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: "0 0 auto", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Segmented ariaLabel="Hub" value={hub} onChange={setHub} options={scopeOptions} />
            {/* No period picker — the page always shows fiscal-year-to-date;
                this states exactly what window is on screen instead of
                offering a choice. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 32,
                padding: "0 12px",
                borderRadius: 8,
                background: t.themeBand,
                border: `1px solid ${t.ruleSoft}`,
                fontFamily: fonts.mono,
                fontSize: 12,
                fontWeight: 700,
                color: t.ink,
                whiteSpace: "nowrap",
              }}
            >
              {win.label}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-live="polite" className="sr-only">
              {copied ? "Copied" : ""}
            </span>
            <ActionButton onClick={handleCopy}>{copied ? "Copied" : "Copy figures"}</ActionButton>
            <ActionButton onClick={handlePrint}>Print</ActionButton>
          </div>
        </div>

        <div className="kpi-row kpi-row--6">
          {/* Wrapped in its own overflow-hidden, card-radius-matched box: at
              this card's width, "£160.9k" plus KpiCard's built-in 60px
              sparkline can together be wider than the card's padded content
              box (KpiCard itself has no overflow clipping, and it's a
              components/viz.tsx primitive this page must not edit) — without
              this the spark bled into the Gross benefit card next to it.
              whiteSpace:"nowrap" (inherited down into KpiCard's own value
              span, which sets none of its own) stops a negative hub-scoped
              value like "-£236.18" line-wrapping after the leading "-" (a
              valid Unicode break point) when the sparkline crowds the
              available width — a single clipped line reads better than a
              value split across two. */}
          <div style={{ overflow: "hidden", borderRadius: radius.card, whiteSpace: "nowrap" }}>
            <KpiCard
              label="Net benefit"
              value={hasRows ? fmtGBPc(m.netBenefit) : "—"}
              accent={v.completed}
              delta={netKpiDelta}
              sub={netKpiSub}
              spark={monthlyNetSpark}
            />
          </div>
          <KpiCard label="Gross benefit" value={hasRows ? fmtGBPc(m.grossBenefit) : "—"} accent={v.good} sub={win.fyLabel} />
          <KpiCard label={hub === ESTATE_SCOPE ? "Estate cost" : "Hub cost"} value={hasRows ? fmtGBPc(m.automationCost) : "—"} accent={v.system} sub="apportioned" />
          <KpiCard label="ROI" value={m.automationCost ? `${roi.toFixed(1)}×` : "—"} accent={v.business} sub="benefit per £1 spent" />
          <KpiCard
            label="vs annual target"
            value={attainment ? fmtPct(attainment.pct) : "—"}
            accent={attainment ? (attainment.onTrack ? v.good : v.bad) : v.accent}
            sub={periodTargetGBP != null ? `FYTD ${fmtGBPc(m.fyToDateNet)} of ${fmtGBPc(periodTargetGBP)}` : "No target set"}
          />
          {/* Same nowrap safety as the Net benefit tile above — a negative
              projection ("-£821.02") can break after the leading "-" at
              narrower viewport widths without it. */}
          <div style={{ overflow: "hidden", borderRadius: radius.card, whiteSpace: "nowrap" }}>
            <KpiCard label="Projected FY-end" value={hasRows ? fmtGBPc(projectedFyEndNet) : "—"} accent={v.accent} sub="at current run-rate" />
          </div>
        </div>

        <Row cols="minmax(0,1.1fr) minmax(0,1fr)" grow={false}>
          <VisualCard
            title={hub === ESTATE_SCOPE ? `Operations this period — ${win.fyLabel}` : `Operations this period — ${hub} — ${win.fyLabel}`}
            summary={`Completed ${fmtInt(m.completed)}, completion rate ${fmtPct(m.completionPct)}, exception rate ${fmtPct(exceptionRate)}, cost per case ${fmtMoney2(m.costPerCase)}, ${m.fte.toFixed(1)} FTE released, ${fmtInt(m.timeSavedHours)} hours saved.`}
          >
            {/* Fixed 64px row height (not 1fr of whatever the flex parent
                happened to leave over) — that's what clipped the uppercase
                labels and pushed the sparkline over them before: this Row is
                now grow={false}, so the card (and this grid) sizes to its own
                content instead of being squeezed. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 54px)", gap: 5, minHeight: 0 }}>
              <MiniStat label="Completed cases" value={hasRows ? fmtInt(m.completed) : "—"} delta={delta(m.completed, prevModel.completed)} spark={monthlyCompletedSpark} />
              <MiniStat
                label="Completion rate"
                value={fmtPct(m.completionPct)}
                delta={delta(m.completionPct, prevModel.completionPct)}
                met={m.completionPct >= targets.completionPct}
                targetLabel={`≥ ${fmtPct(targets.completionPct, 0)}`}
              />
              <MiniStat
                label="Exception rate"
                value={fmtPct(exceptionRate)}
                delta={delta(exceptionRate, prevExceptionRate)}
                deltaGood="down"
                met={exceptionRate <= targets.exceptionRate}
                targetLabel={`≤ ${fmtPct(targets.exceptionRate, 0)}`}
              />
              <MiniStat
                label="Cost per case"
                value={fmtMoney2(m.costPerCase)}
                delta={delta(m.costPerCase, prevModel.costPerCase)}
                deltaGood="down"
                met={m.costPerCase <= targets.costPerCase}
                targetLabel={`≤ ${fmtMoney2(targets.costPerCase)}`}
              />
              <MiniStat label="FTE released" value={m.fte.toFixed(1)} delta={delta(m.fte, prevModel.fte)} />
              <MiniStat label="Hours saved" value={fmtInt(m.timeSavedHours)} delta={delta(m.timeSavedHours, prevModel.timeSavedHours)} />
            </div>
          </VisualCard>

          <VisualCard
            title={hub === ESTATE_SCOPE ? "Estate health" : `Estate health — ${hub}`}
            summary={`${hubBreachCount} breach${hubBreachCount === 1 ? "" : "es"}, ${hubWarnCount} warning${hubWarnCount === 1 ? "" : "s"} open. ${active.length} of ${m.vdis.length} digital workers active, ${fmtPct(avgUtil)} average utilisation, ${fmtInt(totalIdle)} spare capacity hours.`}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
              <div style={{ display: "flex", gap: 16 }}>
                <Stat label="Breaches" value={String(hubBreachCount)} color={hubBreachCount > 0 ? v.bad : v.good} />
                <Stat label="Warnings" value={String(hubWarnCount)} color={hubWarnCount > 0 ? v.accent : v.good} />
                <Stat label="Active workers" value={`${active.length} / ${m.vdis.length}`} color={v.ink} />
                <Stat label="Avg. utilisation" value={fmtPct(avgUtil, 0)} color={v.ink} />
                <Stat label="Spare hours" value={fmtInt(totalIdle)} color={v.ink} />
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {worstAlerts.length ? (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                    {worstAlerts.map((a) => (
                      <li key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: fonts.body, fontSize: 12.5, color: t.ink }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.severity === "breach" ? v.bad : v.accent, marginTop: 4, flex: "0 0 auto" }} />
                        <span>{headlineFor(a)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: fonts.body, fontSize: 13, color: v.good }}>All metrics within targets</div>
                )}
              </div>
              {/* Freshness + follow-up: lets a reader judge how current the
                  figures are and whether anything already has eyes on it. */}
              <div style={{ display: "flex", justifyContent: "space-between", flex: "0 0 auto", fontFamily: fonts.mono, fontSize: 10.5, color: t.inkSoft, borderTop: `1px solid ${t.ruleSoft}`, paddingTop: 5 }}>
                <span>Data through {fmtDateShort(DATE_MAX)}</span>
                <span>{hubAckedCount} acknowledged</span>
              </div>
            </div>
          </VisualCard>
        </Row>

        <Row cols="1fr" grow={false}>
          {hub === ESTATE_SCOPE ? (
            <VisualCard
              title="By hub"
              subtitle={`Net benefit (FYTD) and vs-target by spoke, ${win.fyLabel}`}
              summary={`${hubRows.length} hubs: total net FYTD ${fmtGBPc(hubTotals.fyToDateNet)}, ${fmtInt(hubTotals.completed)} completed cases.`}
              scroll
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr>
                    {["Hub", "Net (FYTD)", "vs target", "Completed", "Exception rate", "Cost per case", "Trend (vs last FY)"].map((h) => (
                      <th key={h} style={tableHeaderStyle(t, h === "Hub" ? "left" : "right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hubRows.map((s, i) => {
                    const target = spokeTargetMap.get(s.spoke);
                    const vsTarget = target ? s.fyToDateNet / target : undefined;
                    const prevNet = prevNetBySpoke.get(s.spoke) ?? 0;
                    const cmp = comparePeriods(s.fyToDateNet, prevNet);
                    const trendColor = cmp.kind === "pct" ? (cmp.pct >= 0 ? v.good : v.bad) : cmp.kind === "improved" ? v.good : cmp.kind === "worsened" ? v.bad : t.inkSoft;
                    const excRate = spokeExcRate.get(s.spoke) ?? 0;
                    return (
                      <tr key={s.spoke} style={{ background: i % 2 ? t.themeBand : "transparent" }}>
                        <td style={cellStyle(t, "left")}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <SpokeSwatch spoke={s.spoke} decorative /> {s.spoke}
                          </span>
                        </td>
                        <td style={cellStyle(t, "right")}>{fmtGBPc(s.fyToDateNet)}</td>
                        <td style={cellStyle(t, "right")}>{vsTarget !== undefined ? fmtPct(vsTarget) : "—"}</td>
                        <td style={cellStyle(t, "right")}>{fmtInt(s.completed)}</td>
                        <td style={cellStyle(t, "right")}>{fmtPct(excRate)}</td>
                        <td style={cellStyle(t, "right")}>{fmtMoney2(s.costPerCase)}</td>
                        <td style={{ ...cellStyle(t, "right") }}>
                          {/* Monthly-net-for-FY-so-far isn't available per
                              spoke anywhere in Model (only the whole model's
                              own scope gets a monthly breakdown) — this reuses
                              SpokeAgg.netTrend12w, the trailing-12-week net
                              trend computeModel already computes per spoke,
                              as the closest available real trend series
                              rather than adding N more computeModel calls. */}
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                            <Sparkline data={s.netTrend12w} color={trendColor} w={32} h={14} />
                            <span style={{ color: trendColor, fontWeight: 700, whiteSpace: "nowrap" }}>{trendLabel(cmp, { withBasis: false })}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700 }}>
                    <td style={cellStyle(t, "left")}>Total</td>
                    <td style={cellStyle(t, "right")}>{fmtGBPc(hubTotals.fyToDateNet)}</td>
                    <td style={cellStyle(t, "right")}>—</td>
                    <td style={cellStyle(t, "right")}>{fmtInt(hubTotals.completed)}</td>
                    <td style={cellStyle(t, "right")}>—</td>
                    <td style={cellStyle(t, "right")}>—</td>
                    <td style={cellStyle(t, "right")}>—</td>
                  </tr>
                </tbody>
              </table>
            </VisualCard>
          ) : (
            <VisualCard
              title="By proposition"
              subtitle={`Net benefit (FYTD) by proposition within ${hub}, ${win.fyLabel}`}
              summary={`${propRows.length} propositions in ${hub}: total net FYTD ${fmtGBPc(propTotals.net)}, ${fmtInt(propTotals.completed)} completed cases.`}
              scroll
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr>
                    {["Proposition", "Net (FYTD)", "Completed", "Exception rate", "Cost per case", "Trend (vs last FY)"].map((h) => (
                      <th key={h} style={tableHeaderStyle(t, h === "Proposition" ? "left" : "right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {propRows.map((p, i) => {
                    const prevNet = propPrevNetMap.get(p.proposition) ?? 0;
                    const cmp = comparePeriods(p.net, prevNet);
                    const trendColor = cmp.kind === "pct" ? (cmp.pct >= 0 ? v.good : v.bad) : cmp.kind === "improved" ? v.good : cmp.kind === "worsened" ? v.bad : t.inkSoft;
                    const excRate = p.attempts ? p.exceptions / p.attempts : 0;
                    return (
                      <tr key={p.proposition} style={{ background: i % 2 ? t.themeBand : "transparent" }}>
                        <td style={cellStyle(t, "left")}>{p.proposition}</td>
                        <td style={cellStyle(t, "right")}>{fmtGBPc(p.net)}</td>
                        <td style={cellStyle(t, "right")}>{fmtInt(p.completed)}</td>
                        <td style={cellStyle(t, "right")}>{fmtPct(excRate)}</td>
                        <td style={cellStyle(t, "right")}>{fmtMoney2(p.costPerCase)}</td>
                        {/* No sparkline here (unlike By hub's netTrend12w) —
                            there is no per-proposition trend series anywhere
                            in Model, weekly or monthly; computing one would
                            need N more computeModel calls per hub view. The
                            labelled change (direction + magnitude, never a
                            bare arrow) still carries the full comparison. */}
                        <td style={{ ...cellStyle(t, "right"), color: trendColor, fontWeight: 700 }}>{trendLabel(cmp, { withBasis: false })}</td>
                      </tr>
                    );
                  })}
                  {propRows.length === 0 && (
                    <tr>
                      <td style={cellStyle(t, "left")} colSpan={6}>
                        No propositions with activity in this hub for the current period.
                      </td>
                    </tr>
                  )}
                  <tr style={{ fontWeight: 700 }}>
                    <td style={cellStyle(t, "left")}>Total</td>
                    <td style={cellStyle(t, "right")}>{fmtGBPc(propTotals.net)}</td>
                    <td style={cellStyle(t, "right")}>{fmtInt(propTotals.completed)}</td>
                    <td style={cellStyle(t, "right")}>—</td>
                    <td style={cellStyle(t, "right")}>—</td>
                    <td style={cellStyle(t, "right")}>—</td>
                  </tr>
                </tbody>
              </table>
            </VisualCard>
          )}
        </Row>

        <Row cols="minmax(0,1fr) minmax(0,1fr)">
          <VisualCard title="Movers" summary={`The top five processes by net FYTD, each with its change vs the same point last FY, and processes running at a loss. Top mover ${movers[0]?.name ?? "none"}; ${losers.length} processes running at a loss.`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minHeight: 0 }}>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 1 }}>Value league — top {movers.length > 4 ? 5 : movers.length} by net FYTD</div>
                {movers.map((p, i) => {
                  const cmp = comparePeriods(p.net, prevNetByProcess.get(p.id) ?? 0);
                  // Muted secondary figure combines the net FYTD value with
                  // the labelled change vs last FY on one line — e.g.
                  // "£80.5k · ▲ 12.4%" — never a bare arrow (direction +
                  // magnitude always present, or the prior cash figure when
                  // a percentage would be nonsense).
                  return (
                    <div
                      key={p.id}
                      className={i === 4 ? "exec-value-league-row-5" : undefined}
                      style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.body, fontSize: 10.5, lineHeight: "12px" }}
                    >
                      <span style={{ color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "1 1 auto" }}>{p.name}</span>
                      <span style={{ flex: "0 0 36px", height: 5, background: t.themeBand, borderRadius: 3, overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${totalPositiveNet > 0 ? Math.min(100, (Math.max(0, p.net) / totalPositiveNet) * 100) : 0}%`, background: p.net >= 0 ? v.good : v.bad, borderRadius: 3 }} />
                      </span>
                      <span style={{ color: t.inkSoft, fontSize: 10.5, fontWeight: 700, flex: "0 0 auto", width: 118, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${fmtGBPc(p.net)} · ${trendLabel(cmp)}`}>
                        {fmtGBPc(p.net)} · {trendLabel(cmp, { withBasis: false })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 1 }}>Bottom 3 (at a loss)</div>
                {losers.length ? (
                  losers.map((p) => {
                    const reason = classifyReviewCandidate(p, targets);
                    return (
                      <div key={p.id} style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: fonts.body, fontSize: 11.5, lineHeight: "12px" }}>
                          <span style={{ color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{p.name}</span>
                          <span style={{ color: v.bad, fontWeight: 700, flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>{fmtGBPc(p.net)}</span>
                        </div>
                        {/* Reason kept to a single truncated line (full text is
                            in the tooltip and in Copy figures) — a fixed,
                            predictable per-row height regardless of how long
                            the generated reason string is. "Time at a loss"
                            (how many months running negative) was asked for
                            here too, but Model.monthly is a single aggregate
                            series for the whole model scope (estate or hub) —
                            there is no per-process monthly breakdown to derive
                            it from without N more computeModel calls (one per
                            loss-maker) or hand-rolling raw-row aggregation
                            outside the tested engine, so this is skipped. */}
                        <div style={{ fontFamily: fonts.body, fontSize: 10.5, lineHeight: "12px", color: t.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={reason}>
                          {reason}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontFamily: fonts.body, fontSize: 12, color: v.good }}>No processes are running at a loss.</div>
                )}
              </div>
            </div>
          </VisualCard>

          <VisualCard title="Briefing" summary={`Generated from the live model, alerts and reference targets. ${briefing.headline} ${briefing.risk} ${briefing.action} Monthly net benefit: ${monthlyNet.map((d) => `${d.label} ${fmtGBPc(d.net)}`).join(", ")}.`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
              <BriefLine label="Headline" text={briefing.headline} />
              <BriefLine label="Risk" text={briefing.risk} />
              <BriefLine label="Action" text={briefing.action} />
              <MonthlyNetChart data={monthlyNet} />
            </div>
          </VisualCard>
        </Row>
      </PageGrid>
    </div>
  );
}

function cellStyle(t: ReturnType<typeof useTheme>, align: "left" | "right"): CSSProperties {
  return { padding: "3px 10px", height: 24, boxSizing: "border-box", fontSize: 12, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, textAlign: align, whiteSpace: "nowrap" };
}

// Shared sticky column-header cell for both the "By hub" and "By proposition"
// tables (identical styling, only the header labels/alignment differ).
function tableHeaderStyle(t: ReturnType<typeof useTheme>, align: "left" | "right"): CSSProperties {
  return {
    position: "sticky",
    top: 0,
    background: t.paper,
    padding: "4px 10px",
    height: 24,
    boxSizing: "border-box",
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: t.inkSoft,
    fontWeight: 700,
    borderBottom: `1px solid ${t.ruleSoft}`,
    textAlign: align,
    whiteSpace: "nowrap",
  };
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>{label}</span>
      <span style={{ fontFamily: fonts.display, fontSize: 16, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

// Compact bar-per-month strip (FY months so far) at the top of the Movers
// card — positive tone for a positive month, red only when a month is
// actually negative (per the design brief). Hand-rolled rather than reusing
// viz.tsx's LineChart/HBarChart: both assume much more vertical room than
// this ~40px strip has, and neither draws a zero-centred two-tone bar.
// Mini bar chart, one bar per FY month so far, from a shared zero baseline —
// height proportional to |net| (same scale used whichever side of the
// baseline a bar falls on, so a positive and a negative month of equal
// magnitude draw the same height), positive tone above the line, red below
// it. Lives at the bottom of the Briefing card (moved out of Movers, which
// needed the room for the Value league + all three Bottom-3 rows with no
// internal scroll — see the Movers/Layout task notes).
function MonthlyNetChart({ data }: { data: { label: string; net: number }[] }) {
  const t = useTheme();
  const v = useViz();
  if (!data.length) return null;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.net)));
  return (
    <div>
      <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 0 }}>Monthly net benefit</div>
      <div role="img" aria-label={`Monthly net benefit this fiscal year: ${data.map((d) => `${d.label} ${fmtGBPc(d.net)}`).join(", ")}`} style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
        {data.map((d) => {
          const barH = `${Math.max(8, Math.round((Math.abs(d.net) / maxAbs) * 100))}%`;
          const color = d.net >= 0 ? v.good : v.bad;
          return (
            <div key={d.label} aria-hidden style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
              <span className="exec-bar-value" style={{ fontFamily: fonts.mono, fontSize: 10.5, lineHeight: "12px", fontWeight: 700, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{fmtGBPc(d.net)}</span>
              <div style={{ height: "var(--exec-bar-region, 16px)", width: "72%", display: "flex", alignItems: "flex-end" }}>
                {d.net >= 0 && <div style={{ width: "100%", height: barH, background: color, borderRadius: "2px 2px 0 0" }} />}
              </div>
              {/* Zero line: a border on every column's below-baseline region
                  lines up into one continuous horizontal rule since every
                  column reserves the exact same region height above it. */}
              <div style={{ height: "var(--exec-bar-region, 16px)", width: "72%", borderTop: `1.5px solid ${t.ruleSoft}`, display: "flex", alignItems: "flex-start" }}>
                {d.net < 0 && <div style={{ width: "100%", height: barH, background: color, borderRadius: "0 0 2px 2px" }} />}
              </div>
              {/* 10px is the explicit minimum for the month label — kept at
                  exactly that floor even though every other label on this
                  chart is squeezed smaller. */}
              <span style={{ fontFamily: fonts.mono, fontSize: 10, lineHeight: "12px", color: t.inkSoft, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact figure tile for the "Operations this period" 2x3 grid — see this
// file's header comment for why it exists alongside KpiCard rather than
// reusing it for every cell.
function MiniStat({
  label,
  value,
  delta,
  deltaGood = "up",
  met,
  targetLabel,
  spark,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaGood?: "up" | "down";
  met?: boolean;
  targetLabel?: string;
  spark?: number[];
}) {
  const t = useTheme();
  const v = useViz();
  const hasDelta = delta !== undefined && Number.isFinite(delta);
  const positive = hasDelta ? (deltaGood === "up" ? delta! >= 0 : delta! <= 0) : true;
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "5px 8px", borderRadius: 8, background: t.themeBand, minWidth: 0, minHeight: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <span style={{ fontFamily: fonts.mono, fontSize: 10, lineHeight: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "0 0 auto" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flex: "0 0 auto" }}>
        <span style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: "19px", fontWeight: 700, color: t.ink }}>{value}</span>
        {spark && <Sparkline data={spark} color={v.completed} w={40} h={16} />}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 11, overflow: "hidden", flex: "0 0 auto" }}>
        {hasDelta && (
          <span style={{ fontFamily: fonts.mono, fontSize: 10, fontWeight: 700, color: Math.abs(delta!) < 0.001 ? t.inkSoft : positive ? v.good : v.bad, whiteSpace: "nowrap" }}>
            {delta! >= 0 ? "▲" : "▼"} {Math.abs(delta! * 100).toFixed(1)}%
          </span>
        )}
        {met !== undefined && targetLabel && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: fonts.mono, fontSize: 10, color: met ? v.good : v.bad, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: met ? v.good : v.bad, flex: "0 0 auto" }} />
            {targetLabel}
          </span>
        )}
      </span>
    </div>
  );
}

function BriefLine({ label, text }: { label: string; text: string }) {
  const t = useTheme();
  return (
    <div>
      <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 0 }}>{label}</div>
      <p className="exec-brief-p" style={{ margin: 0, fontFamily: fonts.body, fontSize: 11, color: t.ink, lineHeight: 1.15 }}>{text}</p>
    </div>
  );
}
