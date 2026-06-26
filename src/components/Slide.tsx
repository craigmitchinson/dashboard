import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Roadmap, Level, RefLevel, MetaField, Org, OrgField } from "../types";
import { LEVELS, COLUMN_HEADINGS } from "../types";
import { buildLayout } from "../layout";
import type { CellPath } from "../layout";
import { EditableCell } from "./EditableCell";
import { EditableText } from "./EditableText";
import { OrgIdentity } from "./OrgIdentity";
import { QuarterPicker } from "./QuarterPicker";
import type { Quarter } from "../quarters";
import { fonts, slide, type } from "../theme";
import { useTheme } from "../theme-context";

// How full the slide is. Rows size to their content (so multi-line cells expand
// vertically), and the body has a fixed height equal to the space left on the
// fixed canvas. `over` is the grid's natural height minus that available height:
// negative means there is room to spare, around zero means it is nearly full,
// positive means content no longer fits and is being clipped at the edge.
export interface Capacity {
  state: "ok" | "close" | "exceeded";
  /** Number of rows pushed off the bottom of the slide. */
  clipped: number;
  /** Natural content height minus available height, in pixels. */
  over: number;
}

// A couple of pixels is rounding; within CLOSE_GAP of full is "close".
const OVER_TOL = 2;
const CLOSE_GAP = 28;

interface Props {
  roadmap: Roadmap;
  quarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  org: Org;
  onEditOrg: (field: OrgField, text: string) => void;
  onEdit: (path: CellPath, level: Level, text: string) => void;
  onEditRef: (path: CellPath, level: RefLevel, text: string) => void;
  onEditMeta: (field: MetaField, text: string) => void;
  onAddChild: (path: CellPath, level: Level) => void;
  onRemove: (path: CellPath, level: Level) => void;
  onMove: (path: CellPath, level: Level, dir: -1 | 1) => void;
  onCapacity?: (capacity: Capacity) => void;
}

const addLabels: Partial<Record<Level, string>> = {
  theme: "Add outcome",
  outcome: "Add epic",
  epic: "Add feature",
  feature: "Add value",
};

