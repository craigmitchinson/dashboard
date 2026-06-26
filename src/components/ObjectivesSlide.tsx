import type { CSSProperties } from "react";
import type {
  ObjectivesBoard,
  Objective,
  RagStatus,
  KrField,
  DepStatus,
  Org,
  OrgField,
} from "../types";
import { RAG_LABELS } from "../types";
import { fonts, slide, type } from "../theme";
import { useTheme } from "../theme-context";
import { EditableText } from "./EditableText";
import { OrgIdentity } from "./OrgIdentity";
import { QuarterPicker } from "./QuarterPicker";
import type { Quarter } from "../quarters";

interface Props {
  quarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  org: Org;
  onEditOrg: (field: OrgField, text: string) => void;
  board: ObjectivesBoard;
  onEditTitle: (text: string) => void;
  onAddObjective: () => void;
  onEditObjective: (id: string, text: string) => void;
  onCycleObjectiveStatus: (id: string) => void;
  onRemoveObjective: (id: string) => void;
  onAddKr: (objectiveId: string) => void;
  onEditKr: (objectiveId: string, krId: string, field: KrField, text: string) => void;
  onCycleKrStatus: (objectiveId: string, krId: string) => void;
  onRemoveKr: (objectiveId: string, krId: string) => void;
}

// RAG maps onto the existing status palette: on track = committed (teal),
// at risk = not committed (purple), off track = blocked (red).
export const RAG_TO_STATUS: Record<RagStatus, DepStatus> = {
  "on-track": "committed",
  "at-risk": "not-committed",
  "off-track": "blocked",
};

export function ObjectivesSlide(props: Props) {
  const theme = useTheme();
  const { board } = props;

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
            <EditableText
              value={board.title}
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

      {/* Objective cards */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderTop: `2px solid ${theme.rule}`,
          paddingTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridAutoRows: "1fr",
          gap: 14,
          overflow: "hidden",
        }}
      >
        {board.objectives.map((o) => (
          <ObjectiveCard key={o.id} objective={o} {...props} />
        ))}
      </div>
    </div>
  );
}

function ObjectiveCard({
  objective: o,
  onEditObjective,
  onCycleObjectiveStatus,
  onRemoveObjective,
  onAddKr,
  onEditKr,
  onCycleKrStatus,
  onRemoveKr,
}: Props & { objective: Objective }) {
  const theme = useTheme();
  const st = theme.status[RAG_TO_STATUS[o.status]];
  return (
    <section
      className="obj-card"
      data-spot=""
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: slide.radius,
        border: `1px solid ${theme.ruleSoft}`,
        borderLeft: `5px solid ${st.rail}`,
        padding: "16px 18px",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <button
          className="rag-dot"
          title={`${RAG_LABELS[o.status]} (click to change)`}
          onClick={() => onCycleObjectiveStatus(o.id)}
          style={{ background: st.dot, marginTop: 8 }}
        />
        <EditableText
          value={o.text}
          onCommit={(t) => onEditObjective(o.id, t)}
          ariaLabel="Objective"
          className="dep-row__text"
          style={{
            fontFamily: fonts.display,
            fontSize: type.outcome + 7,
            fontWeight: 600,
            lineHeight: 1.2,
            color: theme.ink,
          }}
        />
        <span
          style={{
            flex: "0 0 auto",
            fontFamily: fonts.mono,
            fontSize: type.control,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: st.dot,
            marginTop: 5,
          }}
        >
          {RAG_LABELS[o.status]}
        </span>
        <div className="obj-card__controls">
          <button
            className="dep-btn"
            title="Remove objective"
            onClick={() => onRemoveObjective(o.id)}
          >
            &times;
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflow: "hidden",
        }}
      >
        {o.keyResults.map((k) => {
          const kst = theme.status[RAG_TO_STATUS[k.status]];
          return (
            <div
              key={k.id}
              className="dep-row"
              data-spot=""
              style={{
                background: kst.surface,
                borderLeft: `3px solid ${kst.rail}`,
                borderRadius: 8,
                padding: "9px 10px 9px 11px",
                gap: 9,
              }}
            >
              <button
                className="rag-dot"
                title={`${RAG_LABELS[k.status]} (click to change)`}
                onClick={() => onCycleKrStatus(o.id, k.id)}
                style={{ background: kst.dot, flex: "0 0 auto" }}
              />
              <EditableText
                value={k.text}
                onCommit={(t) => onEditKr(o.id, k.id, "text", t)}
                ariaLabel="Key result"
                className="dep-row__text"
                style={{ fontSize: type.feature + 4 }}
              />
              <EditableText
                value={k.metric}
                onCommit={(t) => onEditKr(o.id, k.id, "metric", t)}
                ariaLabel="Key result metric"
                className="obj-metric"
                style={{ color: theme.inkSoft }}
              />
              <div className="dep-row__controls">
                <button
                  className="dep-btn"
                  title="Remove key result"
                  onClick={() => onRemoveKr(o.id, k.id)}
                >
                  &times;
                </button>
              </div>
            </div>
          );
        })}
        <button
          className="dep-add"
          title="Add key result"
          onClick={() => onAddKr(o.id)}
          style={{ alignSelf: "flex-start", marginTop: 1 }}
        >
          +
        </button>
      </div>
    </section>
  );
}
