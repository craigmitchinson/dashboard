import type { CSSProperties, ReactNode } from "react";
import type { DeliveryMetrics, Org, OrgField, RagStatus } from "../types";
import { RAG_LABELS } from "../types";
import { fonts, slide, type } from "../theme";
import { useTheme } from "../theme-context";
import { OrgIdentity } from "./OrgIdentity";
import { QuarterPicker } from "./QuarterPicker";
import type { Quarter } from "../quarters";

export interface YearPoint {
  label: string;
  isCurrent: boolean;
  metrics: DeliveryMetrics;
}

export interface RagPoint {
  label: string;
  isCurrent: boolean;
  counts: Record<RagStatus, number>;
}

// Predictability goal: the dashed line drawn across the predictability chart.
const PREDICTABILITY_TARGET = 80;
// Fixed height of a quarter column's label block, so an overlay (the target
// line) can map a percentage onto the bar area exactly.
const LABEL_BLOCK = 28;

interface Props {
  quarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  org: Org;
  onEditOrg: (field: OrgField, text: string) => void;
  year: number;
  series: YearPoint[];
  ragSeries: RagPoint[];
}

export function ChartsSlide(props: Props) {
  const theme = useTheme();
  const { series, year } = props;

  const sum = (k: keyof DeliveryMetrics) =>
    series.reduce((a, p) => a + p.metrics[k], 0);
  const ytdCommitted = sum("committed");
  const ytdDelivered = sum("delivered");
  const ytdCommittedDelivered = sum("committedDelivered");
  const ytdThroughput = sum("throughput");
  const ytdPredictability =
    ytdCommitted > 0
      ? Math.round((ytdCommittedDelivered / ytdCommitted) * 100)
      : 0;

  const cvMax = Math.max(
    1,
    ...series.map((p) => Math.max(p.metrics.committed, p.metrics.delivered)),
  );
  const tpMax = Math.max(1, ...series.map((p) => p.metrics.throughput));
  const ragMax = Math.max(
    1,
    ...props.ragSeries.map(
      (p) => p.counts["on-track"] + p.counts["at-risk"] + p.counts["off-track"],
    ),
  );
  const { ragSeries } = props;

  const frameStyle: CSSProperties = {
    width: slide.width,
    height: slide.height,
    background: theme.paper,
    padding: slide.padding,
    overflow: "hidden",
    boxShadow: theme.shadow,
    display: "flex",
    flexDirection: "column",
    fontFamily: fonts.body,
    color: theme.ink,
    position: "relative",
  };

  const predColour = (pct: number) =>
    pct >= 80
      ? theme.status.committed.dot
      : pct >= 60
        ? theme.status["not-committed"].dot
        : theme.status.blocked.dot;

  return (
    <div className="slide-frame" style={frameStyle}>
      {/* Title strip */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 32,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 6 }}>
            <QuarterPicker quarter={props.quarter} onChange={props.onQuarterChange} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
            <span
              style={{
                fontFamily: fonts.display,
                fontSize: type.slideTitle,
                fontWeight: 700,
                lineHeight: 1.05,
                color: theme.ink,
              }}
            >
              Performance {year}
            </span>
            <span
              aria-hidden
              style={{
                fontFamily: fonts.display,
                fontSize: type.slideTitle,
                fontWeight: 700,
                lineHeight: 1.05,
                color: theme.accent,
              }}
            >
              .
            </span>
          </div>
        </div>
        <OrgIdentity org={props.org} onEdit={props.onEditOrg} />
      </div>

      {/* YTD totals */}
      <div
        style={{
          borderTop: `2px solid ${theme.rule}`,
          paddingTop: 14,
          marginBottom: 16,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <Stat label="Committed (YTD)" value={ytdCommitted} accent={theme.ink} />
        <Stat
          label="Delivered (YTD)"
          value={ytdDelivered}
          accent={theme.status.committed.dot}
        />
        <Stat
          label="Predictability (YTD)"
          value={`${ytdPredictability}%`}
          accent={predColour(ytdPredictability)}
        />
        <Stat
          label="Throughput (YTD)"
          value={ytdThroughput}
          accent={theme.accentSoft}
        />
      </div>

      {/* Charts: a balanced 2x2 grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 16,
        }}
      >
        {/* Committed vs delivered */}
        <ChartCard
          title="Committed vs delivered"
          legend={
            <>
              <LegendDot colour={theme.inkFaint} label="Committed" />
              <LegendDot colour={theme.status.committed.dot} label="Delivered" />
            </>
          }
        >
          <div style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 18 }}>
            {series.map((p) => (
              <QuarterColumn key={p.label} label={p.label} isCurrent={p.isCurrent}>
                <Bar
                  height={(p.metrics.committed / cvMax) * 100}
                  colour={theme.inkFaint}
                  value={p.metrics.committed}
                />
                <Bar
                  height={(p.metrics.delivered / cvMax) * 100}
                  colour={theme.status.committed.dot}
                  value={p.metrics.delivered}
                />
              </QuarterColumn>
            ))}
          </div>
        </ChartCard>

        {/* Predictability, with a dashed target line */}
        <ChartCard
          title="Predictability by quarter"
          legend={
            <LegendLine
              colour={theme.accent}
              label={`Target ${PREDICTABILITY_TARGET}%`}
            />
          }
        >
          <div
            style={{
              flex: 1,
              position: "relative",
              display: "flex",
              alignItems: "stretch",
              gap: 14,
            }}
          >
            {/* Target line sits at PREDICTABILITY_TARGET% of the bar area, which
                ends LABEL_BLOCK px above the bottom (the quarter labels). */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `calc(${LABEL_BLOCK}px + ${PREDICTABILITY_TARGET / 100} * (100% - ${LABEL_BLOCK}px))`,
                height: 0,
                borderTop: `2px dashed ${theme.accent}`,
                opacity: 0.65,
                pointerEvents: "none",
              }}
            />
            {series.map((p) => {
              const pct =
                p.metrics.committed > 0
                  ? Math.round(
                      (p.metrics.committedDelivered / p.metrics.committed) * 100,
                    )
                  : 0;
              return (
                <QuarterColumn key={p.label} label={p.label} isCurrent={p.isCurrent}>
                  <Bar height={pct} colour={predColour(pct)} value={`${pct}%`} />
                </QuarterColumn>
              );
            })}
          </div>
        </ChartCard>

        {/* Throughput */}
        <ChartCard title="Throughput by quarter">
          <div style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 14 }}>
            {series.map((p) => (
              <QuarterColumn key={p.label} label={p.label} isCurrent={p.isCurrent}>
                <Bar
                  height={(p.metrics.throughput / tpMax) * 100}
                  colour={theme.accentSoft}
                  value={p.metrics.throughput}
                />
              </QuarterColumn>
            ))}
          </div>
        </ChartCard>

        {/* Objectives RAG trend: a stacked bar per quarter */}
        <ChartCard
          title="Objectives RAG trend"
          legend={
            <>
              <LegendDot colour={theme.status.committed.dot} label="On track" />
              <LegendDot colour={theme.status["not-committed"].dot} label="At risk" />
              <LegendDot colour={theme.status.blocked.dot} label="Off track" />
            </>
          }
        >
          <div style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 14 }}>
            {ragSeries.map((p) => {
              const total =
                p.counts["on-track"] +
                p.counts["at-risk"] +
                p.counts["off-track"];
              return (
                <QuarterColumn key={p.label} label={p.label} isCurrent={p.isCurrent}>
                  <RagBar counts={p.counts} max={ragMax} total={total} />
                </QuarterColumn>
              );
            })}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  const theme = useTheme();
  return (
    <div
      data-spot=""
      style={{
        background: theme.themeBand,
        borderLeft: `5px solid ${accent}`,
        borderRadius: slide.radius,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span
        style={{
          fontFamily: fonts.display,
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1,
          color: accent,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: type.columnHeader - 1,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: theme.inkSoft,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ChartCard({
  title,
  legend,
  style,
  children,
}: {
  title: string;
  legend?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <section
      data-spot=""
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: slide.radius,
        border: `1px solid ${theme.ruleSoft}`,
        padding: 16,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: fonts.display,
            fontSize: type.outcome + 3,
            fontWeight: 600,
            color: theme.ink,
          }}
        >
          {title}
        </span>
        {legend && (
          <span style={{ display: "inline-flex", gap: 14 }}>{legend}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function LegendDot({ colour, label }: { colour: string; label: string }) {
  const theme = useTheme();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: fonts.mono,
        fontSize: type.control,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: theme.inkSoft,
      }}
    >
      <span
        style={{ width: 12, height: 12, borderRadius: 3, background: colour }}
      />
      {label}
    </span>
  );
}

function QuarterColumn({
  label,
  isCurrent,
  children,
}: {
  label: string;
  isCurrent: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        minWidth: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {children}
      </div>
      <div
        style={{
          marginTop: 8,
          height: LABEL_BLOCK - 8,
          lineHeight: `${LABEL_BLOCK - 8}px`,
          textAlign: "center",
          fontFamily: fonts.mono,
          fontSize: type.control,
          letterSpacing: "0.06em",
          color: isCurrent ? theme.accentSoft : theme.inkSoft,
          fontWeight: isCurrent ? 700 : 400,
        }}
      >
        {label}
        {isCurrent ? " ·" : ""}
      </div>
    </div>
  );
}

function Bar({
  height,
  colour,
  value,
}: {
  height: number;
  colour: string;
  value: string | number;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        flex: 1,
        maxWidth: 60,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        height: "100%",
      }}
    >
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: type.feature + 1,
          color: theme.ink,
          marginBottom: 4,
        }}
      >
        {value}
      </span>
      <div
        style={{
          width: "100%",
          height: `${Math.max(2, Math.min(100, height))}%`,
          minHeight: 2,
          background: colour,
          borderRadius: "5px 5px 0 0",
          transition: "height 0.4s ease",
        }}
      />
    </div>
  );
}

