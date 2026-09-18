import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { fonts, radius } from "../theme";
import { useTheme } from "../theme-context";
import { computeModel, DEFAULT_FILTERS, fiscalYearBounds, FISCAL_YEAR_START_MONTH_DEFAULT } from "../filters-context";
import type { Filters } from "../filters-context";
import { useReference } from "../reference/reference-context";
import { useAlerts } from "../alerts/alerts-context";
import { headlineFor } from "../alerts/format";
import { buildRateTables } from "../reference/economics";
import { ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS, DATE_MAX } from "../rpaData";
import { SpokeSwatch } from "../components/SpokeSwatch";
import { KpiCard, VisualCard, PageGrid, Row, Segmented, Sparkline, useViz, fmtGBPc, fmtPct, fmtMoney2, fmtInt } from "../components/viz";
import { ActionButton } from "../components/PageActions";
import { classifyReviewCandidate, fyAttainment } from "./value-rules";
import { periodWindow, buildBriefing, topMovers, bottomLossMakers, PERIOD_OPTIONS } from "./exec-rules";
import type { PeriodKind } from "./exec-rules";

// ---------------------------------------------------------------------------
// src/pages/ExecutiveSummary.tsx
// ---------------------------------------------------------------------------
// The headline numbers for the exec and finance, on one screen. This page
// ignores the global slicer bar (noSlicers: true in App.tsx's PAGES entry)
// and computes its own Model from a self-contained period control (This
// month / Last month / Quarter to date / FY to date), always anchored on
// DATE_MAX (the data-through date), never on today. See exec-rules.ts for
// the pure period-window and briefing-sentence logic this page composes.
//
// Locally-built primitives (no existing equivalent in components/viz.tsx):
//   - MiniStat: a compact figure tile (label/value/delta/target dot) for the
//     "Operations this period" 2x3 grid — a full KpiCard's padding didn't
//     leave enough vertical budget for six of them plus four more page rows
//     inside one no-scroll 1440x900 canvas. The one figure whose sparkline
//     is required (Completed cases) uses the real KpiCard component instead
//     so it can carry the `spark` prop, per the design brief.
//   - a scoped <style> block providing @media print rules (this file may not
//     touch styles.css) that hide the app chrome around `.exec-page` when
//     printing, via :has().
// ---------------------------------------------------------------------------

const DAY = 86400000;
const isoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);

const PRINT_CSS = `
@media print {
  body:has(.exec-page) .report__nav,
  body:has(.exec-page) .report__top { display: none !important; }
  body:has(.exec-page) .report__main { width: 100% !important; }
  body:has(.exec-page) .report__canvas { height: auto !important; overflow: visible !important; }
  .exec-page { color: #000 !important; }
}
`;

