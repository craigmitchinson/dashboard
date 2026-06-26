import type {
  Roadmap,
  DependenciesBoard,
  ObjectivesBoard,
  DeliveryBoard,
  DeliveryMetrics,
  DeliveryHighlight,
  SummaryBoard,
} from "./types";
import type { Quarter } from "./quarters";
import { quarterKey } from "./quarters";

// Content is stored per team AND per quarter, keyed "<team>#<year>-Q<n>".
export const ALL_TEAMS = "All teams";
export const teamKey = (team: string, q: Quarter): string =>
  `${team}#${quarterKey(q)}`;

// Prefix ids when aggregating so React keys stay unique across teams (the
// aggregate is read-only, so rewriting ids is harmless).
const px = (id: string, p: string) => `${p}~${id}`;

// Teams share the same tree, so the All-teams roadmap merges by name at every
// level (theme, outcome, epic, feature, value) and never duplicates: identical
// items from different teams collapse into one. A node keeps the first ref seen.
interface MergeNode {
  id: string;
  text: string;
  ref?: string;
  order: string[];
  children: Map<string, MergeNode>;
}

export function aggregateRoadmaps(
  map: Record<string, Roadmap>,
  teams: string[],
  q: Quarter,
): Roadmap {
  let n = 0;
  const root: MergeNode = { id: "", text: "", order: [], children: new Map() };
  const key = (s: string) => s.trim().toLowerCase();
  const merge = (
    parent: MergeNode,
    prefix: string,
    text: string,
    ref?: string,
  ): MergeNode => {
    const k = key(text);
    let node = parent.children.get(k);
    if (!node) {
      node = { id: `agg-${prefix}-${(n += 1)}`, text, ref, order: [], children: new Map() };
      parent.children.set(k, node);
      parent.order.push(k);
    } else if (!node.ref && ref) {
      node.ref = ref;
    }
    return node;
  };

  teams.forEach((t) => {
    const r = map[teamKey(t, q)];
    if (!r) return;
    r.themes.forEach((th) => {
      const tn = merge(root, "t", th.text);
      th.outcomes.forEach((o) => {
        const on = merge(tn, "o", o.text, o.ref);
        o.epics.forEach((e) => {
          const en = merge(on, "e", e.text, e.ref);
          e.features.forEach((f) => {
            const fn = merge(en, "f", f.text, f.ref);
            f.values.forEach((v) => merge(fn, "v", v.text));
          });
        });
      });
    });
  });

  const kids = (node: MergeNode) => node.order.map((k) => node.children.get(k)!);
  return {
    meta: { title: "All teams roadmap" },
    themes: kids(root).map((th) => ({
      id: th.id,
      text: th.text,
      outcomes: kids(th).map((o) => ({
        id: o.id,
        text: o.text,
        ref: o.ref,
        epics: kids(o).map((e) => ({
          id: e.id,
          text: e.text,
          ref: e.ref,
          features: kids(e).map((f) => ({
            id: f.id,
            text: f.text,
            ref: f.ref,
            values: kids(f).map((v) => ({ id: v.id, text: v.text })),
          })),
        })),
      })),
    })),
  };
}

export function aggregateBoards(
  map: Record<string, DependenciesBoard>,
  teams: string[],
  q: Quarter,
): DependenciesBoard {
  const out: DependenciesBoard = {
    title: "Cross-team dependencies",
    current: [],
    next: [],
    escalations: [],
    risks: [],
  };
  teams.forEach((t, i) => {
    const b = map[teamKey(t, q)];
    if (!b) return;
    const p = String(i);
    out.current.push(...b.current.map((d) => ({ ...d, id: px(d.id, p) })));
    out.next.push(...b.next.map((d) => ({ ...d, id: px(d.id, p) })));
    out.escalations.push(...b.escalations.map((e) => ({ ...e, id: px(e.id, p) })));
    out.risks.push(...b.risks.map((r) => ({ ...r, id: px(r.id, p) })));
  });
  return out;
}

export function aggregateObjectives(
  map: Record<string, ObjectivesBoard>,
  teams: string[],
  q: Quarter,
): ObjectivesBoard {
  const objectives = teams.flatMap((t, i) => {
    const o = map[teamKey(t, q)];
    if (!o) return [];
    const p = String(i);
    return o.objectives.map((ob) => ({
      id: px(ob.id, p),
      text: ob.text,
      status: ob.status,
      keyResults: ob.keyResults.map((k) => ({ ...k, id: px(k.id, p) })),
    }));
  });
  return { title: "All teams objectives", objectives };
}

export function aggregateMetrics(
  map: Record<string, DeliveryBoard>,
  teams: string[],
  qk: string,
): DeliveryMetrics {
  const m: DeliveryMetrics = {
    committed: 0,
    delivered: 0,
    committedDelivered: 0,
    throughput: 0,
  };
  teams.forEach((t) => {
    const d = map[`${t}#${qk}`];
    if (!d) return;
    m.committed += d.metrics.committed;
    m.delivered += d.metrics.delivered;
    m.committedDelivered += d.metrics.committedDelivered;
    m.throughput += d.metrics.throughput;
  });
  return m;
}

export function aggregateHighlights(
  map: Record<string, DeliveryBoard>,
  teams: string[],
  q: Quarter,
): DeliveryHighlight[] {
  return teams
    .flatMap((t, i) => {
      const d = map[teamKey(t, q)];
      if (!d) return [];
      return d.highlights.map((h) => ({ ...h, id: px(h.id, String(i)) }));
    })
    .sort((a, b) => a.team.localeCompare(b.team));
}

export function aggregateDelivery(
  map: Record<string, DeliveryBoard>,
  teams: string[],
  q: Quarter,
): DeliveryBoard {
  return {
    title: "Delivery",
    metrics: aggregateMetrics(map, teams, quarterKey(q)),
    highlights: aggregateHighlights(map, teams, q),
  };
}

export function aggregateSummary(
  map: Record<string, SummaryBoard>,
  teams: string[],
  q: Quarter,
): SummaryBoard {
  const asks = teams.flatMap((t, i) => {
    const b = map[teamKey(t, q)];
    if (!b) return [];
    return b.asks.map((a) => ({ ...a, id: px(a.id, String(i)) }));
  });
  return {
    title: "Quarter in review",
    headline: "Roll-up across all teams.",
    asks,
  };
}
