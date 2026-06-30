import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useFilters } from "../filters-context";
import { fmtDate } from "../rpaData";
import { KpiCard, VisualCard, LineChart, Legend, PageGrid, Row, useViz, fmtGBP, fmtGBPc, fmtMoney2, fmtCompact } from "../components/viz";

export function Commercial() {
  const { model, peopleRate, setPeopleRate } = useFilters();
  const m = model;
  const v = useViz();
  const t = useTheme();

  const labels = m.daily.map((d) => fmtDate(d.ts));

  // per-day cost per completed case: cost scales with attempts, divided by the
  // day's completed volume, so days with more exceptions cost more per case.
  const costRatio = m.attempts ? m.automationCost / m.attempts : 0;
  const cppSeries = m.daily.map((d) => {
    const attempts = d.completed + d.business + d.system;
    // floor the denominator so very low-volume days don't spike the axis
    const denom = Math.max(d.completed, attempts * 0.5);
    return denom ? (attempts * costRatio) / denom : 0;
  });

  // cumulative benefit (time saved x rate) against cumulative automation cost
  const hoursPerCompleted = m.completed ? m.timeSavedHours / m.completed : 0;
  let cb = 0;
  let cc = 0;
  const cumBenefit: number[] = [];
  const cumCost: number[] = [];
  m.daily.forEach((d) => {
    const attempts = d.completed + d.business + d.system;
    cb += d.completed * hoursPerCompleted * peopleRate;
    cc += attempts * costRatio;
    cumBenefit.push(cb);
    cumCost.push(cc);
  });

  const roi = m.automationCost ? m.grossBenefit / m.automationCost : 0;

  return (
    <PageGrid>
      <div className="kpi-row kpi-row--5">
        <KpiCard label="Cost per completed case" value={fmtMoney2(m.costPerCase)} accent={v.accent} delta={m.prev.costPerCase ? (m.costPerCase - m.prev.costPerCase) / m.prev.costPerCase : 0} deltaGood="down" sub="vs prev. period" />
        <KpiCard label="Automation cost" value={fmtGBPc(m.automationCost)} accent={v.system} sub="runtime, period" />
        <KpiCard label="Gross benefit" value={fmtGBPc(m.grossBenefit)} accent={v.good} sub="time saved × rate" />
        <KpiCard label="Net benefit" value={fmtGBPc(m.netBenefit)} accent={v.completed} sub="benefit − cost" />
        <KpiCard label="Return on automation" value={`${roi.toFixed(1)}×`} accent={v.business} sub="benefit per £1 spent" />
      </div>

      {/* people cost slider */}
      <Row cols="1fr" grow={false}>
      <VisualCard title="People cost assumption" subtitle="Drag to model the colleague hourly rate used for benefit — every figure on the page updates">
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", paddingTop: 4 }}>
          <div style={{ minWidth: 120 }}>
            <div style={{ fontFamily: fonts.display, fontSize: 34, fontWeight: 700, color: t.ink, lineHeight: 1 }}>£{peopleRate}<span style={{ fontFamily: fonts.mono, fontSize: 13, color: t.inkSoft, fontWeight: 400 }}>/hr</span></div>
            <div style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: t.inkSoft, marginTop: 3 }}>Fully-loaded rate</div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              type="range"
              min={15}
              max={60}
              step={1}
              value={peopleRate}
              onChange={(e) => setPeopleRate(Number(e.target.value))}
              className="cost-slider"
              style={{ width: "100%", accentColor: v.accent }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fonts.mono, fontSize: 10.5, color: t.inkSoft, marginTop: 2 }}>
              <span>£15</span><span>£60</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 26 }}>
            <Metric label="Gross benefit" value={fmtGBPc(m.grossBenefit)} color={v.good} />
            <Metric label="FTE released" value={`${m.fte.toFixed(1)}`} color={v.business} />
            <Metric label="Net benefit" value={fmtGBPc(m.netBenefit)} color={v.completed} />
          </div>
        </div>
      </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)">
        <VisualCard title="Cost per completed case over time" subtitle="Automation runtime cost ÷ completed cases, by day">
          <LineChart labels={labels} yFormat={(n) => "£" + n.toFixed(2)} tipFormat={(n) => "£" + n.toFixed(2)} series={[{ name: "Cost / case", color: v.accent, values: cppSeries, area: true }]} />
        </VisualCard>

        <VisualCard title="Cumulative benefit vs cost" subtitle="Colleague time saved × rate, accruing across the period" right={<Legend items={[{ label: "Cumulative benefit", color: v.good }, { label: "Cumulative cost", color: v.system }]} />}>
          <LineChart
            labels={labels}
            yFormat={fmtGBPc}
            tipFormat={fmtGBP}
            series={[
              { name: "Cumulative benefit", color: v.good, values: cumBenefit, area: true },
              { name: "Cumulative cost", color: v.system, values: cumCost },
            ]}
          />
        </VisualCard>
      </Row>

      <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, flex: "0 0 auto" }}>
        Benefit assumes {fmtCompact(m.timeSavedHours)} colleague hours saved this period at £{peopleRate}/hr. Automation cost is digital-worker runtime priced at each pool's licence rate.
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
