import type { CSSProperties } from "react";
import type {
  DependenciesBoard,
  Dependency,
  DepStatus,
  DepOrigin,
  Risk,
  Horizon,
  BoardField,
  Org,
  OrgField,
} from "../types";
import {
  DEP_STATUSES,
  DEP_STATUS_LABELS,
  DEP_ORIGIN_LABELS,
  RISK_SEVERITY_LABELS,
} from "../types";
import { fonts, slide, type } from "../theme";
import { useTheme } from "../theme-context";
import { byStatus } from "../mutations-deps";
import { EditableText } from "./EditableText";
import { OrgIdentity } from "./OrgIdentity";
import { QuarterPicker } from "./QuarterPicker";
import type { Quarter } from "../quarters";
import { currentHorizonTitle, nextHorizonTitle } from "../quarters";

interface Props {
  board: DependenciesBoard;
  quarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  org: Org;
  onEditOrg: (field: OrgField, text: string) => void;
  onEditField: (field: BoardField, text: string) => void;
  onAddDep: (horizon: Horizon, status: DepStatus) => void;
  onEditDep: (horizon: Horizon, id: string, text: string) => void;
  onCycleStatus: (horizon: Horizon, id: string) => void;
  onToggleOrigin: (horizon: Horizon, id: string) => void;
  onRemoveDep: (horizon: Horizon, id: string) => void;
  onAddEscalation: () => void;
  onEditEscalation: (id: string, text: string) => void;
  onRemoveEscalation: (id: string) => void;
  onAddRisk: () => void;
  onEditRisk: (id: string, text: string) => void;
  onCycleSeverity: (id: string) => void;
  onRemoveRisk: (id: string) => void;
}

// Risk severity reuses the status palette: high = blocked red, medium = not
// committed purple, low = committed teal.
const SEVERITY_STATUS: Record<Risk["severity"], DepStatus> = {
  high: "blocked",
  medium: "not-committed",
  low: "committed",
};

export function DependenciesSlide(props: Props) {
  const { board } = props;
  const theme = useTheme();

  // Totals across both horizons, for the number cards.
  const all = [...board.current, ...board.next];
  const total = all.length;
  const counts = DEP_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: all.filter((d) => d.status === s).length }),
    {} as Record<(typeof DEP_STATUSES)[number], number>,
  );

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
            <QuarterPicker
              quarter={props.quarter}
              onChange={props.onQuarterChange}
            />
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
                color: theme.accent,
              }}
            >
              .
            </span>
          </div>
        </div>
        <OrgIdentity org={props.org} onEdit={props.onEditOrg} />
      </div>

      {/* Totals (number cards) + origin key */}
      <div style={{ borderTop: `2px solid ${theme.rule}`, paddingTop: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <StatCard label="Dependencies" count={total} accent={theme.ink} surface={theme.themeBand} />
          {DEP_STATUSES.map((s) => (
            <StatCard
              key={s}
              label={DEP_STATUS_LABELS[s]}
              count={counts[s]}
              accent={theme.status[s].dot}
              surface={theme.status[s].surface}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 8,
          }}
        >
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: type.control - 2,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: theme.inkSoft,
            }}
          >
            Key
          </span>
          <OriginBadge origin="incoming" />
          <OriginBadge origin="existing" />
        </div>
      </div>

      {/* Three panels */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 0.82fr",
          gap: 18,
        }}
      >
        <QuarterPanel horizon="current" {...props} />
        <QuarterPanel horizon="next" {...props} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
          }}
        >
          <EscalationsPanel {...props} />
          <RisksPanel {...props} />
        </div>
      </div>
    </div>
  );
}

// --- Totals number card ----------------------------------------------------

