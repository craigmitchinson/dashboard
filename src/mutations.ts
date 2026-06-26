import type {
  Roadmap,
  Theme,
  Outcome,
  Epic,
  Feature,
  Value,
  Level,
  RefLevel,
  MetaField,
} from "./types";
import type { CellPath } from "./layout";

// Immutable edits to the roadmap tree, keyed by the located CellPath produced by
// the layout. Each returns a new Roadmap so React state updates cleanly. The
// render layer never mutates the tree directly.

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;

const newValue = (): Value => ({ id: uid("v"), text: "Value statement" });
const newFeature = (): Feature => ({
  id: uid("f"),
  text: "New feature",
  values: [newValue()],
});
const newEpic = (): Epic => ({ id: uid("e"), text: "New epic", features: [newFeature()] });
const newOutcome = (): Outcome => ({ id: uid("o"), text: "New outcome", epics: [newEpic()] });
export const newTheme = (): Theme => ({
  id: uid("t"),
  text: "New theme",
  outcomes: [newOutcome()],
});

const clone = (r: Roadmap): Roadmap => structuredClone(r);

const findTheme = (r: Roadmap, id: string) => r.themes.find((t) => t.id === id);
const findOutcome = (t: Theme, id?: string) => t.outcomes.find((o) => o.id === id);
const findEpic = (o: Outcome, id?: string) => o.epics.find((e) => e.id === id);

// --- Editing text ---------------------------------------------------------

export function editText(
  roadmap: Roadmap,
  path: CellPath,
  level: Level,
  text: string,
): Roadmap {
  const r = clone(roadmap);
  const theme = findTheme(r, path.themeId);
  if (!theme) return roadmap;
  if (level === "theme") {
    theme.text = text;
    return r;
  }
  const outcome = findOutcome(theme, path.outcomeId);
  if (!outcome) return roadmap;
  if (level === "outcome") {
    outcome.text = text;
    return r;
  }
  const epic = findEpic(outcome, path.epicId);
  if (!epic) return roadmap;
  if (level === "epic") {
    epic.text = text;
    return r;
  }
  const feature = epic.features.find((f) => f.id === path.featureId);
  if (!feature) return roadmap;
  if (level === "feature") {
    feature.text = text;
    return r;
  }
  const value = feature.values.find((v) => v.id === path.valueId);
  if (value && level === "value") value.text = text;
  return r;
}

// --- Adding a child to the node at path -----------------------------------

export function addChild(roadmap: Roadmap, path: CellPath, level: Level): Roadmap {
  const r = clone(roadmap);
  const theme = findTheme(r, path.themeId);
  if (!theme) return roadmap;
  if (level === "theme") {
    theme.outcomes.push(newOutcome());
    return r;
  }
  const outcome = findOutcome(theme, path.outcomeId);
  if (!outcome) return roadmap;
  if (level === "outcome") {
    outcome.epics.push(newEpic());
    return r;
  }
  const epic = findEpic(outcome, path.epicId);
  if (!epic) return roadmap;
  if (level === "epic") {
    epic.features.push(newFeature());
    return r;
  }
  const feature = epic.features.find((f) => f.id === path.featureId);
  if (!feature) return roadmap;
  if (level === "feature") {
    feature.values.push(newValue());
    return r;
  }
  return roadmap; // a value has no child to add
}

// --- Removing the node at path --------------------------------------------

export function removeNode(roadmap: Roadmap, path: CellPath, level: Level): Roadmap {
  const r = clone(roadmap);
  if (level === "theme") {
    r.themes = r.themes.filter((t) => t.id !== path.themeId);
    return r;
  }
  const theme = findTheme(r, path.themeId);
  if (!theme) return roadmap;
  if (level === "outcome") {
    theme.outcomes = theme.outcomes.filter((o) => o.id !== path.outcomeId);
    return r;
  }
  const outcome = findOutcome(theme, path.outcomeId);
  if (!outcome) return roadmap;
  if (level === "epic") {
    outcome.epics = outcome.epics.filter((e) => e.id !== path.epicId);
    return r;
  }
  const epic = findEpic(outcome, path.epicId);
  if (!epic) return roadmap;
  if (level === "feature") {
    epic.features = epic.features.filter((f) => f.id !== path.featureId);
    return r;
  }
  const feature = epic.features.find((f) => f.id === path.featureId);
  if (!feature) return roadmap;
  if (level === "value") {
    feature.values = feature.values.filter((v) => v.id !== path.valueId);
    return r;
  }
  return roadmap;
}

