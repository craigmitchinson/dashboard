import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { META } from "../rpaData";
import { VisualCard, PageGrid, Row, useViz } from "../components/viz";
import { Bionic } from "../a11y/Bionic";

// Architecture + star schema reference: where the numbers on every page come
// from, and the contract to rebuild the same model in another BI tool or an API.

interface Tbl {
  x: number;
  y: number;
  w: number;
  title: string;
  kind: "fact" | "dim";
  fields: string[];
  color: string;
}

export function DataModel() {
  const t = useTheme();
  const v = useViz();

  const tables: Tbl[] = [
    { x: 380, y: 105, w: 250, title: "Fact_WorkItem (day grain)", kind: "fact", color: v.accent, fields: ["Date (FK) · ProcessId (FK)", "Completed · BusExc · SysExc", "WorktimeSec", "GrossBenefitGBP (grade-rate)", "EstateCostGBP (hub+spoke)"] },
    { x: 60, y: 10, w: 230, title: "Dim_Process", kind: "dim", color: v.completed, fields: ["ProcessId (PK)", "Name · Proposition", "Spoke (FK) · Queues", "SMV mins · Grade (FK)"] },
    { x: 60, y: 245, w: 230, title: "Dim_DigitalWorker", kind: "dim", color: v.business, fields: ["ResourceName (PK)", "VDI · CostClass", "Spoke (FK) · Lifecycle", "ActiveFrom / ActiveTo"] },
    { x: 720, y: 10, w: 230, title: "Dim_Date", kind: "dim", color: v.good, fields: ["Date (PK)", "MonthLabel + SortKey", "QuarterLabel + SortKey", "EstateRate in force"] },
    { x: 720, y: 245, w: 230, title: "Dim_ExceptionReason", kind: "dim", color: v.system, fields: ["Reason (PK) — real text", "Type (System / Business)", "from prefix → pattern →", "default classification"] },
  ];
  const fact = tables[0];
  const rowH = 21;
  const hdrH = 30;
  const th = (tb: Tbl) => hdrH + tb.fields.length * rowH;

  // connector from a dim to the fact
  const factC = { x: fact.x + fact.w / 2, y: fact.y + th(fact) / 2 };
  const link = (tb: Tbl) => {
    const c = { x: tb.x + tb.w / 2, y: tb.y + th(tb) / 2 };
    const fromX = c.x < factC.x ? tb.x + tb.w : tb.x;
    const toX = c.x < factC.x ? fact.x : fact.x + fact.w;
    return { fromX, fromY: c.y, toX, toY: factC.y, leftSide: c.x < factC.x };
  };

  const lineage = [
    { label: "Blue Prism API", sub: "work queue items", color: v.accent },
    { label: "Elastic / Kibana", sub: "log store, per queue", color: v.business },
    { label: "CSV / raw layer", sub: "BPAWorkQueueItem schema", color: v.system },
    { label: "SQL warehouse", sub: "staging → core → report", color: v.completed },
    { label: "This dashboard", sub: "views only, no maths", color: v.good },
  ];

  const relationships = [
    "Fact[ProcessId] → Dim_Process[ProcessId]  (★ → 1)",
    "Fact[Date] → Dim_Date[Date]  (★ → 1)",
    "Dim_Process[Spoke] → Dim_Spoke  ·  Dim_DigitalWorker[Spoke] → Dim_Spoke",
    "Dim_Process[Grade] → date-effective grade rate card (benefit basis)",
    "Exceptions: Fact_Exception (day × process × reason) → Dim_ExceptionReason",
  ];
  const notes = [
    `Source this build: ${META.source} — ${META.sourceRows.toLocaleString()} queue items, built ${META.generatedAt.slice(0, 10)}. Swap the CSV (or point VITE_DATA_URL at the API) and every visual follows.`,
    "Money is resolved in the pipeline, never in visuals: benefit = SMV × grade rate in force on the outcome date; cost = worktime × (hub £/bot-sec + spoke infra £/bot-sec) of that day.",
    "BI-tool parity: connect to the report.vw_* views (or /data/views/*.json) — same shapes, same numbers. Set MonthLabel 'Sort by' = MonthSortKey once.",
    "Hub & spoke: VDI class rates are hub-set; each spoke's infra pool is its own VDIs; the CoE team pool is shared across all work by worktime.",
  ];

  return (
    <PageGrid>
      {/* lineage strip */}
      <Row cols="1fr" grow={false}>
        <VisualCard title="Data lineage" subtitle="Left to right — each hop is swappable; the schema is the contract">
          <div style={{ display: "flex", alignItems: "stretch", gap: 8, paddingTop: 4 }}>
            {lineage.map((s, i) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0, border: `1px solid ${t.ruleSoft}`, borderTop: `3px solid ${s.color}`, borderRadius: 9, padding: "8px 10px", background: t.themeBand }}>
                  <div style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: 700, color: t.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                  <div style={{ fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div>
                </div>
                {i < lineage.length - 1 && <span style={{ color: t.inkSoft, fontFamily: fonts.mono, flex: "0 0 auto" }}>→</span>}
              </div>
            ))}
          </div>
        </VisualCard>
      </Row>

      <Row cols="1fr" style={{ flex: 1.35 }}>
        <VisualCard title="Star schema" subtitle="The model this app aggregates client-side — identical to the report.vw_* SQL views">
          <svg viewBox="0 0 1010 420" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
            {tables.slice(1).map((tb) => {
              const l = link(tb);
              return (
                <g key={tb.title}>
                  <line x1={l.fromX} y1={l.fromY} x2={l.toX} y2={l.toY} stroke={v.soft} strokeWidth={1.4} />
                  <text x={l.fromX + (l.leftSide ? 6 : -6)} y={l.fromY - 5} textAnchor={l.leftSide ? "start" : "end"} fontFamily={fonts.mono} fontSize={12} fontWeight={700} fill={v.soft}>1</text>
                  <text x={l.toX + (l.leftSide ? -6 : 6)} y={l.toY - 5} textAnchor={l.leftSide ? "end" : "start"} fontFamily={fonts.mono} fontSize={13} fontWeight={700} fill={v.soft}>∗</text>
                </g>
              );
            })}
            {tables.map((tb) => (
              <g key={tb.title}>
                <rect x={tb.x} y={tb.y} width={tb.w} height={th(tb)} rx={9} fill={t.paper} stroke={tb.kind === "fact" ? tb.color : t.ruleSoft} strokeWidth={tb.kind === "fact" ? 2 : 1.2} />
                <rect x={tb.x} y={tb.y} width={tb.w} height={hdrH} rx={9} fill={tb.color} opacity={tb.kind === "fact" ? 0.22 : 0.16} />
                <rect x={tb.x} y={tb.y + hdrH - 9} width={tb.w} height={9} fill={t.paper} />
                <line x1={tb.x} y1={tb.y + hdrH} x2={tb.x + tb.w} y2={tb.y + hdrH} stroke={t.ruleSoft} strokeWidth={1} />
                <text x={tb.x + 12} y={tb.y + 20} fontFamily={fonts.mono} fontSize={13} fontWeight={700} fill={t.ink}>{tb.title}</text>
                <circle cx={tb.x + tb.w - 14} cy={tb.y + 15} r={4} fill={tb.color} />
                {tb.fields.map((f, i) => (
                  <text key={f} x={tb.x + 12} y={tb.y + hdrH + 15 + i * rowH} fontFamily={fonts.body} fontSize={12.5} fill={t.ink}>{f}</text>
                ))}
              </g>
            ))}
          </svg>
        </VisualCard>
      </Row>

      <Row cols="minmax(0,1fr) minmax(0,1fr)">
        <VisualCard title="Relationships" subtitle="Cardinality and filter direction">
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 11, height: "100%" }}>
            {relationships.map((r) => (
              <div key={r} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: v.accent, fontFamily: fonts.mono, fontWeight: 700, flex: "0 0 auto" }}>→</span>
                <span style={{ fontFamily: fonts.mono, fontSize: 12, color: t.ink, lineHeight: 1.5 }}>{r}</span>
              </div>
            ))}
          </div>
        </VisualCard>
        <VisualCard title="Modelling notes" subtitle="The contract every consumer shares">
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 11, height: "100%" }}>
            {notes.map((nNote) => (
              <div key={nNote} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: v.good, fontWeight: 700, flex: "0 0 auto" }}>✓</span>
                <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.5 }}><Bionic>{nNote}</Bionic></span>
              </div>
            ))}
          </div>
        </VisualCard>
      </Row>
    </PageGrid>
  );
}
