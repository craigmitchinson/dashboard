import type { Roadmap, Level } from "./types";

// ---------------------------------------------------------------------------
// Alignment logic
// ---------------------------------------------------------------------------
//
// The slide is one CSS grid: five columns wide, and as many rows tall as there
// are leaves (Values) in the whole tree. The leaf is the base unit of height.
// Every node is placed into that grid spanning a number of rows equal to the
// count of leaves beneath it, so a parent is always exactly as tall as the
// combined height of its descendants and sits centred against them. A Feature
// is itself a parent now: it spans its one or more Values.
//
// Nothing here is hard-positioned: change the data and the row spans recompute,
// re-flowing and re-aligning the entire slide.
//
// A node with no children still occupies one row so it stays visible and
// editable (e.g. an epic you have just added but not yet filled with features).

/** A located identifier so the editor can find and mutate the exact node. */
export interface CellPath {
  themeId: string;
  outcomeId?: string;
  epicId?: string;
  featureId?: string;
  valueId?: string;
}

export interface Cell {
  /** Unique key for React + a stable target for editing. */
  key: string;
  level: Level;
  text: string;
  /** Jira reference, for the levels that carry one (outcome, epic, feature). */
  ref?: string;
  /** 1-based row within the body grid. */
  rowStart: number;
  /** Number of leaf rows this node spans. */
  rowSpan: number;
  path: CellPath;
  /** Position among its siblings (0-based) and the sibling count. */
  index: number;
  siblingCount: number;
  /** True when this node has no children (an empty placeholder), so it can be
   *  dulled to keep the populated content prominent. Leaf Values are never
   *  empty. */
  isEmpty: boolean;
  /**
   * Group parity for the optional alternating theme band. Only meaningful at the
   * theme level; carried down so descendants can match their theme's band.
   */
  themeParity: 0 | 1;
}

export interface SlideLayout {
  rowCount: number;
  columns: Record<Level, Cell[]>;
}

const leafCount = (n: number): number => Math.max(1, n);

export function buildLayout(roadmap: Roadmap): SlideLayout {
  const columns: Record<Level, Cell[]> = {
    theme: [],
    outcome: [],
    epic: [],
    feature: [],
    value: [],
  };

  let cursor = 1; // current grid row (1-based)

  roadmap.themes.forEach((theme, themeIndex) => {
    const themeParity = (themeIndex % 2) as 0 | 1;
    const themeStart = cursor;

    theme.outcomes.forEach((outcome, outcomeIndex) => {
      const outcomeStart = cursor;

      outcome.epics.forEach((epic, epicIndex) => {
        const epicStart = cursor;

        epic.features.forEach((feature, featureIndex) => {
          const featureStart = cursor;

          feature.values.forEach((value, valueIndex) => {
            // A Value is one leaf row, level with its slot in the feature.
            columns.value.push({
              key: `value-${value.id}`,
              level: "value",
              text: value.text,
              rowStart: cursor,
              rowSpan: 1,
              path: {
                themeId: theme.id,
                outcomeId: outcome.id,
                epicId: epic.id,
                featureId: feature.id,
                valueId: value.id,
              },
              index: valueIndex,
              siblingCount: feature.values.length,
              themeParity,
              isEmpty: false,
            });
            cursor += 1;
          });

          // Feature with no values still claims a row.
          const featureSpan = leafCount(cursor - featureStart);
          if (feature.values.length === 0) cursor += 1;
          columns.feature.push({
            key: `feature-${feature.id}`,
            level: "feature",
            text: feature.text,
            ref: feature.ref,
            rowStart: featureStart,
            rowSpan: featureSpan,
            path: {
              themeId: theme.id,
              outcomeId: outcome.id,
              epicId: epic.id,
              featureId: feature.id,
            },
            index: featureIndex,
            siblingCount: epic.features.length,
            themeParity,
            isEmpty: feature.values.length === 0,
          });
        });

        // Epic with no features still claims a row.
        const epicSpan = leafCount(cursor - epicStart);
        if (epic.features.length === 0) cursor += 1;
        columns.epic.push({
          key: `epic-${epic.id}`,
          level: "epic",
          text: epic.text,
          ref: epic.ref,
          rowStart: epicStart,
          rowSpan: epicSpan,
          path: { themeId: theme.id, outcomeId: outcome.id, epicId: epic.id },
          index: epicIndex,
          siblingCount: outcome.epics.length,
          themeParity,
          isEmpty: epic.features.length === 0,
        });
      });

      const outcomeSpan = leafCount(cursor - outcomeStart);
      if (outcome.epics.length === 0) cursor += 1;
      columns.outcome.push({
        key: `outcome-${outcome.id}`,
        level: "outcome",
        text: outcome.text,
        ref: outcome.ref,
        rowStart: outcomeStart,
        rowSpan: outcomeSpan,
        path: { themeId: theme.id, outcomeId: outcome.id },
        index: outcomeIndex,
        siblingCount: theme.outcomes.length,
        themeParity,
        isEmpty: outcome.epics.length === 0,
      });
    });

    const themeSpan = leafCount(cursor - themeStart);
    if (theme.outcomes.length === 0) cursor += 1;
    columns.theme.push({
      key: `theme-${theme.id}`,
      level: "theme",
      text: theme.text,
      rowStart: themeStart,
      rowSpan: themeSpan,
      path: { themeId: theme.id },
      index: themeIndex,
      siblingCount: roadmap.themes.length,
      themeParity,
      isEmpty: theme.outcomes.length === 0,
    });
  });

  return { rowCount: cursor - 1, columns };
}
