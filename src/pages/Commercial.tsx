import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters, RATE_AUTO } from "../filters-context";
import { fmtDate, TARGETS } from "../rpaData";
import { KpiCard, VisualCard, LineChart, Legend, PageGrid, Row, useViz, fmtGBP, fmtGBPc, fmtMoney2, fmtCompact } from "../components/viz";

const DAY = 86400000;

export function Commercial() {
  const { model, peopleRate, setPeopleRate } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();
  const auto = peopleRate === RATE_AUTO;

  const labels = m.daily.map((d) => fmtDate(d.ts));
  const lastTs = m.daily.length ? m.daily[m.daily.length - 1].ts : 0;

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

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--5">
        <KpiCard label="Cost per completed case" value={fmtMoney2(m.costPerCase)} accent={v.accent} delta={m.prev.costPerCase ? (m.costPerCase - m.prev.costPerCase) / m.prev.costPerCase : 0} deltaGood="down" sub="vs prev. period" target={{ label: `Target ≤ ${fmtMoney2(TARGETS.costPerCase)}`, met: m.costPerCase <= TARGETS.costPerCase }} />
        <KpiCard label="Estate cost" value={fmtGBPc(m.automationCost)} accent={v.system} sub="hub pool + spoke infra, period" />
        <KpiCard label="Gross benefit" value={fmtGBPc(m.grossBenefit)} accent={v.good} sub={auto ? "SMV × grade rate in force" : `SMV × £${peopleRate}/hr override`} />
        <KpiCard label="Net benefit" value={fmtGBPc(m.netBenefit)} accent={v.completed} sub="benefit − cost" />
        <KpiCard label="Return on automation" value={`${roi.toFixed(1)}×`} accent={v.business} sub="benefit per £1 spent" />
      </div>

      {/* human-cost assumption: grade rate card by default, flat what-if override */}
      <Row cols="1fr" grow={false}>
      <VisualCard title="Human cost assumption (SMV valuation)" subtitle="Default values each process at the grade rate in force on the day work completed — drag to model a flat what-if rate instead">
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", paddingTop: 4 }}>
          <div style={{ minWidth: 168 }}>
            <div style={{ fontFamily: fonts.display, fontSize: 34, fontWeight: 700, color: t.ink, lineHeight: 1 }}>
              £{m.peopleRate.toFixed(2)}<span style={{ fontFamily: fonts.mono, fontSize: 13, color: t.inkSoft, fontWeight: 400 }}>/hr</span>
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
          <div style={{ display: "flex", gap: 26 }}>
            <Metric label="Gross benefit" value={fmtGBPc(m.grossBenefit)} color={v.good} />
            <Metric label="FTE released" value={`${m.fte.toFixed(1)}`} color={v.business} />
            <Metric label="Net benefit" value={fmtGBPc(m.netBenefit)} color={v.completed} />
          </div>
        </div>
      </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)">
        <VisualCard title="Cost per completed case over time" subtitle="Apportioned estate cost ÷ completed cases, by day — with 14-day forecast">
          <LineChart
            labels={labels}
            yFormat={(n) => "£" + n.toFixed(2)}
            tipFormat={(n) => "£" + n.toFixed(2)}
            refLines={[{ value: TARGETS.costPerCase, label: `Target £${TARGETS.costPerCase.toFixed(2)}`, color: v.business }]}
            forecast={{ periods: 14, labelFor: (k) => fmtDate(lastTs + (k + 1) * DAY) }}
            series={[{ name: "Cost / case", color: v.accent, values: cppSeries, area: true, forecast: true }]}
          />
        </VisualCard>

        <VisualCard title="Cumulative benefit vs cost" subtitle="Value released vs estate cost, accruing — with 14-day forecast" right={<Legend items={[{ label: "Cumulative benefit", color: v.good }, { label: "Cumulative cost", color: v.system }]} />}>
          <LineChart
            labels={labels}
            yFormat={fmtGBPc}
            tipFormat={fmtGBP}
            forecast={{ periods: 14, labelFor: (k) => fmtDate(lastTs + (k + 1) * DAY) }}
            series={[
              { name: "Cumulative benefit", color: v.good, values: cumBenefit, area: true, forecast: true },
              { name: "Cumulative cost", color: v.system, values: cumCost, forecast: true },
            ]}
          />
        </VisualCard>
      </Row>

      <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, flex: "0 0 auto" }}>
        Benefit: {fmtCompact(m.timeSavedHours)} colleague hours released this period, valued {auto ? "per process at the grade rate in force on each item's completion date (hub rate card)" : `at a flat £${peopleRate}/hr what-if override`}.
        Estate cost is the CoE hub pool (team + shared infra) apportioned across all work by bot worktime, plus each spoke's own VDI cost apportioned within the spoke — at the rates in force at the time.
      </p>
    </PageGrid>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    <div>
      <div style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft }}>{label}</div>
    </div>
  );
}