export function ExecutiveSummary() {
  const t = useTheme();
  const v = useViz();
  const { reference } = useReference();
  const { sortedAlerts, breachCount, warnCount } = useAlerts();
  const [period, setPeriod] = useState<PeriodKind>("fytd");
  const [copied, setCopied] = useState(false);

  const fyStartMonth = reference.targets.fiscalYearStartMonth ?? FISCAL_YEAR_START_MONTH_DEFAULT;
  const win = useMemo(() => periodWindow(period, DATE_MAX, fyStartMonth), [period, fyStartMonth]);

  // Reference-data-driven rate tables — same construction filters-context.tsx
  // itself uses, memoised on `reference` only (see useFilters()'s doc note:
  // `tables` isn't exposed on the context, so this page builds its own).
  const tables = useMemo(() => buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS), [reference]);

  const execFilters: Filters = useMemo(() => ({ ...DEFAULT_FILTERS, range: "custom", from: isoDate(win.lo), to: isoDate(win.hi) }), [win.lo, win.hi]);
  const m = useMemo(() => computeModel(execFilters, 0, reference, tables), [execFilters, reference, tables]);

  // Previous-period per-spoke net, for the "By hub" table's trend cell — the
  // estate-level prev.* fields on Model don't carry a per-spoke breakdown, so
  // this page computes the preceding equal-length window's model itself.
  const prevFilters: Filters = useMemo(() => {
    const rangeDays = m.rangeDays;
    const prevHi = win.lo - DAY;
    const prevLo = prevHi - (rangeDays - 1) * DAY;
    return { ...DEFAULT_FILTERS, range: "custom", from: isoDate(prevLo), to: isoDate(prevHi) };
  }, [win.lo, m.rangeDays]);
  const prevModel = useMemo(() => computeModel(prevFilters, 0, reference, tables), [prevFilters, reference, tables]);
  const prevNetBySpoke = useMemo(() => new Map(prevModel.bySpoke.map((s) => [s.spoke, s.net])), [prevModel]);

  const hasRows = m.rows.length > 0;
  const delta = (cur: number, prev: number) => (prev ? (cur - prev) / prev : 0);

  // --- KPI row -----------------------------------------------------------
  const roi = m.automationCost ? m.grossBenefit / m.automationCost : 0;
  const financeTargets = reference.financeTargets ?? [];
  const estateTargetGBP = financeTargets.find((f) => f.spokeId === "ESTATE")?.annualNetBenefitTargetGBP;
  const windowHiTs = m.cutoffTs + (m.rangeDays - 1) * DAY;
  const fyEnd = fiscalYearBounds(m.fyStartTs, fyStartMonth).end;
  const daysRemainingInFY = Math.max(0, Math.round((fyEnd - windowHiTs) / DAY) - 1);
  const runRatePerDay = m.rangeDays ? m.netBenefit / m.rangeDays : 0;
  const projectedFyEndNet = m.fyToDateNet + runRatePerDay * daysRemainingInFY;
  const estateAttainment = estateTargetGBP != null ? fyAttainment({ fyToDateNet: m.fyToDateNet, runRateNetPerDay: runRatePerDay, daysRemaining: daysRemainingInFY, target: estateTargetGBP }) : undefined;

  const monthlyNetSpark = m.monthly.map((mo) => mo.benefit - mo.cost);
  const monthlyCompletedSpark = m.monthly.map((mo) => mo.completed);

  // --- Operations this period ----------------------------------------------
  const exceptionRate = m.attempts ? m.exceptions / m.attempts : 0;
  const prevAttempts = prevModel.attempts;
  const prevExceptionRate = prevAttempts ? prevModel.exceptions / prevAttempts : 0;
  const targets = reference.targets;

  // --- Estate health ---------------------------------------------------
  const worstAlerts = sortedAlerts.slice(0, 3);
  const active = m.vdis.filter((d) => d.cases > 0);
  const totalAvail = active.reduce((s, d) => s + d.availableHours, 0);
  const totalActive = active.reduce((s, d) => s + d.activeHours, 0);
  const totalIdle = active.reduce((s, d) => s + d.idleHours, 0);
  const avgUtil = totalAvail ? totalActive / totalAvail : 0;

  // --- By hub --------------------------------------------------------------
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

  // --- Movers ----------------------------------------------------------
  const movers = topMovers(m.byProcess, 3);
  const losers = bottomLossMakers(m.byProcess, 3);

  // --- Briefing ----------------------------------------------------------
  const worstBreach = sortedAlerts.find((a) => a.severity === "breach");
  const excCandidates = m.byProcess.filter((p) => p.attempts > 0 && p.exceptions / p.attempts > targets.exceptionRate).sort((a, b) => b.exceptions / b.attempts - a.exceptions / a.attempts);
  const worstExceptionProcess = !worstBreach && excCandidates.length ? { name: excCandidates[0].name, rate: excCandidates[0].exceptions / excCandidates[0].attempts } : undefined;
  const topCandidate = losers[0];
  const briefing = buildBriefing({
    fyToDateNet: m.fyToDateNet,
    fyToDatePriorNet: m.fyToDatePriorNet,
    estateTarget: estateTargetGBP,
    onTrack: estateAttainment?.onTrack,
    worstBreachHeadline: worstBreach ? headlineFor(worstBreach) : undefined,
    worstExceptionProcess,
    topReviewCandidate: topCandidate ? { name: topCandidate.name, reason: classifyReviewCandidate(topCandidate, targets) } : undefined,
  });

  // --- actions: print / copy figures --------------------------------------
  const handlePrint = () => window.print();
  const handleCopy = () => {
    const lines: string[] = [
      `Executive Summary\tPeriod: ${win.label} (${isoDate(win.lo)} to ${isoDate(win.hi)})`,
      `Net benefit\t${fmtGBPc(m.netBenefit)}`,
      `Gross benefit\t${fmtGBPc(m.grossBenefit)}`,
      `Estate cost\t${fmtGBPc(m.automationCost)}`,
      `ROI\t${m.automationCost ? roi.toFixed(1) + "×" : "—"}`,
      `vs annual target\t${estateAttainment ? fmtPct(estateAttainment.pct) : "—"}`,
      `Projected FY-end\t${fmtGBPc(projectedFyEndNet)}`,
      `Completed cases\t${fmtInt(m.completed)}`,
      `Completion rate\t${fmtPct(m.completionPct)}`,
      `Exception rate\t${fmtPct(exceptionRate)}`,
      `Cost per completed case\t${fmtMoney2(m.costPerCase)}`,
      `FTE released\t${m.fte.toFixed(1)}`,
      `Colleague hours saved\t${m.timeSavedHours.toFixed(0)}`,
      `Open breaches\t${breachCount}`,
      `Open warnings\t${warnCount}`,
      `Active digital workers\t${active.length} of ${m.vdis.length}`,
      `Average utilisation\t${fmtPct(avgUtil)}`,
      `Spare capacity hours\t${totalIdle.toFixed(0)}`,
      ...hubRows.map((s) => `Hub: ${s.spoke}\tNet ${fmtGBPc(s.net)}\tNet FYTD ${fmtGBPc(s.fyToDateNet)}\tCompleted ${fmtInt(s.completed)}`),
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

  return (
    <div className="exec-page" style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", height: "100%", minHeight: 0 }}>
      <style>{PRINT_CSS}</style>
      <PageGrid>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: "0 0 auto", gap: 12 }}>
          <Segmented ariaLabel="Period" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
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
              this the spark bled into the Gross benefit card next to it. */}
          <div style={{ overflow: "hidden", borderRadius: radius.card }}>
            <KpiCard
              label="Net benefit"
              value={hasRows ? fmtGBPc(m.netBenefit) : "—"}
              accent={v.completed}
              delta={m.prev.netBenefit ? (m.netBenefit - m.prev.netBenefit) / Math.abs(m.prev.netBenefit) : undefined}
              sub="vs prior period"
              spark={monthlyNetSpark}
            />
          </div>
          <KpiCard label="Gross benefit" value={hasRows ? fmtGBPc(m.grossBenefit) : "—"} accent={v.good} sub={win.label} />
          <KpiCard label="Estate cost" value={hasRows ? fmtGBPc(m.automationCost) : "—"} accent={v.system} sub="apportioned" />
          <KpiCard label="ROI" value={m.automationCost ? `${roi.toFixed(1)}×` : "—"} accent={v.business} sub="benefit per £1 spent" />
          <KpiCard
            label="vs annual target"
            value={estateAttainment ? fmtPct(estateAttainment.pct) : "—"}
            accent={estateAttainment ? (estateAttainment.onTrack ? v.good : v.bad) : v.accent}
            sub={estateTargetGBP != null ? `FYTD ${fmtGBPc(m.fyToDateNet)} of ${fmtGBPc(estateTargetGBP)}` : "No target set"}
          />
          <KpiCard label="Projected FY-end" value={hasRows ? fmtGBPc(projectedFyEndNet) : "—"} accent={v.accent} sub="at current run-rate" />
        </div>

        <Row cols="minmax(0,1.1fr) minmax(0,1fr)" grow={false}>
          <VisualCard
            title={`Operations this period — ${win.label}`}
            summary={`Completed ${fmtInt(m.completed)}, completion rate ${fmtPct(m.completionPct)}, exception rate ${fmtPct(exceptionRate)}, cost per case ${fmtMoney2(m.costPerCase)}, ${m.fte.toFixed(1)} FTE released, ${fmtInt(m.timeSavedHours)} hours saved.`}
          >
            {/* Fixed 64px row height (not 1fr of whatever the flex parent
                happened to leave over) — that's what clipped the uppercase
                labels and pushed the sparkline over them before: this Row is
                now grow={false}, so the card (and this grid) sizes to its own
                content instead of being squeezed. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 58px)", gap: 5, minHeight: 0 }}>
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
            title="Estate health"
            summary={`${breachCount} breach${breachCount === 1 ? "" : "es"}, ${warnCount} warning${warnCount === 1 ? "" : "s"} open. ${active.length} of ${m.vdis.length} digital workers active, ${fmtPct(avgUtil)} average utilisation, ${fmtInt(totalIdle)} spare capacity hours.`}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
              <div style={{ display: "flex", gap: 16 }}>
                <Stat label="Breaches" value={String(breachCount)} color={breachCount > 0 ? v.bad : v.good} />
                <Stat label="Warnings" value={String(warnCount)} color={warnCount > 0 ? v.accent : v.good} />
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
            </div>
          </VisualCard>
        </Row>

        <Row cols="1fr" grow={false}>
          <VisualCard
            title="By hub"
            subtitle={`Net benefit and vs-target by spoke, ${win.label}`}
            summary={`${hubRows.length} hubs: total net ${fmtGBPc(hubTotals.net)}, total FYTD net ${fmtGBPc(hubTotals.fyToDateNet)}, ${fmtInt(hubTotals.completed)} completed cases.`}
            scroll
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  {["Hub", "Net", "Net FYTD", "vs target", "Completed", "Exception rate", "Cost per case", "Trend"].map((h) => (
                    <th
                      key={h}
                      style={{
                        position: "sticky",
                        top: 0,
                        background: t.paper,
                        padding: "4px 10px",
                        height: 26,
                        boxSizing: "border-box",
                        fontFamily: fonts.mono,
                        fontSize: 10,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: t.inkSoft,
                        fontWeight: 700,
                        borderBottom: `1px solid ${t.ruleSoft}`,
                        textAlign: h === "Hub" ? "left" : "right",
                        whiteSpace: "nowrap",
                      }}
                    >
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
                  const trend = s.net > prevNet ? "▲" : s.net < prevNet ? "▼" : "—";
                  const trendColor = s.net > prevNet ? v.good : s.net < prevNet ? v.bad : t.inkSoft;
                  const excRate = spokeExcRate.get(s.spoke) ?? 0;
                  return (
                    <tr key={s.spoke} style={{ background: i % 2 ? t.themeBand : "transparent" }}>
                      <td style={cellStyle(t, "left")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <SpokeSwatch spoke={s.spoke} decorative /> {s.spoke}
                        </span>
                      </td>
                      <td style={cellStyle(t, "right")}>{fmtGBPc(s.net)}</td>
                      <td style={cellStyle(t, "right")}>{fmtGBPc(s.fyToDateNet)}</td>
                      <td style={cellStyle(t, "right")}>{vsTarget !== undefined ? fmtPct(vsTarget) : "—"}</td>
                      <td style={cellStyle(t, "right")}>{fmtInt(s.completed)}</td>
                      <td style={cellStyle(t, "right")}>{fmtPct(excRate)}</td>
                      <td style={cellStyle(t, "right")}>{fmtMoney2(s.costPerCase)}</td>
                      <td style={{ ...cellStyle(t, "right"), color: trendColor, fontWeight: 700 }}>{trend}</td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 700 }}>
                  <td style={cellStyle(t, "left")}>Total</td>
                  <td style={cellStyle(t, "right")}>{fmtGBPc(hubTotals.net)}</td>
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
        </Row>

        <Row cols="minmax(0,1fr) minmax(0,1fr)">
          <VisualCard title="Movers" summary={`Top and bottom processes by net benefit. Top mover ${movers[0]?.name ?? "none"}; ${losers.length} processes running at a loss.`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 1 }}>Top 3</div>
                {movers.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: fonts.body, fontSize: 12, lineHeight: "16px" }}>
                    <span style={{ color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ color: v.good, fontWeight: 700, flex: "0 0 auto" }}>{fmtGBPc(p.net)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 1 }}>Bottom 3 (at a loss)</div>
                {losers.length ? (
                  losers.map((p) => {
                    const reason = classifyReviewCandidate(p, targets);
                    return (
                      <div key={p.id} style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: fonts.body, fontSize: 12, lineHeight: "15px" }}>
                          <span style={{ color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                          <span style={{ color: v.bad, fontWeight: 700, flex: "0 0 auto" }}>{fmtGBPc(p.net)}</span>
                        </div>
                        {/* Reason kept to a single truncated line (full text is
                            in the tooltip and in Copy figures) — the fixed
                            per-row height this guarantees is what makes all
                            six mover rows fit in the space this row now has,
                            instead of an unpredictable number of wrapped
                            lines. */}
                        <div style={{ fontFamily: fonts.body, fontSize: 10, lineHeight: "12px", color: t.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={reason}>
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

          <VisualCard title="Briefing" summary={`Generated from the live model, alerts and reference targets. ${briefing.headline} ${briefing.risk} ${briefing.action}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 0 }}>
              <BriefLine label="Headline" text={briefing.headline} />
              <BriefLine label="Risk" text={briefing.risk} />
              <BriefLine label="Action" text={briefing.action} />
            </div>
          </VisualCard>
        </Row>
      </PageGrid>
    </div>
  );
}

function cellStyle(t: ReturnType<typeof useTheme>, align: "left" | "right"): CSSProperties {
  return { padding: "4px 10px", height: 26, boxSizing: "border-box", fontSize: 12, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, textAlign: align, whiteSpace: "nowrap" };
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>{label}</span>
      <span style={{ fontFamily: fonts.display, fontSize: 16, fontWeight: 700, color }}>{value}</span>
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
      <span style={{ fontFamily: fonts.mono, fontSize: 9, lineHeight: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "0 0 auto" }}>{label}</span>
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: fonts.mono, fontSize: 9, color: met ? v.good : v.bad, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
      <div style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12.5, color: t.ink, lineHeight: 1.3 }}>{text}</p>
    </div>
  );
}
