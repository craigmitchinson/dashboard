import { Fragment } from "react";
import type { CSSProperties } from "react";
import type {
  DeliveryMetrics,
  DeliveryHighlight,
  MetricField,
  HighlightField,
  Org,
  OrgField,
} from "../types";
import { METRIC_ROWS } from "../types";
import { fonts, slide, type } from "../theme";
import { useTheme } from "../theme-context";
import { EditableText } from "./EditableText";
import { OrgIdentity } from "./OrgIdentity";
import { QuarterPicker } from "./QuarterPicker";
import { TeamPicker } from "./TeamPicker";
import type { Quarter } from "../quarters";

export interface DeliveryColumn {
  key: string;
  label: string;
  isCurrent: boolean;
  metrics: DeliveryMetrics;
}

interface Props {
  quarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  org: Org;
  onEditOrg: (field: OrgField, text: string) => void;
  title: string;
  onEditTitle: (text: string) => void;
  columns: DeliveryColumn[];
  onEditMetric: (key: string, field: MetricField, text: string) => void;
  highlights: DeliveryHighlight[];
  onAddHighlight: () => void;
  onEditHighlight: (id: string, field: HighlightField, text: string) => void;
  onRemoveHighlight: (id: string) => void;
}

export function DeliverySlide(props: Props) {
  const theme = useTheme();
  const { columns } = props;

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

  // Bar fill colour per metric row.
  const rowColour: Record<MetricField, string> = {
    committed: theme.inkSoft,
    delivered: theme.status.committed.dot,
    committedDelivered: theme.status.committed.dot,
    throughput: theme.accentSoft,
  };

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
            <QuarterPicker
              quarter={props.quarter}
              onChange={props.onQuarterChange}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
            <EditableText
              value={props.title}
              onCommit={props.onEditTitle}
              ariaLabel="Slide title"
              style={{
                fontFamily: fonts.display,
                fontSize: type.slideTitle,
                fontWeight: 700,
                lineHeight: 1.05,
                color: theme.ink,
              }}
            />
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

      {/* Body: metrics matrix (left) + highlights (right) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderTop: `2px solid ${theme.rule}`,
          paddingTop: 14,
          display: "grid",
          gridTemplateColumns: "1.85fr 1fr",
          gap: 22,
        }}
      >
        {/* Metrics matrix: header row + four rows that stretch to fill height. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr repeat(3, 1fr)",
            gridTemplateRows: "auto repeat(4, 1fr)",
            minHeight: 0,
          }}
        >
          {/* Header row */}
          <div />
          {columns.map((c) => (
            <div
              key={c.key}
              style={{
                background: c.isCurrent ? theme.themeBand : "transparent",
                borderTopLeftRadius: 10,
                borderTopRightRadius: 10,
                padding: "0 12px 10px",
                display: "flex",
                alignItems: "baseline",
                gap: 7,
                fontFamily: fonts.mono,
                fontSize: type.columnHeader + 2,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: theme.ink,
              }}
            >
              {c.label}
              {c.isCurrent && (
                <span style={{ color: theme.accentSoft, fontSize: type.control }}>
                  Current
                </span>
              )}
            </div>
          ))}

          {/* Metric rows */}
          {METRIC_ROWS.map((row) => {
            const max = Math.max(1, ...columns.map((c) => c.metrics[row.field]));
            return (
              <Fragment key={row.field}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px 0 2px",
                    borderTop: `1px solid ${theme.ruleSoft}`,
                    fontFamily: fonts.body,
                    fontSize: type.outcome + 5,
                    color: theme.ink,
                  }}
                >
                  {row.label}
                </div>
                {columns.map((c) => {
                  const value = c.metrics[row.field];
                  const pct =
                    row.field === "committedDelivered" && c.metrics.committed > 0
                      ? Math.round((value / c.metrics.committed) * 100)
                      : null;
                  return (
                    <div
                      key={c.key}
                      data-spot=""
                      style={{
                        background: c.isCurrent ? theme.themeBand : "transparent",
                        borderTop: `1px solid ${theme.ruleSoft}`,
                        padding: "0 14px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 9,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "baseline", gap: 7 }}
                      >
                        <EditableText
                          value={String(value)}
                          onCommit={(t) =>
                            props.onEditMetric(c.key, row.field, t)
                          }
                          ariaLabel={`${row.label} ${c.label}`}
                          style={{
                            fontFamily: fonts.display,
                            fontSize: 58,
                            fontWeight: 700,
                            lineHeight: 1,
                            color: value === 0 ? theme.inkSoft : theme.ink,
                          }}
                        />
                        {pct !== null && (
                          <span
                            style={{
                              fontFamily: fonts.mono,
                              fontSize: type.control + 2,
                              color: theme.inkSoft,
                            }}
                          >
                            {pct}%
                          </span>
                        )}
                      </div>
                      <div
                        aria-hidden
                        style={{
                          height: 6,
                          borderRadius: 3,
                          background: theme.inkFaint,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${(value / max) * 100}%`,
                            height: "100%",
                            background: rowColour[row.field],
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>

        {/* Delivery highlights for the selected quarter */}
        <section
          data-spot=""
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRadius: slide.radius,
            border: `1px solid ${theme.ruleSoft}`,
            background: theme.themeBand,
            padding: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontFamily: fonts.display,
                fontSize: type.outcome + 2,
                fontWeight: 600,
                color: theme.ink,
              }}
            >
              Delivery highlights
            </span>
            <button
              className="dep-add"
              title="Add highlight"
              onClick={props.onAddHighlight}
            >
              +
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {props.highlights.map((h) => (
              <div
                key={h.id}
                className="dep-row dlv-card"
                data-spot=""
                style={{
                  flex: "0 0 auto",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 5,
                  background: theme.paper,
                  border: `1px solid ${theme.ruleSoft}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <TeamPicker
                  value={h.team}
                  onChange={(t) => props.onEditHighlight(h.id, "team", t)}
                  ariaLabel="Delivering team"
                  triggerClassName="dlv-team"
                  triggerStyle={{ color: theme.accentSoft }}
                />
                <EditableText
                  value={h.text}
                  onCommit={(t) => props.onEditHighlight(h.id, "text", t)}
                  ariaLabel="Delivery highlight"
                  className="dep-row__text"
                  style={{ lineHeight: 1.4, fontSize: type.feature + 5 }}
                />
                <div className="dep-row__controls">
                  <button
                    className="dep-btn"
                    title="Remove"
                    onClick={() => props.onRemoveHighlight(h.id)}
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