export function Slide({
  roadmap,
  quarter,
  onQuarterChange,
  org,
  onEditOrg,
  onEdit,
  onEditRef,
  onEditMeta,
  onAddChild,
  onRemove,
  onMove,
  onCapacity,
}: Props) {
  const layout = buildLayout(roadmap);
  const { meta } = roadmap;
  const theme = useTheme();
  const bodyRef = useRef<HTMLDivElement>(null);

  // After every layout change, measure how full the cells are and report it.
  // Rows size to content; this compares the grid's natural height to the fixed
  // canvas so we can warn before content runs off the slide.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !onCapacity) return;
    let raf = 0;
    let cancelled = false;

    const measure = () => {
      // Sum the resolved (content-sized) row tracks to get the height the grid
      // really wants. scrollHeight cannot be used here: it is floored at
      // clientHeight, so it never reveals spare room (negative overflow).
      const cs = getComputedStyle(el);
      const tracks = cs.gridTemplateRows
        .split(" ")
        .map(parseFloat)
        .filter((n) => !Number.isNaN(n));
      const gap = parseFloat(cs.rowGap) || 0;
      const natural =
        tracks.reduce((a, b) => a + b, 0) + Math.max(0, tracks.length - 1) * gap;
      const over = natural - el.clientHeight;

      let clipped = 0;
      if (over > OVER_TOL) {
        const fold = el.getBoundingClientRect().bottom;
        el.querySelectorAll<HTMLElement>('.cell[data-level="value"]').forEach(
          (c) => {
            if (c.getBoundingClientRect().bottom > fold + OVER_TOL) clipped += 1;
          },
        );
      }
      const state: Capacity["state"] =
        over > OVER_TOL ? "exceeded" : over > -CLOSE_GAP ? "close" : "ok";
      onCapacity({ state, clipped, over });
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!cancelled) measure();
      });
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    // Web fonts change text metrics; re-measure once they are ready.
    document.fonts?.ready.then(() => {
      if (!cancelled) schedule();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [roadmap, onCapacity]);

  // Named column lines so every level lands in its column by name, and the
  // header band can reuse the exact same template for pixel-perfect alignment.
  const columnsTemplate =
    LEVELS.map((l) => `[${l}] ${slide.columnWeights[l]}fr`).join(" ") + " [end]";

  const frameStyle: CSSProperties = {
    width: slide.width,
    height: slide.height,
    background: theme.paper,
    padding: slide.padding,
    // Hard guarantee: nothing ever escapes the fixed canvas in any direction.
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
      {/* Title strip. Every label here is inline-editable. */}
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
            <QuarterPicker quarter={quarter} onChange={onQuarterChange} />
          </div>
          <div
            style={{ display: "flex", alignItems: "flex-end", gap: 2 }}
          >
            <EditableText
              value={meta.title}
              onCommit={(t) => onEditMeta("title", t)}
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

        {/* Team block: each team has its own slide, so the team is named here. */}
        <OrgIdentity org={org} onEdit={onEditOrg} />
      </div>

      {/* Column-header band */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columnsTemplate,
          columnGap: slide.columnGap,
          borderTop: `2px solid ${theme.rule}`,
          borderBottom: `1px solid ${theme.ruleSoft}`,
          padding: "8px 0",
          marginBottom: slide.rowGap,
        }}
      >
        {LEVELS.map((level) => (
          <div key={level} style={{ gridColumn: level }}>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: type.columnHeader,
                fontWeight: 500,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: theme.ink,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 4,
                  borderRadius: 2,
                  background: theme.levelStyles[level].rail,
                  display: "inline-block",
                }}
              />
              {COLUMN_HEADINGS[level]}
            </div>
          </div>
        ))}
      </div>

      {/* Body grid: five columns, one row per leaf, parents span their leaves.
          Rows size to their content (min-content), so a cell with more than one
          line expands vertically to fit it and every parent re-aligns. The body
          has the fixed height left on the canvas and clips its overflow, so the
          slide never grows past 1920x1080; when content needs more room than the
          canvas allows the capacity warning fires (see the effect above). */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: columnsTemplate,
          gridTemplateRows: `repeat(${Math.max(1, layout.rowCount)}, min-content)`,
          alignContent: "start",
          columnGap: slide.columnGap,
          rowGap: slide.rowGap,
        }}
      >
        {layout.rowCount === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              fontFamily: fonts.body,
              fontSize: type.outcome,
              color: theme.inkSoft,
              padding: "28px 4px",
            }}
          >
            Nothing here for {`Q${quarter.q} '${String(quarter.year).slice(2)}`}{" "}
            yet. Use the "+ Theme" button above to start this quarter's roadmap.
          </div>
        )}
        {/* Alternating theme bands behind the cells, to track a theme across */}
        {layout.columns.theme.map((t) =>
          t.themeParity === 1 ? (
            <div
              key={`band-${t.key}`}
              aria-hidden
              style={{
                gridColumn: "1 / -1",
                gridRow: `${t.rowStart} / span ${t.rowSpan}`,
                background: theme.themeBand,
                borderRadius: slide.radius,
                margin: `${-slide.rowGap / 2}px ${-slide.columnGap / 2}px`,
              }}
            />
          ) : null,
        )}

        {LEVELS.map((level) =>
          layout.columns[level].map((cell) => (
            <EditableCell
              key={cell.key}
              cell={cell}
              onEdit={(text) => onEdit(cell.path, level, text)}
              onEditRef={
                level === "outcome" || level === "epic" || level === "feature"
                  ? (text) => onEditRef(cell.path, level, text)
                  : undefined
              }
              onAddChild={
                addLabels[level]
                  ? () => onAddChild(cell.path, level)
                  : undefined
              }
              onRemove={() => onRemove(cell.path, level)}
              onMove={(dir) => onMove(cell.path, level, dir)}
              addLabel={addLabels[level]}
            />
          )),
        )}
      </div>
    </div>
  );
}