export function addTheme(roadmap: Roadmap): Roadmap {
  const r = clone(roadmap);
  r.themes.push(newTheme());
  return r;
}

// Carry a quarter's scaffolding forward: copy themes, outcomes and epics (with
// their refs) under fresh ids, leaving features and values empty for the new
// quarter to populate.
export function cloneStructure(src: Roadmap): Roadmap {
  return {
    meta: { title: src.meta.title },
    themes: src.themes.map((t) => ({
      id: uid("t"),
      text: t.text,
      outcomes: t.outcomes.map((o) => ({
        id: uid("o"),
        text: o.text,
        ref: o.ref,
        epics: o.epics.map((e) => ({
          id: uid("e"),
          text: e.text,
          ref: e.ref,
          features: [],
        })),
      })),
    })),
  };
}

// --- Editing the Jira reference (outcome, epic, feature) ------------------

export function editRef(
  roadmap: Roadmap,
  path: CellPath,
  level: RefLevel,
  text: string,
): Roadmap {
  const r = clone(roadmap);
  const theme = findTheme(r, path.themeId);
  if (!theme) return roadmap;
  const outcome = findOutcome(theme, path.outcomeId);
  if (!outcome) return roadmap;
  const ref = text.trim() || undefined;
  if (level === "outcome") {
    outcome.ref = ref;
    return r;
  }
  const epic = findEpic(outcome, path.epicId);
  if (!epic) return roadmap;
  if (level === "epic") {
    epic.ref = ref;
    return r;
  }
  const feature = epic.features.find((f) => f.id === path.featureId);
  if (!feature) return roadmap;
  feature.ref = ref;
  return r;
}

// --- Reordering a node among its siblings ---------------------------------

const swap = <T>(arr: T[], i: number, dir: -1 | 1): boolean => {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
};

export function moveNode(
  roadmap: Roadmap,
  path: CellPath,
  level: Level,
  dir: -1 | 1,
): Roadmap {
  const r = clone(roadmap);
  if (level === "theme") {
    return swap(r.themes, r.themes.findIndex((t) => t.id === path.themeId), dir)
      ? r
      : roadmap;
  }
  const theme = findTheme(r, path.themeId);
  if (!theme) return roadmap;
  if (level === "outcome") {
    return swap(theme.outcomes, theme.outcomes.findIndex((o) => o.id === path.outcomeId), dir)
      ? r
      : roadmap;
  }
  const outcome = findOutcome(theme, path.outcomeId);
  if (!outcome) return roadmap;
  if (level === "epic") {
    return swap(outcome.epics, outcome.epics.findIndex((e) => e.id === path.epicId), dir)
      ? r
      : roadmap;
  }
  const epic = findEpic(outcome, path.epicId);
  if (!epic) return roadmap;
  if (level === "feature") {
    return swap(epic.features, epic.features.findIndex((f) => f.id === path.featureId), dir)
      ? r
      : roadmap;
  }
  const feature = epic.features.find((f) => f.id === path.featureId);
  if (!feature) return roadmap;
  return swap(feature.values, feature.values.findIndex((v) => v.id === path.valueId), dir)
    ? r
    : roadmap;
}

// --- Editing the slide chrome (kicker, title, team) -----------------------

export function editMeta(
  roadmap: Roadmap,
  field: MetaField,
  text: string,
): Roadmap {
  return { ...roadmap, meta: { ...roadmap.meta, [field]: text } };
}