function StatCard({
  label,
  count,
  accent,
  surface,
}: {
  label: string;
  count: number;
  accent: string;
  surface: string;
}) {
  const theme = useTheme();
  return (
    <div
      data-spot=""
      style={{
        flex: 1,
        background: surface,
        borderLeft: `5px solid ${accent}`,
        borderRadius: slide.radius,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: fonts.display,
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1,
          color: accent,
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: type.columnHeader,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: theme.inkSoft,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// --- Quarter panel (current / next) ---------------------------------------

function QuarterPanel({
  horizon,
  board,
  quarter,
  onAddDep,
  onEditDep,
  onCycleStatus,
  onToggleOrigin,
  onRemoveDep,
}: Props & { horizon: Horizon }) {
  const theme = useTheme();
  const list = board[horizon];
  // Titles are derived from the selected quarter, not free text.
  const title =
    horizon === "current"
      ? currentHorizonTitle(quarter)
      : nextHorizonTitle(quarter);
  // Density: roomier rows when the panel is sparse, tighter when it is full.
  const n = list.length;
  const rowFont = n <= 4 ? 18 : n <= 7 ? 16.5 : n <= 10 ? 15 : 13.5;

  return (
    <section
      data-spot=""
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: slide.radius,
        border: `1px solid ${theme.ruleSoft}`,
        padding: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: type.outcome + 6,
          fontWeight: 600,
          color: theme.ink,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          // Spread the three status lanes to fill the panel height rather than
          // leaving dead space at the bottom.
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        {DEP_STATUSES.map((status) => (
          <Lane
            key={status}
            status={status}
            items={byStatus(list, status)}
            size={rowFont}
            onAdd={() => onAddDep(horizon, status)}
            onEdit={(id, t) => onEditDep(horizon, id, t)}
            onCycle={(id) => onCycleStatus(horizon, id)}
            onToggle={(id) => onToggleOrigin(horizon, id)}
            onRemove={(id) => onRemoveDep(horizon, id)}
          />
        ))}
      </div>
    </section>
  );
}

// --- A single status lane within a panel ----------------------------------

function Lane({
  status,
  items,
  size,
  onAdd,
  onEdit,
  onCycle,
  onToggle,
  onRemove,
}: {
  status: DepStatus;
  items: Dependency[];
  size: number;
  onAdd: () => void;
  onEdit: (id: string, text: string) => void;
  onCycle: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const theme = useTheme();
  const st = theme.status[status];
  return (
    <div className="dep-lane" data-spot="">
      <div className="dep-lane__head">
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: st.dot,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: type.control + 1,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: theme.inkSoft,
          }}
        >
          {DEP_STATUS_LABELS[status]}
        </span>
        <button className="dep-add" title="Add dependency" onClick={onAdd}>
          +
        </button>
      </div>
      {items.map((d) => (
        <DepRow
          key={d.id}
          dep={d}
          st={st}
          size={size}
          onEdit={(t) => onEdit(d.id, t)}
          onCycle={() => onCycle(d.id)}
          onToggle={() => onToggle(d.id)}
          onRemove={() => onRemove(d.id)}
        />
      ))}
    </div>
  );
}

// --- A single dependency row ----------------------------------------------

function DepRow({
  dep,
  st,
  size,
  onEdit,
  onCycle,
  onToggle,
  onRemove,
}: {
  dep: Dependency;
  st: { dot: string; rail: string; surface: string; text: string };
  size: number;
  onEdit: (text: string) => void;
  onCycle: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const padY = size >= 16 ? 10 : size >= 14 ? 8 : 6;
  return (
    <div
      className="dep-row"
      data-spot=""
      style={{
        background: st.surface,
        borderLeft: `3px solid ${st.rail}`,
        color: st.text,
        borderRadius: 8,
        padding: `${padY}px 8px ${padY}px 9px`,
        fontSize: size,
      }}
    >
      <OriginBadge origin={dep.origin} onClick={onToggle} />
      <EditableText
        value={dep.text}
        onCommit={onEdit}
        className="dep-row__text"
        ariaLabel="Dependency"
      />
      <div className="dep-row__controls">
        <button className="dep-btn" title="Change status" onClick={onCycle}>
          &#8645;
        </button>
        <button className="dep-btn" title="Remove" onClick={onRemove}>
          &times;
        </button>
      </div>
    </div>
  );
}

// --- Escalations panel -----------------------------------------------------

function EscalationsPanel({
  board,
  onAddEscalation,
  onEditEscalation,
  onRemoveEscalation,
}: Props) {
  const theme = useTheme();
  return (
    <section
      data-spot=""
      style={{
        flex: 1,
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
          Escalations
        </span>
        <button
          className="dep-add"
          title="Add escalation"
          onClick={onAddEscalation}
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
          gap: 9,
        }}
      >
        {board.escalations.map((e) => (
          <div key={e.id} className="dep-row" data-spot="" style={{ alignItems: "flex-start" }}>
            <span
              aria-hidden
              style={{ color: theme.accent, lineHeight: 1.3, marginTop: 1 }}
            >
              &#8226;
            </span>
            <EditableText
              value={e.text}
              onCommit={(t) => onEditEscalation(e.id, t)}
              className="dep-row__text"
              ariaLabel="Escalation"
              style={{ lineHeight: 1.35 }}
            />
            <div className="dep-row__controls">
              <button
                className="dep-btn"
                title="Remove"
                onClick={() => onRemoveEscalation(e.id)}
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Risks panel -----------------------------------------------------------

function RisksPanel({
  board,
  onAddRisk,
  onEditRisk,
  onCycleSeverity,
  onRemoveRisk,
}: Props) {
  const theme = useTheme();
  return (
    <section
      data-spot=""
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: slide.radius,
        border: `1px solid ${theme.ruleSoft}`,
        padding: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}
      >
        <span
          style={{
            fontFamily: fonts.display,
            fontSize: type.outcome + 2,
            fontWeight: 600,
            color: theme.ink,
          }}
        >
          Risks
        </span>
        <button className="dep-add" title="Add risk" onClick={onAddRisk}>
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
          gap: 7,
        }}
      >
        {board.risks.map((r) => {
          const st = theme.status[SEVERITY_STATUS[r.severity]];
          return (
            <div
              key={r.id}
              className="dep-row"
              data-spot=""
              style={{
                background: st.surface,
                borderLeft: `3px solid ${st.rail}`,
                color: st.text,
                borderRadius: 8,
                padding: "5px 8px 5px 9px",
                alignItems: "flex-start",
              }}
            >
              <button
                className="dep-sev"
                title="Change severity"
                onClick={() => onCycleSeverity(r.id)}
                style={{ color: st.dot }}
              >
                {RISK_SEVERITY_LABELS[r.severity]}
              </button>
              <EditableText
                value={r.text}
                onCommit={(t) => onEditRisk(r.id, t)}
                className="dep-row__text"
                ariaLabel="Risk"
                style={{ lineHeight: 1.35 }}
              />
              <div className="dep-row__controls">
                <button
                  className="dep-btn"
                  title="Remove"
                  onClick={() => onRemoveRisk(r.id)}
                >
                  &times;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- Origin badge (incoming / existing) -----------------------------------

function OriginBadge({
  origin,
  onClick,
}: {
  origin: DepOrigin;
  onClick?: () => void;
}) {
  const theme = useTheme();
  const incoming = origin === "incoming";
  const label = incoming ? "New" : "Carried";
  const glyph = incoming ? "&#8600;" : "&#8635;"; // arrow-in vs carried-over
  const style: CSSProperties = incoming
    ? { background: theme.status.committed.dot, color: theme.paper, border: "1px solid transparent" }
    : { background: "transparent", color: theme.inkSoft, border: `1px solid ${theme.inkFaint}` };
  return (
    <button
      type="button"
      className="dep-origin"
      title={`${DEP_ORIGIN_LABELS[origin]} (click to change)`}
      onClick={onClick}
      style={style}
    >
      <span dangerouslySetInnerHTML={{ __html: glyph }} />
      {label}
    </button>
  );
}
