import { fonts, type as typeScale } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters, RATE_AUTO } from "../filters-context";
import { fmtDate } from "../rpaData";
import { KpiCard, VisualCard, LineChart, Legend, PageGrid, Row, useViz, fmtGBP, fmtGBPc, fmtMoney2, fmtCompact } from "../components/viz";
import { ExportCsvButton } from "../components/PageActions";
import { seasonalNaiveForecast } from "../components/forecast";
import { useReference } from "../reference/reference-context";

const DAY = 86400000;

export function Commercial() {
  const { model, peopleRate, setPeopleRate } = useFilters();
  const { reference } = useReference();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const auto = peopleRate === RATE_AUTO;
  const costPerCaseTarget = reference.targets.costPerCase;

  const labels = m.daily.map((d) => fmtDate(d.ts));
  // Fall back to the selected range's end (not the Unix epoch) so a zero-row
  // filter combo still anchors the "N-day forecast" region at a sensible
  // date instead of projecting from 1 Jan 1970.
  const lastTs = m.daily.length ? m.daily[m.daily.length - 1].ts : m.cutoffTs + (m.rangeDays - 1) * DAY;

  // per-day cost per completed case, from the day's REAL apportioned estate
  // cost (hub pool + spoke infra at the rates in force that day)
  const cppSeries = m.daily.map((d) => {
    const attempts = d.completed + d.business + d.system;
    // floor the denominator so very low-volume days don't spike the axis
    const denom = Math.max(d.completed, attempts * 0.5);
    return denom ? d.cost / denom : 0;
  });

  // cumulative benefit vs cumulative cost, both time-correct
  let cb = 0;
  let cc = 0;
  const cumBenefit: number[] = [];
  const cumCost: number[] = [];
  m.daily.forEach((d) => {
    cb += d.benefit;
    cc += d.cost;
    cumBenefit.push(cb);
    cumCost.push(cc);
  });

  const roi = m.automationCost ? m.grossBenefit / m.automationCost : 0;

  // Seasonal-naive 14-day forecast (see components/forecast.ts) — same
  // weekday's average over the last 4 weeks of actuals, replacing the old
  // linear-regression + fixed ±12% band. Keyed by the REAL calendar date
  // (d.key — SeriesPoint's key is the row's ISO date, see filters-context.tsx's
  // aggregate()), not by array index — m.daily only has an entry for a date
  // that actually had rows, so a zero-activity day is a GAP, not a zero
  // entry, and indexing "7 back" through such a series would silently walk
  // 7 entries instead of 7 days once any gap exists upstream of it.
  const FORECAST_PERIODS = 14;
  const cppPoints = m.daily.map((d, i) => ({ dateISO: d.key, value: cppSeries[i] }));
  const cppForecast = seasonalNaiveForecast(cppPoints, FORECAST_PERIODS);

  // Cumulative benefit/cost are running totals, not levels — forecasting the
  // DAILY increments (same seasonal-naive model) and integrating them onto
  // the last actual cumulative value keeps the projection growing forward,
  // rather than seasonal-naive-ing the cumulative series itself (which would
  // just echo past cumulative LEVELS from 1-4 weeks ago instead of
  // continuing to accrue).
  const dailyBenefitPoints = m.daily.map((d) => ({ dateISO: d.key, value: d.benefit }));
  const dailyCostPoints = m.daily.map((d) => ({ dateISO: d.key, value: d.cost }));
  const benefitDeltaForecast = seasonalNaiveForecast(dailyBenefitPoints, FORECAST_PERIODS);
  const costDeltaForecast = seasonalNaiveForecast(dailyCostPoints, FORECAST_PERIODS);
  const integrateForecast = (lastActual: number, delta: { point: number[]; lo: number[]; hi: number[] }) => {
    let cp = lastActual, cl = lastActual, ch = lastActual;
    const point: number[] = [], lo: number[] = [], hi: number[] = [];
    for (let k = 0; k < delta.point.length; k++) {
      cp += delta.point[k];
      cl += delta.lo[k];
      ch += delta.hi[k];
      point.push(cp);
      lo.push(cl);
      hi.push(ch);
    }
    return { point, lo, hi };
  };
  const cumBenefitForecast = integrateForecast(cumBenefit.length ? cumBenefit[cumBenefit.length - 1] : 0, benefitDeltaForecast);
  const cumCostForecast = integrateForecast(cumCost.length ? cumCost[cumCost.length - 1] : 0, costDeltaForecast);

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--5">
        <KpiCard label="Cost per completed case" value={fmtMoney2(m.costPerCase)} accent={v.accent} delta={m.prev.costPerCase ? (m.costPerCase - m.prev.costPerCase) / m.prev.costPerCase : 0} deltaGood="down" sub="vs prev. period" target={{ label: `Target ≤ ${fmtMoney2(costPerCaseTarget)}`, met: m.costPerCase <= costPerCaseTarget }} />
        <KpiCard label="Estate cost" value={fmtGBPc(m.automationCost)} accent={v.system} sub="Teams + Machines, period" />
        <KpiCard label="Gross benefit" value={fmtGBPc(m.grossBenefit)} accent={v.good} sub={auto ? "SMV × grade rate in force" : `SMV × £${peopleRate}/hr override`} />
        <KpiCard label="Net benefit" value={fmtGBPc(m.netBenefit)} accent={v.completed} sub="benefit − cost" />
        <KpiCard label="Return on automation" value={`${roi.toFixed(1)}×`} accent={v.business} sub="benefit per £1 spent" />
      </div>

      {/* human-cost assumption: grade rate card by default, flat what-if override */}
      <Row cols="1fr" grow={false}>
      <VisualCard title="Human cost assumption (SMV valuation)" subtitle="Default values each process at the grade rate in force on the day work completed — drag to model a flat what-if rate instead">
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", paddingTop: 4 }}>
          <div style={{ minWidth: 148 }}>
            <div style={{ ...typeScale.displayM, color: t.ink }}>
              £{m.peopleRate.toFixed(2)}<span style={{ fontFamily: fonts.mono, fontSize: 12, color: t.inkSoft, fontWeight: 400 }}>/hr</span>
            </div>
            <div style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: auto ? v.good : v.business, marginTop: 3 }}>
              {auto ? "Grade rate card (blended)" : "Flat override"}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              type="range"
              min={15}
              max={60}
              step={1}
              value={auto ? Math.round(m.peopleRate) : peopleRate}
              onChange={(e) => setPeopleRate(Number(e.target.value))}
              className="cost-slider"
              aria-label="Flat colleague hourly rate override for human cost assumption, £15 to £60"
              style={{ width: "100%", accentColor: auto ? v.good : v.accent }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fonts.mono, fontSize: 10.5, color: t.inkSoft, marginTop: 2 }}>
              <span>£15</span><span>£60</span>
            </div>
          </div>
          {!auto && (
            <button onClick={() => setPeopleRate(RATE_AUTO)} style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${t.ruleSoft}`, background: "transparent", color: t.inkSoft }}>
              ↩ Use grade rates
            </button>
          )}
        </div>
      </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)">
        <VisualCard title="Cost per completed case over time" subtitle="Apportioned estate cost ÷ completed cases, by day — with 14-day forecast (same-weekday average of the last four weeks)">
          <LineChart
            labels={labels}
            yFormat={(n) => "£" + n.toFixed(2)}
            tipFormat={(n) => "£" + n.toFixed(2)}
            refLines={[{ value: costPerCaseTarget, label: `Target £${costPerCaseTarget.toFixed(2)}`, color: v.business }]}
            forecast={{ periods: FORECAST_PERIODS, labelFor: (k) => fmtDate(lastTs + (k + 1) * DAY) }}
            series={[{ name: "Cost / case", color: v.accent, values: cppSeries, area: true, forecast: true, forecastPoint: cppForecast.point, forecastLo: cppForecast.lo, forecastHi: cppForecast.hi }]}
          />
        </VisualCard>

        <VisualCard
          title="Cumulative benefit vs cost"
          subtitle="Value released vs estate cost, accruing — with 14-day forecast (same-weekday average of the last four weeks)"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Legend items={[{ label: "Cumulative benefit", color: v.good }, { label: "Cumulative cost", color: v.system }]} />
              <ExportCsvButton
                filename="commercial-monthly"
                rows={() => labels.map((label, i) => ({ Date: label, "Cost per case": cppSeries[i].toFixed(2), "Cumulative benefit": cumBenefit[i].toFixed(2), "Cumulative cost": cumCost[i].toFixed(2) }))}
              />
            </div>
          }
        >
          <LineChart
            labels={labels}
            yFormat={fmtGBPc}
            tipFormat={fmtGBP}
            forecast={{ periods: FORECAST_PERIODS, labelFor: (k) => fmtDate(lastTs + (k + 1) * DAY) }}
            series={[
              { name: "Cumulative benefit", color: v.good, values: cumBenefit, area: true, forecast: true, forecastPoint: cumBenefitForecast.point, forecastLo: cumBenefitForecast.lo, forecastHi: cumBenefitForecast.hi },
              { name: "Cumulative cost", color: v.system, values: cumCost, forecast: true, forecastPoint: cumCostForecast.point, forecastLo: cumCostForecast.lo, forecastHi: cumCostForecast.hi },
            ]}
          />
        </VisualCard>
      </Row>

      <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, flex: "0 0 auto" }}>
        Benefit: {fmtCompact(m.timeSavedHours)} colleague hours released this period, valued {auto ? "per process at the grade rate in force on each item's completion date (hub rate card)" : `at a flat £${peopleRate}/hr what-if override`}.
        Estate cost is people (Teams) and VDI (Machines) cost at the rates in force at the time: the CoE's shared costs are spread across all work by bot worktime, each spoke's own costs across just that spoke's work.
      </p>
    </PageGrid>
  );
}
