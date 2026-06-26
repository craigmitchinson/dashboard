import type { CSSProperties } from "react";
import type { Cell } from "../layout";
import type { RefLevel } from "../types";
import { slide, type, fonts } from "../theme";
import { useTheme } from "../theme-context";
import { EditableText } from "./EditableText";

interface Props {
  cell: Cell;
  onEdit: (text: string) => void;
  onEditRef?: (text: string) => void;
  onAddChild?: () => void;
  onRemove?: () => void;
  onMove?: (dir: -1 | 1) => void;
  addLabel?: string;
}

const fontSize: Record<Cell["level"], number> = {
  theme: type.theme,
  outcome: type.outcome,
  epic: type.epic,
  feature: type.feature,
  value: type.value,
};

const REF_LEVELS: RefLevel[] = ["outcome", "epic", "feature"];

// A single grid cell: a tinted box whose thick left rail brackets the full
// height of its children, with inline-editable text and hover-only controls.
export function EditableCell({
  cell,
  onEdit,
  onEditRef,
  onAddChild,
  onRemove,
  onMove,
  addLabel,
}: Props) {
  const theme = useTheme();
  const style = theme.levelStyles[cell.level];
  const isTheme = cell.level === "theme";
  const hasRef = REF_LEVELS.includes(cell.level as RefLevel);
  const canUp = cell.index > 0;
  const canDown = cell.index < cell.siblingCount - 1;

  const boxStyle: CSSProperties = {
    gridColumn: cell.level,
    gridRow: `${cell.rowStart} / span ${cell.rowSpan}`,
    background: style.surface,
    color: style.text,
    borderLeft: `4px solid ${style.rail}`,
    borderRadius: slide.radius,
    // Theme uses the largest font, so it gets the least vertical padding to keep
    // a single-row theme comfortable at full density.
    padding: isTheme ? "5px 14px" : "6px 12px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    fontFamily: isTheme ? fonts.display : fonts.body,
    fontSize: fontSize[cell.level],
    fontWeight: isTheme ? 600 : 400,
    lineHeight: 1.2,
  };

  return (
    <div
      className={`cell${isTheme ? " cell--dark" : ""}${
        cell.isEmpty ? " cell--empty" : ""
      }`}
      style={boxStyle}
      data-level={cell.level}
      data-spot=""
    >
      {hasRef && onEditRef ? (
        // The Jira ref sits inline before the title, always visible (every
        // outcome, epic and feature carries one). Inline keeps it on the same
        // line as the title, so showing it costs no vertical space and the
        // layout never shifts.
        <div className="cell__line">
          <EditableText
            value={cell.ref ?? ""}
            onCommit={onEditRef}
            placeholder="Ref"
            className="cell__ref"
            ariaLabel={`${cell.level} reference`}
          />
          <EditableText
            value={cell.text}
            onCommit={onEdit}
            className="cell__title"
            ariaLabel={`${cell.level} text`}
          />
        </div>
      ) : (
        <EditableText
          value={cell.text}
          onCommit={onEdit}
          ariaLabel={`${cell.level} text`}
        />
      )}

      {(onAddChild || onRemove || onMove) && (
        <div className="cell__controls">
          {onMove && (
            <>
              <button
                className="cell__btn"
                title="Move up"
                disabled={!canUp}
                onClick={() => onMove(-1)}
              >
                &uarr;
              </button>
              <button
                className="cell__btn"
                title="Move down"
                disabled={!canDown}
                onClick={() => onMove(1)}
              >
                &darr;
              </button>
            </>
          )}
          {onAddChild && (
            <button
              className="cell__btn"
              title={addLabel ?? "Add"}
              onClick={onAddChild}
            >
              +
            </button>
          )}
          {onRemove && (
            <button className="cell__btn" title="Remove" onClick={onRemove}>
              &times;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
