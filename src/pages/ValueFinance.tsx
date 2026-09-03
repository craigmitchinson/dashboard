import { useMemo, useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters, fiscalYearBounds, FISCAL_YEAR_START_MONTH_DEFAULT } from "../filters-context";
import { fmtDate, TARGETS } from "../rpaData";
import { useReference } from "../reference/reference-context";
import { KpiCard, VisualCard, PageGrid, Row, useViz, fmtGBPc, fmtMoney2, fmtPct, fmtInt } from "../components/viz";
import { ExportCsvButton } from "../components/PageActions";
import { WaterfallChart, ParetoChart, StackedCostTrend, SpokePLTable, fyFinanceColors } from "../components/viz-finance";
import type { WaterfallStep } from "../components/viz-finance";
import { classifyReviewCandidate, fyAttainment } from "./value-rules";

const DAY = 86400000;
// Stable fallback so `reference.financeTargets` being undefined doesn't
// itself produce a fresh `[]` reference every render (see the
// spokeFinanceTargets memo below).
const NO_FINANCE_TARGETS: NonNullable<ReturnType<typeof useReference>["reference"]["financeTargets"]> = [];

export function ValueFinance() {
  const { model } = useFilters();
  const { reference } = useReference();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const colors = fyFinanceColors(t);
  const hasRows = m.rows.length > 0;
  // Tracks the Spoke P&L table's current sort order (see SpokePLTable's
  // onSortedChange) so its CSV export matches exactly what's on screen.
  const [spokePlSorted, setSpokePlSorted] = useState(m.bySpoke);

  // --- KPI strip -------------------------------------------------------
  const runRateNet = (m.netBenefit * 365.25) / m.rangeDays;
  const roi = m.automationCost ? m.grossBenefit / m.automationCost : 0;
  const paybackMonths = m.automationCost > 0 && runRateNet > 0 ? m.automationCost / (runRateNet / 12) : undefined;

  // --- Row 2: waterfall --------------------------------------------------
  // Net bar reconciles exactly to m.netBenefit (grossBenefit - automationCost)
  // — unattributed idle is shown as a memo bar AFTER Net, not subtracted into
  // it, so waterfall Net === KPI Net === P&L totals Net (see the doc note on
  // Model.unattributedCostGBP: netBenefit deliberately excludes it).
  const gross = m.grossBenefit;
  const comp = m.costComposition;
  const waterfallSteps: WaterfallStep[] = [
    { key: "gross", label: "Gross", value: gross, isTotal: true, color: gross >= 0 ? t.status.positive : v.accent },
    { key: "teams", label: "Teams", value: -comp.teams, color: colors.teams, pctOfBase: gross ? comp.teams / gross : 0 },
    { key: "machines", label: "Machines (VDIs)", value: -comp.machines, color: v.business, pctOfBase: gross ? comp.machines / gross : 0 },
    { key: "net", label: "Net", value: gross - m.automationCost, isTotal: true, color: gross - m.automationCost >= 0 ? t.status.positive : v.accent },
    { key: "unattributed", label: "Unattributed idle (memo)", value: -m.unattributedCostGBP, color: colors.unattributed, memo: true },
  ];
  const waterfallSummary = hasRows
    ? `Gross benefit ${fmtGBPc(gross)}, less Teams ${fmtGBPc(comp.teams)} (${fmtPct(gross ? comp.teams / gross : 0)}), Machines (VDIs) ${fmtGBPc(comp.machines)} (${fmtPct(gross ? comp.machines / gross : 0)}), leaves net benefit of ${fmtGBPc(m.netBenefit)}. Unattributed idle pool cost of ${fmtGBPc(m.unattributedCostGBP)} is shown as a memo and is not subtracted from net.`
    : "No data for the current filters.";

  // --- Row 2: monthly value trend (derived proportional split) ----------
  const monthLabels = m.monthly.map((mo) => mo.key);
  const ratio = m.automationCost
    ? { teams: comp.teams / m.automationCost, machines: comp.machines / m.automationCost }
    : { teams: 0, machines: 0 };
  const monthlyStacks = [
    { key: "teams", label: "Teams", color: colors.teams, values: m.monthly.map((mo) => mo.cost * ratio.teams) },
    { key: "machines", label: "Machines (VDIs)", color: v.business, values: m.monthly.map((mo) => mo.cost * ratio.machines) },
  ];
  const monthlyNet = m.monthly.map((mo) => mo.benefit - mo.cost);

  const fytdDeltaPct = m.fyToDatePriorNet ? (m.fyToDateNet - m.fyToDatePriorNet) / Math.abs(m.fyToDatePriorNet) : undefined;

  // --- Row 3: spoke P&L ---------------------------------------------------
  const windowHiTs = m.cutoffTs + (m.rangeDays - 1) * DAY;
  const dataThroughISO = new Date(windowHiTs).toISOString().slice(0, 10);
  const spokeTotals = m.bySpoke.reduce(
    (acc, s) => {
      acc.gross += s.gross;
      acc.cost += s.cost;
      acc.net += s.net;
      return acc;
    },
    { gross: 0, cost: 0, net: 0 },
  );
  const spokePlSummary = m.bySpoke.length
    ? `${m.bySpoke.length} spokes: total gross ${fmtGBPc(spokeTotals.gross)}, total cost ${fmtGBPc(spokeTotals.cost)}, total net ${fmtGBPc(spokeTotals.net)}, data through ${dataThroughISO}.`
    : "No spoke data for the current filters.";

  // --- Row 4: process value league (Pareto) ------------------------------
  const positiveNet = m.byProcess.filter((p) => p.net > 0).sort((a, b) => b.net - a.net);
  const totalPositiveNet = positiveNet.reduce((s, p) => s + p.net, 0);
  let cumForThreshold = 0;
  let thresholdCount = 0;
  for (const p of positiveNet) {
    cumForThreshold += p.net;
    thresholdCount++;
    if (totalPositiveNet && cumForThreshold / totalPositiveNet >= 0.8) break;
  }
  const paretoItems = positiveNet.slice(0, 15).map((p) => ({ key: p.id, label: p.name, value: p.net }));
  const shownCumulative = paretoItems.reduce((s, p) => s + p.value, 0);
  const pctOfTotalShown = totalPositiveNet ? Math.round((shownCumulative / totalPositiveNet) * 100) : 0;

  // --- Row 4: review candidates -------------------------------------------
  const lossMakers = m.byProcess.filter((p) => p.net < 0).sort((a, b) => a.net - b.net);

  // --- Run-rate forecast sentence -----------------------------------------
  const fyStartMonth = reference.targets.fiscalYearStartMonth ?? FISCAL_YEAR_START_MONTH_DEFAULT;
  const fyEnd = fiscalYearBounds(m.fyStartTs, fyStartMonth).end;
  // daysRemainingInFY counts days STRICTLY AFTER the window's last day
  // (windowHiTs) through fiscal-year-end. windowHiTs itself is already
  // reflected inside fyToDateNet, so it must not ALSO be projected forward as
  // a "remaining" day — hence the "- 1": a window ending exactly on the last
  // day of the fiscal year has fyEnd - windowHiTs === 1 day, and 0 days
  // remain to project.
  const daysRemainingInFY = Math.max(0, Math.round((fyEnd - windowHiTs) / DAY) - 1);
  const runRatePerDay = m.rangeDays ? m.netBenefit / m.rangeDays : 0;
  const projectedFyEndNet = m.fyToDateNet + runRatePerDay * daysRemainingInFY;
  const forecastDelta = projectedFyEndNet - m.fyToDatePriorNet;

  // --- Target attainment (Finance settings: reference.financeTargets) -----
  const financeTargets = reference.financeTargets ?? NO_FINANCE_TARGETS;
  const estateTargetGBP = financeTargets.find((f) => f.spokeId === "ESTATE")?.annualNetBenefitTargetGBP;
  const estateAttainment =
    estateTargetGBP != null
      ? fyAttainment({ fyToDateNet: m.fyToDateNet, runRateNetPerDay: runRatePerDay, daysRemaining: daysRemainingInFY, target: estateTargetGBP })
      : undefined;
  // Per-spoke targets: bySpoke now carries a genuine per-spoke fiscal-year-
  // to-date net benefit (SpokeAgg.fyToDateNet), so the "vs target" comparison
  // is rendered as a column directly on SpokePLTable (see viz-finance.tsx)
  // rather than as a separate strip below the table — this list (ESTATE
  // excluded) is exactly what that column needs.
  // Memoized: SpokePLTable's onSortedChange feeds this page's own
  // spokePlSorted state, so an unmemoized `.filter()` here — a new array
  // reference every render even when financeTargets hasn't changed — would
  // retrigger SpokePLTable's internal sort memo (which depends on this
  // prop), refire its onSortedChange effect, setState here, and loop
  // forever (React's "Maximum update depth exceeded").
  const spokeFinanceTargets = useMemo(() => financeTargets.filter((f) => f.spokeId !== "ESTATE"), [financeTargets]);

  return (
    // Document-style page: it has more content (KPI strip, FY attainment,
    // waterfall + trend, spoke P&L, value league + review candidates) than
    // reliably fits any one viewport, so it scrolls inside .report__canvas
    // rather than being height-locked like the "fitted" operational pages —
    // see PageGrid's own doc comment. Every Row below also gets an explicit
    // min-height so its charts get a real, non-zero measured height even
    // when several rows are competing for space (the root cause of the
    // waterfall/monthly-trend charts rendering blank).
    <PageGrid fit={false}>
      <div className="kpi-row kpi-row--6">
        <KpiCard
          label="Net benefit (window)"
          value={hasRows ? fmtGBPc(m.netBenefit) : "—"}
          accent={v.completed}
          delta={m.prev.netBenefit ? (m.netBenefit - m.prev.netBenefit) / Math.abs(m.prev.netBenefit) : undefined}
          sub="vs prev. period"
        />
        <KpiCard label="Annualised run-rate net" value={hasRows ? fmtGBPc(runRateNet) : "—"} accent={v.good} sub="net × 365.25/window days" />
        <KpiCard label="ROI" value={m.automationCost ? `${roi.toFixed(1)}×` : "—"} accent={v.business} sub="benefit per £1 spent" />
        <KpiCard label="Payback" value={paybackMonths !== undefined ? `${paybackMonths.toFixed(1)} mo` : "—"} accent={v.system} sub="months of run-rate net to repay this period's estate cost" />
        <KpiCard
          label="FTE released"
          value={hasRows ? m.fte.toFixed(1) : "—"}
          accent={v.business}
          delta={m.prev.fte ? (m.fte - m.prev.fte) / Math.abs(m.prev.fte) : undefined}
          sub="colleague FTE-equivalent"
        />
        <KpiCard
          label="Cost per case vs target"
          value={fmtMoney2(m.costPerCase)}
          accent={v.accent}
          delta={m.prev.costPerCase ? (m.costPerCase - m.prev.costPerCase) / m.prev.costPerCase : undefined}
          deltaGood="down"
          sub="vs prev. period"
          target={{ label: `Target ≤ ${fmtMoney2(TARGETS.costPerCase)}`, met: m.costPerCase <= TARGETS.costPerCase }}
        />
      </div>

      <Row cols="1fr" grow={false}>
        <VisualCard
          title="FY target attainment"
          subtitle="Fiscal-year-to-date net benefit vs the estate's annual net benefit target, projected to fiscal-year-end at the current run-rate"
          summary={
            estateAttainment
              ? `FYTD net ${fmtGBPc(m.fyToDateNet)} (${fmtPct(estateAttainment.pct)} of target), projected ${fmtGBPc(estateAttainment.projected)} by FY-end vs a target of ${fmtGBPc(estateTargetGBP!)} — ${estateAttainment.onTrack ? "on track" : "behind"}.`
              : "No estate net benefit target is set — configure one in Administration → Targets & thresholds."
          }
        >
          {estateAttainment ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "baseline", fontFamily: fonts.body, padding: "4px 2px" }}>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>FY-to-date net</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: t.ink }}>{fmtGBPc(m.fyToDateNet)}</div>
              </div>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>vs target ({fmtGBPc(estateTargetGBP!)})</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: estateAttainment.onTrack ? v.good : v.bad }}>{fmtPct(estateAttainment.pct)}</div>
              </div>
              <div>
                <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>Projected FY-end</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: t.ink }}>{fmtGBPc(estateAttainment.projected)}</div>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: t.inkSoft, flex: "1 1 220px" }}>
                At the current run-rate the estate is projected to finish the fiscal year{" "}
                <strong style={{ color: estateAttainment.onTrack ? v.good : v.bad }}>{estateAttainment.onTrack ? "on track to meet" : "behind"}</strong> its {fmtGBPc(estateTargetGBP!)} net benefit target.
              </p>
            </div>
          ) : (
            <EmptyNote text="No estate net benefit target is set — configure one in Administration → Targets & thresholds." />
          )}
        </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)" style={{ minHeight: 380 }}>
        <VisualCard title="Benefit waterfall" subtitle="Gross benefit less the apportioned estate cost (Teams, Machines), reconciling to net benefit" summary={waterfallSummary}>
          {hasRows ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%", minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 260 }}>
                <WaterfallChart steps={waterfallSteps} />
              </div>
              <p style={{ margin: 0, flex: "0 0 auto", fontFamily: fonts.body, fontSize: 11.5, color: t.inkSoft, lineHeight: 1.4 }}>
                The CoE's shared costs are spread across all work by bot time; each spoke's own costs are spread across just that spoke's work.
              </p>
            </div>
          ) : (
            <EmptyNote text="No data for the current filters." />
          )}
        </VisualCard>

        <VisualCard
          title="Monthly value trend"
          subtitle="Cost split by component uses the period's overall people/infra ratio — see the waterfall for the exact window totals"
          summary={hasRows ? `${monthLabels.length} months shown; FYTD net ${fmtGBPc(m.fyToDateNet)} vs prior FYTD ${fmtGBPc(m.fyToDatePriorNet)}, since ${fmtDate(m.fyStartTs)}.` : "No data for the current filters."}
        >
          {hasRows && monthLabels.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%", minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 260 }}>
                <StackedCostTrend labels={monthLabels} stacks={monthlyStacks} net={monthlyNet} />
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "0 0 auto", fontFamily: fonts.body, fontSize: 12, color: t.inkSoft }}>
                <span>
                  FYTD (since {fmtDate(m.fyStartTs)}): <strong style={{ color: t.ink }}>{fmtGBPc(m.fyToDateNet)}</strong> net
                </span>
                {fytdDeltaPct !== undefined ? (
                  <span>
                    {fytdDeltaPct >= 0 ? "+" : "−"}
                    {fmtPct(Math.abs(fytdDeltaPct))} vs prior FYTD ({fmtGBPc(m.fyToDatePriorNet)})
                  </span>
                ) : (
                  <span>prior FYTD: {fmtGBPc(m.fyToDatePriorNet)}</span>
                )}
              </div>
            </div>
          ) : (
            <EmptyNote text="No data for the current filters." />
          )}
        </VisualCard>
      </Row>

      <Row cols="1fr" grow={false} style={{ minHeight: 320 }}>
        <VisualCard
          title="Spoke P&L"
          subtitle={`Gross benefit, apportioned cost, margin and vs-target by spoke, data through ${dataThroughISO}`}
          summary={spokePlSummary}
          right={
            <ExportCsvButton
              filename="spoke-pl"
              rows={() => {
                const targetMap = new Map(spokeFinanceTargets.map((f) => [f.spokeId, f.annualNetBenefitTargetGBP]));
                return spokePlSorted.map((r) => {
                  const target = targetMap.get(r.spoke);
                  return {
                    Spoke: r.spoke,
                    Gross: r.gross.toFixed(2),
                    "People cost": r.peopleCost.toFixed(2),
                    "Infra cost": r.infraCost.toFixed(2),
                    Net: r.net.toFixed(2),
                    "Margin %": (r.marginPct * 100).toFixed(2),
                    "Cost/case": r.costPerCase.toFixed(2),
                    "Completed cases": r.completed,
                    "vs target FYTD %": target ? ((r.fyToDateNet / target) * 100).toFixed(1) : "",
                  };
                });
              }}
            />
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <SpokePLTable rows={m.bySpoke} financeTargets={spokeFinanceTargets} onSortedChange={setSpokePlSorted} />
            </div>
          </div>
        </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)" style={{ minHeight: 340 }}>
        <VisualCard
          title="Process value league"
          subtitle="Top processes by net benefit (Pareto)"
          summary={
            positiveNet.length
              ? `${pctOfTotalShown}% of value shown comes from ${paretoItems.length} processes; ${thresholdCount} processes reach 80% of total positive net benefit.`
              : "No processes currently deliver positive net benefit for these filters."
          }
        >
          {positiveNet.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%", minHeight: 0 }}>
              <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, flex: "0 0 auto" }}>
                {pctOfTotalShown}% of value comes from {thresholdCount} processes{thresholdCount > 15 ? ` (showing the top 15 of ${positiveNet.length})` : ""}.
              </p>
              <div style={{ flex: 1, minHeight: 220 }}>
                <ParetoChart items={paretoItems} barColor={v.accent} lineColor={colors.netLine} thresholdPct={0.8} thresholdLabel="80% of positive net" />
              </div>
            </div>
          ) : (
            <EmptyNote text="No processes currently deliver positive net benefit for these filters." />
          )}
        </VisualCard>

        <VisualCard
          title="Review candidates"
          subtitle="Processes running at a net loss, worst first"
          summary={
            lossMakers.length
              ? `${lossMakers.length} processes are running at a net loss, totalling ${fmtGBPc(lossMakers.reduce((s, p) => s + p.net, 0))}.`
              : "No processes are running at a loss for the current filters."
          }
        >
          {lossMakers.length ? (
            <div style={{ overflow: "auto", height: "100%", minHeight: 0, border: `1px solid ${t.ruleSoft}`, borderRadius: 9 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body }}>
                <thead>
                  <tr>
                    {["Process", "Net", "Cost", "Completed", "Exception cost", "Why"].map((h) => (
                      <th
                        key={h}
                        style={{
                          position: "sticky",
                          top: 0,
                          background: t.paper,
                          padding: "9px 12px",
                          fontFamily: fonts.mono,
                          fontSize: 10.5,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          color: t.inkSoft,
                          fontWeight: 700,
                          borderBottom: `1px solid ${t.ruleSoft}`,
                          textAlign: h === "Process" || h === "Why" ? "left" : "right",
                          whiteSpace: "nowrap",
                        }}
                        title={h === "Why" ? "Rules applied in order: (1) completed < 30 → low volume; (2) exception cost > 30% of process cost → high exception cost; (3) unit cost > 1.5× the target cost per case → high unit cost; (4) otherwise → cost exceeds benefit at current volume/rate mix." : undefined}
                      >
                        {h}
                        {h === "Why" && <span aria-hidden> ⓘ</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lossMakers.map((p, i) => (
                    <tr key={p.id} style={{ background: i % 2 ? t.themeBand : "transparent" }}>
                      <td style={{ padding: "8px 12px", fontSize: 12.5, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, whiteSpace: "nowrap" }}>{p.name}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12.5, color: v.bad, borderBottom: `1px solid ${t.ruleSoft}`, textAlign: "right", whiteSpace: "nowrap" }}>{fmtGBPc(p.net)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12.5, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, textAlign: "right", whiteSpace: "nowrap" }}>{fmtGBPc(p.runtimeCost)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12.5, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, textAlign: "right", whiteSpace: "nowrap" }}>{fmtInt(p.completed)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12.5, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, textAlign: "right", whiteSpace: "nowrap" }}>{fmtGBPc(p.exceptionCostGBP)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: t.inkSoft, borderBottom: `1px solid ${t.ruleSoft}`, maxWidth: 280 }}>{classifyReviewCandidate(p, reference.targets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyNote text="No processes are running at a loss for the current filters." good />
          )}
        </VisualCard>
      </Row>

      <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, flex: "0 0 auto" }}>
        {hasRows
          ? `At the current run-rate the estate will deliver ≈${fmtGBPc(projectedFyEndNet)} net by FY-end; ${fmtGBPc(Math.abs(forecastDelta))} ${forecastDelta >= 0 ? "above" : "below"} the prior FY (prior FY-to-date only, for comparison).`
          : "No data for the current filters to project a run-rate."}
      </p>
    </PageGrid>
  );
}

function EmptyNote({ text, good }: { text: string; good?: boolean }) {
  const t = useTheme();
  const v = useViz();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 80, textAlign: "center", fontFamily: fonts.body, fontSize: 13, color: good ? v.good : t.inkSoft, padding: 12 }}>
      {text}
    </div>
  );
}
