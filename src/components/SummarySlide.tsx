import type { CSSProperties, ReactNode } from "react";
import type {
  SummaryBoard,
  SummaryField,
  AskField,
  RagStatus,
  DerivedStory,
  Org,
  OrgField,
} from "../types";
import { RAG_STATUSES } from "../types";
import { fonts, slide, type } from "../theme";
import { useTheme } from "../theme-context";
import { EditableText } from "./EditableText";
import { OrgIdentity } from "./OrgIdentity";
import { QuarterPicker } from "./QuarterPicker";
import { TeamPicker } from "./TeamPicker";
import { RAG_TO_STATUS } from "./ObjectivesSlide";
import type { Quarter } from "../quarters";

export interface SummaryStats {
  objectives: Record<RagStatus, number>;
  objectivesTotal: number;
  delivery: { committed: number; committedDelivered: number; predictability: number };
  deps: { total: number; blocked: number; escalations: number; highRisks: number };
}

interface Props {
  quarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  org: Org;
  onEditOrg: (field: OrgField, text: string) => void;
  board: SummaryBoard;
  stats: SummaryStats;
  derived: DerivedStory;
  onEditField: (field: SummaryField, text: string) => void;
  onAddAsk: () => void;
  onEditAsk: (id: string, field: AskField, text: string) => void;
  onRemoveAsk: (id: string) => void;
}

export function SummarySlide(props: Props) {
  const theme = useTheme();
  const { board, stats } = props;

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

  const pct = stats.delivery.predictability;
  const pctColour =
    pct >= 80
      ? theme.status.committed.dot
      : pct >= 60
        ? theme.status["not-committed"].dot
        : theme.status.blocked.dot;
  const blockedColour =
    stats.deps.blocked > 0 ? theme.status.blocked.dot : theme.status.committed.dot;
  const riskColour =
    stats.deps.highRisks > 0 ? theme.status.blocked.dot : theme.status.committed.dot;

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
              onCommit={(t) => props.onEditField("title", t)}
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

      {/* Derived headline stats */}
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
        <StatCard label="Objectives" accent={theme.ink} big={stats.objectivesTotal}>
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
            {RAG_STATUSES.map((r) => (
              <span
                key={r}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: fonts.mono,
                  fontSize: type.control + 2,
                  color: theme.inkSoft,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: theme.status[RAG_TO_STATUS[r]].dot,
                  }}
                />
                {stats.objectives[r]}
              </span>
            ))}
          </div>
        </StatCard>

        <StatCard
          label="Predictability"
          accent={pctColour}
          big={`${pct}%`}
          sub={`${stats.delivery.committedDelivered} of ${stats.delivery.committed} committed delivered`}
        />
        <StatCard
          label="Blocked dependencies"
          accent={blockedColour}
          big={stats.deps.blocked}
          sub={`of ${stats.deps.total} · ${stats.deps.escalations} escalations`}
        />
        <StatCard
          label="High risks"
          accent={riskColour}
          big={stats.deps.highRisks}
          sub="open this quarter"
        />
      </div>

      {/* Story + decisions */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 18,
        }}
      >
        <section
          data-spot=""
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRadius: slide.radius,
            border: `1px solid ${theme.ruleSoft}`,
            background: theme.themeBand,
            padding: 18,
            overflow: "hidden",
          }}
        >
          {/* Headline TL;DR */}
          <EditableText
            value={board.headline}
            onCommit={(t) => props.onEditField("headline", t)}
            ariaLabel="Headline"
            style={{
              fontFamily: fonts.display,
              fontSize: 28,
              lineHeight: 1.35,
              fontWeight: 600,
              color: theme.ink,
              marginBottom: 16,
            }}
          />
          {/* Split into highlights / watch-outs / next focus */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16,
            }}
          >
            <StorySection
              icon="▲"
              iconColour={theme.status.committed.dot}
              label="Highlights"
              items={props.derived.highlights}
            />
            <StorySection
              icon="⚠"
              iconColour={theme.status["not-committed"].dot}
              label="Watch-outs"
              items={props.derived.watchouts}
            />
            <StorySection
              icon="→"
              iconColour={theme.accentSoft}
              label="Next quarter focus"
              items={props.derived.focus}
            />
          </div>
        </section>

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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontFamily: fonts.display,
                fontSize: type.outcome + 6,
                fontWeight: 600,
                color: theme.ink,
              }}
            >
              Decisions needed
            </span>
            <button className="dep-add" title="Add decision" onClick={props.onAddAsk}>
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
            {board.asks.map((a) => (
              <div
                key={a.id}
                className="dep-row"
                data-spot=""
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 4,
                  borderLeft: `3px solid ${theme.accentSoft}`,
                  background: theme.status.blocked.surface,
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <TeamPicker
                  value={a.owner}
                  onChange={(t) => props.onEditAsk(a.id, "owner", t)}
                  ariaLabel="Decision owner"
                  triggerClassName="dlv-team"
                  triggerStyle={{ color: theme.accentSoft }}
                />
                <EditableText
                  value={a.text}
                  onCommit={(t) => props.onEditAsk(a.id, "text", t)}
                  ariaLabel="Decision"
                  className="dep-row__text"
                  style={{ lineHeight: 1.4, fontSize: type.feature + 5 }}
                />
                <div className="dep-row__controls">
                  <button
                    className="dep-btn"
                    title="Remove"
                    onClick={() => props.onRemoveAsk(a.id)}
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

function StatCard({
  label,
  accent,
  big,
  sub,
  children,
}: {
  label: string;
  accent: string;
  big: string | number;
  sub?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div
      data-spot=""
      style={{
        background: theme.themeBand,
        borderLeft: `5px solid ${accent}`,
        borderRadius: slide.radius,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <span
        style={{
          fontFamily: fonts.display,
          fontSize: 54,
          fontWeight: 700,
          lineHeight: 1,
          color: accent,
        }}
      >
        {big}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: type.columnHeader,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: theme.inkSoft,
        }}
      >
        {label}
      </span>
      {sub && (
        <span style={{ fontFamily: fonts.body, fontSize: type.control + 2, color: theme.inkSoft }}>
          {sub}
        </span>
      )}
      {children}
    </div>
  );
}

// A derived, read-only column: items are pulled from the other tabs.
function StorySection({
  icon,
  iconColour,
  label,
  items,
}: {
  icon: string;
  iconColour: string;
  label: string;
  items: string[];
}) {
  const theme = useTheme();
  return (
    <div data-spot="" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 10,
          fontFamily: fonts.mono,
          fontSize: type.columnHeader - 1,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: theme.inkSoft,
        }}
      >
        <span aria-hidden style={{ color: iconColour, fontSize: type.control }}>
          {icon}
        </span>
        {label}
      </div>
      {items.length === 0 ? (
        <span
          style={{
            fontFamily: fonts.body,
            fontSize: type.feature + 1,
            color: theme.inkSoft,
            opacity: 0.7,
            fontStyle: "italic",
          }}
        >
          Nothing yet
        </span>
      ) : (
        <ul
          style={{
            margin: 0,
            paddingLeft: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {items.map((it, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 8,
                fontFamily: fonts.body,
                fontSize: type.feature + 2,
                lineHeight: 1.35,
                color: theme.ink,
              }}
            >
              <span
                aria-hidden
                style={{ color: iconColour, flex: "0 0 auto", marginTop: 1 }}
              >
                &#8226;
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