function LegendLine({ colour, label }: { colour: string; label: string }) {
  const theme = useTheme();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: fonts.mono,
        fontSize: type.control,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: theme.inkSoft,
      }}
    >
      <span
        style={{ width: 16, height: 0, borderTop: `2px dashed ${colour}` }}
      />
      {label}
    </span>
  );
}

// A stacked bar of objective RAG counts: off track on top, then at risk, then
// on track, the whole stack scaled so the tallest quarter fills the area.
function RagBar({
  counts,
  max,
  total,
}: {
  counts: Record<RagStatus, number>;
  max: number;
  total: number;
}) {
  const theme = useTheme();
  const segments: { status: RagStatus; colour: string }[] = [
    { status: "off-track", colour: theme.status.blocked.dot },
    { status: "at-risk", colour: theme.status["not-committed"].dot },
    { status: "on-track", colour: theme.status.committed.dot },
  ];
  return (
    <div
      style={{
        flex: 1,
        maxWidth: 60,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        height: "100%",
      }}
    >
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: type.feature + 1,
          color: total === 0 ? theme.inkSoft : theme.ink,
          marginBottom: 4,
        }}
      >
        {total}
      </span>
      <div
        title={segments
          .map((s) => `${RAG_LABELS[s.status]}: ${counts[s.status]}`)
          .join(" · ")}
        style={{
          width: "100%",
          height: `${total > 0 ? Math.max(2, (total / max) * 100) : 0}%`,
          minHeight: total > 0 ? 2 : 0,
          borderRadius: "5px 5px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transition: "height 0.4s ease",
        }}
      >
        {segments.map(
          (s) =>
            counts[s.status] > 0 && (
              <div
                key={s.status}
                style={{ flex: counts[s.status], background: s.colour }}
              />
            ),
        )}
      </div>
    </div>
  );
}
