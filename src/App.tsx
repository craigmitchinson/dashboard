import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Slide } from "./components/Slide";
import type { Capacity } from "./components/Slide";
import { DependenciesSlide } from "./components/DependenciesSlide";
import { DeliverySlide } from "./components/DeliverySlide";
import type { DeliveryColumn } from "./components/DeliverySlide";
import { ObjectivesSlide } from "./components/ObjectivesSlide";
import { SummarySlide } from "./components/SummarySlide";
import type { SummaryStats } from "./components/SummarySlide";
import { ChartsSlide } from "./components/ChartsSlide";
import type { YearPoint, RagPoint } from "./components/ChartsSlide";
import {
  seedRoadmap,
  seedDependencies,
  seedDelivery,
  seedObjectives,
  seedSummary,
  seedOrg,
  emptyRoadmap,
  emptyBoard,
  emptyDelivery,
  emptyObjectives,
  emptySummary,
} from "./data";
import type {
  Roadmap,
  DependenciesBoard,
  DeliveryBoard,
  ObjectivesBoard,
  SummaryBoard,
  RagStatus,
  DerivedStory,
  Org,
  OrgField,
} from "./types";
import { RAG_STATUSES } from "./types";
import { slide, themes } from "./theme";
import type { Mode } from "./theme";
import type { Quarter } from "./quarters";
import {
  quarterKey,
  previousQuarter,
  shortQuarter,
  quartersOfYear,
  currentQuarter,
  sameQuarter,
} from "./quarters";
import { ThemeProvider } from "./theme-context";
import { TeamsProvider } from "./teams-context";
import {
  ALL_TEAMS,
  teamKey,
  aggregateRoadmaps,
  aggregateBoards,
  aggregateObjectives,
  aggregateDelivery,
  aggregateMetrics,
  aggregateSummary,
} from "./teamdata";
import {
  addHighlight,
  editDeliveryTitle,
  editHighlight,
  removeHighlight,
  setMetric,
} from "./mutations-delivery";
import {
  addObjective,
  addKeyResult,
  cycleKeyResultStatus,
  cycleObjectiveStatus,
  editKeyResult,
  editObjective,
  editObjectivesTitle,
  removeKeyResult,
  removeObjective,
} from "./mutations-objectives";
import {
  addAsk,
  editAsk,
  editSummaryField,
  removeAsk,
} from "./mutations-summary";
import {
  addChild,
  addTheme,
  cloneStructure,
  editMeta,
  editRef,
  editText,
  moveNode,
  removeNode,
} from "./mutations";
import {
  addDependency,
  addEscalation,
  addRisk,
  cycleSeverity,
  cycleStatus,
  editBoardField,
  editDependency,
  editEscalation,
  editRisk,
  removeDependency,
  removeEscalation,
  removeRisk,
  toggleOrigin,
} from "./mutations-deps";

type SlideId =
  | "summary"
  | "objectives"
  | "roadmap"
  | "delivery"
  | "charts"
  | "dependencies";

const SLIDE_ORDER: SlideId[] = [
  "summary",
  "objectives",
  "roadmap",
  "delivery",
  "charts",
  "dependencies",
];

const SLIDE_LABELS: Record<SlideId, string> = {
  summary: "Summary",
  objectives: "Objectives",
  roadmap: "Roadmap",
  delivery: "Delivery",
  charts: "Charts",
  dependencies: "Dependencies",
};

// The seed content belongs to this team + quarter; everything else starts empty.
const SEED_QUARTER: Quarter = { q: 3, year: 2026 };
const DEFAULT_TEAM = "Customer Operations";
// Re-key a quarter-keyed seed map under a team, e.g. "2026-Q1" -> "Team#2026-Q1".
const underTeam = <T,>(rec: Record<string, T>, team: string): Record<string, T> =>
  Object.fromEntries(
    Object.entries(rec).map(([k, v]) => [`${team}#${k}`, v]),
  );

// --- Persistence ----------------------------------------------------------
// The whole pack is saved to localStorage so work survives a reload.
const PERSIST_KEY = "qbr-pack-v2";
type Saved = {
  roadmaps?: Record<string, Roadmap>;
  boards?: Record<string, DependenciesBoard>;
  delivery?: Record<string, DeliveryBoard>;
  objectives?: Record<string, ObjectivesBoard>;
  summary?: Record<string, SummaryBoard>;
  org?: Org;
  teams?: string[];
  activeTeam?: string;
  quarter?: Quarter;
  mode?: Mode;
};
const SAVED: Saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) || "null") || {};
  } catch {
    return {};
  }
})();

// Scale the fixed 1920x1080 canvas to fit the viewport for on-screen viewing
// only. The internal layout is always authored at full size, so a capture of
// the .slide-frame at 2x yields a clean 3840x2160 PNG regardless of this.
function useFitScale(margin: number) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const recompute = () => {
      const sx = (window.innerWidth - 64) / slide.width;
      const sy = (window.innerHeight - margin) / slide.height;
      setScale(Math.min(1, sx, sy));
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [margin]);
  return scale;
}

const capacityMessage: Record<Capacity["state"], string> = {
  ok: "",
  close: "Slide is nearly full",
  exceeded: "Content exceeds the slide",
};

// Small target glyph for the spotlight toggle.
const SpotIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    style={{ verticalAlign: "-2px", marginRight: 5 }}
  >
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
  </svg>
);

export default function App() {
  const [activeSlide, setActiveSlide] = useState<SlideId>("summary");
  // Org identity is global: shared across both tabs and every quarter.
  const [org, setOrg] = useState<Org>(SAVED.org ?? seedOrg);
  // Content is locked per quarter: each quarter keeps its own roadmap and board.
  const [roadmaps, setRoadmaps] = useState<Record<string, Roadmap>>(
    () =>
      SAVED.roadmaps ?? {
        [teamKey(DEFAULT_TEAM, SEED_QUARTER)]: seedRoadmap,
      },
  );
  const [boards, setBoards] = useState<Record<string, DependenciesBoard>>(
    () =>
      SAVED.boards ?? {
        [teamKey(DEFAULT_TEAM, SEED_QUARTER)]: seedDependencies,
      },
  );
  const [delivery, setDelivery] = useState<Record<string, DeliveryBoard>>(
    () => SAVED.delivery ?? underTeam(seedDelivery, DEFAULT_TEAM),
  );
  const [objectives, setObjectives] = useState<Record<string, ObjectivesBoard>>(
    () => SAVED.objectives ?? underTeam(seedObjectives, DEFAULT_TEAM),
  );
  const [summary, setSummary] = useState<Record<string, SummaryBoard>>(
    () => SAVED.summary ?? underTeam(seedSummary, DEFAULT_TEAM),
  );
  const [quarter, setQuarter] = useState<Quarter>(SAVED.quarter ?? SEED_QUARTER);
  const [activeTeam, setActiveTeam] = useState<string>(
    SAVED.activeTeam ?? DEFAULT_TEAM,
  );
  // The shared, editable list of teams that the org team and delivery highlights
  // pick from.
  const [teams, setTeams] = useState<string[]>(
    () =>
      SAVED.teams ?? [
        "Customer Operations",
        "Onboarding",
        "Payments",
        "Platform",
        "Data Engineering",
        "Messaging",
        "Security",
        "Brand",
      ],
  );
  const addTeam = useCallback(
    (t: string) => setTeams((ts) => (ts.includes(t) ? ts : [...ts, t])),
    [],
  );
  const removeTeam = useCallback(
    (t: string) => setTeams((ts) => (ts.length > 1 ? ts.filter((x) => x !== t) : ts)),
    [],
  );
  const [mode, setMode] = useState<Mode>(SAVED.mode ?? "light");
  const [exporting, setExporting] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const [capacity, setCapacity] = useState<Capacity>({
    state: "ok",
    clipped: 0,
    over: 0,
  });
  const scale = useFitScale(presenting ? 84 : 150);
  const liveRef = useRef<HTMLDivElement>(null);
  const theme = themes[mode];
  const isRoadmap = activeSlide === "roadmap";

  // Content is keyed by team AND quarter. "All teams" is a read-only aggregate.
  const isAll = activeTeam === ALL_TEAMS;
  const key = teamKey(activeTeam, quarter);
  const roadmap = isAll
    ? aggregateRoadmaps(roadmaps, teams, quarter)
    : (roadmaps[key] ?? emptyRoadmap());
  const board = isAll
    ? aggregateBoards(boards, teams, quarter)
    : (boards[key] ?? emptyBoard());

  // Mutations target the active team + selected quarter, creating it on first
  // edit. They are no-ops in the All teams aggregate (which is read-only).
  const updateRoadmap = useCallback(
    (fn: (r: Roadmap) => Roadmap) => {
      if (isAll) return;
      setRoadmaps((rs) => ({ ...rs, [key]: fn(rs[key] ?? emptyRoadmap()) }));
    },
    [key, isAll],
  );
  const updateBoard = useCallback(
    (fn: (b: DependenciesBoard) => DependenciesBoard) => {
      if (isAll) return;
      setBoards((bs) => ({ ...bs, [key]: fn(bs[key] ?? emptyBoard()) }));
    },
    [key, isAll],
  );
  // Delivery edits can target any visible column, so this takes an explicit key.
  const updateDelivery = useCallback(
    (dKey: string, fn: (b: DeliveryBoard) => DeliveryBoard) => {
      if (isAll) return;
      setDelivery((d) => ({ ...d, [dKey]: fn(d[dKey] ?? emptyDelivery()) }));
    },
    [isAll],
  );

  const updateObjectives = useCallback(
    (fn: (b: ObjectivesBoard) => ObjectivesBoard) => {
      if (isAll) return;
      setObjectives((o) => ({ ...o, [key]: fn(o[key] ?? emptyObjectives()) }));
    },
    [key, isAll],
  );
  const updateSummary = useCallback(
    (fn: (b: SummaryBoard) => SummaryBoard) => {
      if (isAll) return;
      setSummary((s) => ({ ...s, [key]: fn(s[key] ?? emptySummary()) }));
    },
    [key, isAll],
  );

  const objectivesBoard = isAll
    ? aggregateObjectives(objectives, teams, quarter)
    : (objectives[key] ?? emptyObjectives());
  const selectedDelivery = isAll
    ? aggregateDelivery(delivery, teams, quarter)
    : (delivery[key] ?? emptyDelivery());
  const summaryBoard = isAll
    ? aggregateSummary(summary, teams, quarter)
    : (summary[key] ?? emptySummary());

  // The Summary slide aggregates RAG from the other tabs for the selected quarter.
  const delMetrics = selectedDelivery.metrics;
  const allDeps = [...board.current, ...board.next];
  const summaryStats: SummaryStats = {
    objectives: RAG_STATUSES.reduce(
      (acc, r) => ({
        ...acc,
        [r]: objectivesBoard.objectives.filter((o) => o.status === r).length,
      }),
      {} as Record<RagStatus, number>,
    ),
    objectivesTotal: objectivesBoard.objectives.length,
    delivery: {
      committed: delMetrics.committed,
      committedDelivered: delMetrics.committedDelivered,
      predictability:
        delMetrics.committed > 0
          ? Math.round((delMetrics.committedDelivered / delMetrics.committed) * 100)
          : 0,
    },
    deps: {
      total: allDeps.length,
      blocked: allDeps.filter((d) => d.status === "blocked").length,
      escalations: board.escalations.length,
      highRisks: board.risks.filter((r) => r.severity === "high").length,
    },
  };

  // Highlights / watch-outs / next-quarter focus are derived from the other tabs
  // so the summary always reflects the real data rather than free text.
  const cap = (arr: string[], n = 6) => arr.slice(0, n);
  const obj = objectivesBoard.objectives;
  const derivedStory: DerivedStory = {
    highlights: cap([
      ...selectedDelivery.highlights.map((h) => `${h.team}: ${h.text}`),
      ...obj
        .filter((o) => o.status === "on-track")
        .map((o) => `${o.text} (on track)`),
    ]),
    watchouts: cap([
      ...obj
        .filter((o) => o.status === "off-track")
        .map((o) => `${o.text} (off track)`),
      ...allDeps
        .filter((d) => d.status === "blocked")
        .map((d) => `Blocked: ${d.text}`),
      ...board.risks
        .filter((r) => r.severity === "high")
        .map((r) => `High risk: ${r.text}`),
      ...board.escalations.map((e) => e.text),
    ]),
    focus: cap([
      ...obj
        .filter((o) => o.status === "at-risk")
        .map((o) => `${o.text} (at risk)`),
      ...obj
        .filter((o) => o.status === "off-track")
        .map((o) => `${o.text} (off track)`),
      ...board.next
        .filter((d) => d.origin === "incoming")
        .map((d) => `Incoming: ${d.text}`),
    ]),
  };

  const now = currentQuarter();
  // Metrics for a quarter, for the active team (or summed for All teams).
  const metricsFor = (q: Quarter) =>
    isAll
      ? aggregateMetrics(delivery, teams, quarterKey(q))
      : (delivery[teamKey(activeTeam, q)] ?? emptyDelivery()).metrics;

  // The selected quarter plus the two before it, oldest first.
  const deliveryColumns: DeliveryColumn[] = [
    previousQuarter(previousQuarter(quarter)),
    previousQuarter(quarter),
    quarter,
  ].map((q) => ({
    key: isAll ? quarterKey(q) : teamKey(activeTeam, q),
    label: shortQuarter(q),
    isCurrent: sameQuarter(q, quarter),
    metrics: metricsFor(q),
  }));

  // Year-to-date series for the charts view: every quarter of the selected year.
  const yearSeries: YearPoint[] = quartersOfYear(quarter.year).map((q) => ({
    label: shortQuarter(q),
    isCurrent: sameQuarter(q, now),
    metrics: metricsFor(q),
  }));

  // Objective RAG counts per quarter, for the active team (or summed for All).
  const ragCountsFor = (q: Quarter): Record<RagStatus, number> => {
    const objs = isAll
      ? aggregateObjectives(objectives, teams, q).objectives
      : (objectives[teamKey(activeTeam, q)]?.objectives ?? []);
    return RAG_STATUSES.reduce(
      (acc, r) => {
        acc[r] = objs.filter((o) => o.status === r).length;
        return acc;
      },
      {} as Record<RagStatus, number>,
    );
  };
  const ragSeries: RagPoint[] = quartersOfYear(quarter.year).map((q) => ({
    label: shortQuarter(q),
    isCurrent: sameQuarter(q, now),
    counts: ragCountsFor(q),
  }));

  const editOrg = (field: OrgField, text: string) =>
    setOrg((o) => ({ ...o, [field]: text }));

  // Export the selected quarter's five slides as a 16:9 .pptx, one full-bleed
  // 2x (3840x2160) image per slide. Tabs are switched in turn and each
  // .slide-frame is captured with the browser's own rendering for fidelity.
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    const previous = activeSlide;
    try {
      const { toPng } = await import("html-to-image");
      const PptxGen = (await import("pptxgenjs")).default;
      await document.fonts.ready;

      const shots: string[] = [];
      for (const id of SLIDE_ORDER) {
        setActiveSlide(id);
        // Let React commit the new slide and the browser paint it.
        await new Promise((r) => setTimeout(r, 350));
        const node = liveRef.current?.querySelector(
          ".slide-frame",
        ) as HTMLElement | null;
        if (!node) continue;
        shots.push(
          await toPng(node, {
            pixelRatio: 2,
            cacheBust: true,
            width: slide.width,
            height: slide.height,
          }),
        );
      }

      const pptx = new PptxGen();
      pptx.defineLayout({ name: "QBR16x9", width: 13.333, height: 7.5 });
      pptx.layout = "QBR16x9";
      shots.forEach((data) => {
        pptx.addSlide().addImage({ data, x: 0, y: 0, w: 13.333, h: 7.5 });
      });
      const safeTeam = activeTeam.replace(/[^\w. -]/g, "");
      await pptx.writeFile({
        fileName: `QBR ${shortQuarter(quarter)} ${safeTeam}.pptx`,
      });
    } finally {
      setActiveSlide(previous);
      setExporting(false);
    }
  };

  // Reset empties the current quarter, ready to build from scratch or copy from
  // the previous quarter. Populate examples drops in the seed template instead.
  const resetRoadmap = () =>
    setRoadmaps((rs) => ({ ...rs, [key]: emptyRoadmap() }));
  const resetBoard = () => setBoards((bs) => ({ ...bs, [key]: emptyBoard() }));
  const exampleRoadmap = () =>
    setRoadmaps((rs) => ({ ...rs, [key]: structuredClone(seedRoadmap) }));
  const exampleBoard = () =>
    setBoards((bs) => ({ ...bs, [key]: structuredClone(seedDependencies) }));
  const resetDelivery = () =>
    setDelivery((d) => ({ ...d, [key]: emptyDelivery() }));
  const seedQK = quarterKey(SEED_QUARTER);
  const exampleDelivery = () =>
    setDelivery((d) => ({
      ...d,
      [key]: structuredClone(
        seedDelivery[quarterKey(quarter)] ?? seedDelivery[seedQK],
      ),
    }));
  const resetObjectives = () =>
    setObjectives((o) => ({ ...o, [key]: emptyObjectives() }));
  const exampleObjectives = () =>
    setObjectives((o) => ({
      ...o,
      [key]: structuredClone(
        seedObjectives[quarterKey(quarter)] ?? seedObjectives[seedQK],
      ),
    }));
  const resetSummary = () =>
    setSummary((s) => ({ ...s, [key]: emptySummary() }));
  const exampleSummary = () =>
    setSummary((s) => ({
      ...s,
      [key]: structuredClone(
        seedSummary[quarterKey(quarter)] ?? seedSummary[seedQK],
      ),
    }));

  // Carry the previous quarter's theme/outcome/epic scaffolding into this one.
  const prev = previousQuarter(quarter);
  const prevRoadmap = roadmaps[teamKey(activeTeam, prev)];
  const canCopyFromPrev =
    (roadmap.themes.length === 0) && !!prevRoadmap && prevRoadmap.themes.length > 0;
  const copyFromPrev = () => {
    if (!prevRoadmap) return;
    setRoadmaps((rs) => ({ ...rs, [key]: cloneStructure(prevRoadmap) }));
  };

  useEffect(() => {
    document.title = "Roadmap pack";
  }, []);

  // The neutral area around the slide follows the active mode.
  useEffect(() => {
    document.body.style.background = theme.page;
  }, [theme.page]);

  // Persist the whole pack so a reload restores it.
  useEffect(() => {
    const data: Saved = {
      roadmaps,
      boards,
      delivery,
      objectives,
      summary,
      org,
      teams,
      activeTeam,
      quarter,
      mode,
    };
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [roadmaps, boards, delivery, objectives, summary, org, teams, activeTeam, quarter, mode]);

  // Spotlight: while on, clicking a block lifts it and dims the rest (single
  // active block). Pure DOM within the current tab; resets on tab change.
  useEffect(() => {
    const root = liveRef.current;
    if (!root) return;
    const frame = () => root.querySelector(".slide-frame");
    const clear = () => {
      const f = frame();
      f?.classList.remove("is-spotting");
      f?.querySelectorAll("[data-spot].is-spot").forEach((n) =>
        n.classList.remove("is-spot"),
      );
    };
    if (!spotlight) {
      clear();
      return;
    }
    // Drop any active text caret so no focus ring shows under the scrim.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const onClick = (e: MouseEvent) => {
      const f = frame();
      if (!f) return;
      const el = (e.target as HTMLElement).closest?.("[data-spot]");
      if (!el || !f.contains(el)) return;
      const wasActive = el.classList.contains("is-spot");
      f.querySelectorAll("[data-spot].is-spot").forEach((n) =>
        n.classList.remove("is-spot"),
      );
      if (!wasActive) {
        el.classList.add("is-spot");
        f.classList.add("is-spotting");
      } else {
        f.classList.remove("is-spotting");
      }
    };
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
      clear();
    };
  }, [spotlight, activeSlide]);

  // In present mode, arrow keys move between slides and Escape exits.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const i = SLIDE_ORDER.indexOf(activeSlide);
        const next =
          e.key === "ArrowRight"
            ? Math.min(SLIDE_ORDER.length - 1, i + 1)
            : Math.max(0, i - 1);
        setActiveSlide(SLIDE_ORDER[next]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, activeSlide]);

  // Stable handler so the Slide's measurement effect does not re-run each render;
  // only update when the status actually changes to avoid a measure/render loop.
  const handleCapacity = useCallback((next: Capacity) => {
    setCapacity((prev) =>
      prev.state === next.state && prev.clipped === next.clipped ? prev : next,
    );
  }, []);

  const warning =
    capacity.state === "exceeded"
      ? capacity.clipped > 0
        ? `${capacityMessage.exceeded} (${capacity.clipped} ${
            capacity.clipped === 1 ? "entry" : "entries"
          } clipped). Trim to fit.`
        : `${capacityMessage.exceeded}. Trim to fit.`
      : capacity.state === "close"
        ? capacityMessage.close
        : "";

  const warningColour =
    capacity.state === "exceeded" ? theme.accent : theme.accentSoft;
  const showWarning = isRoadmap && warning;

  const hint =
    activeSlide === "summary"
      ? "Headline numbers update from the other tabs · edit the story and decisions here"
      : activeSlide === "objectives"
        ? "Click a status dot to cycle on track / at risk / off track · content is per quarter"
        : activeSlide === "roadmap"
          ? "Pick the quarter from the eyebrow · click any text to edit · content is per quarter"
          : activeSlide === "dependencies"
            ? "Click a status dot to recategorise · the New / Carried badge toggles incoming and existing"
            : activeSlide === "charts"
              ? "Year-to-date performance across the four quarters · derived from delivery, read-only"
              : "Type any number to record it · the current quarter has no delivered metrics yet";

  return (
    <div
      className="stage"
      data-mode={mode}
      data-exporting={exporting ? "true" : undefined}
      data-presenting={presenting ? "true" : undefined}
      data-spotlight={spotlight ? "true" : undefined}
      data-readonly={isAll ? "true" : undefined}
      style={{ background: theme.page }}
    >
      <div className="stage__frame" style={{ width: slide.width * scale }}>
        {/* Top utility bar (hidden in present mode) */}
        {!presenting && (
          <div className="stage__bar">
            <span>Quarterly business review pack &middot; 1920 &times; 1080</span>
            <span className="spacer" />
            <span className="stage__hint">{hint}</span>
            <button
              className={spotlight ? "" : "ghost"}
              onClick={() => setSpotlight((s) => !s)}
              title="Spotlight a block while you talk"
            >
              <SpotIcon />
              Spotlight
            </button>
            <button onClick={() => setPresenting(true)}>Present</button>
            <button className="ghost" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting…" : "Export PPTX"}
            </button>
            <button
              className="ghost"
              onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
            >
              {mode === "light" ? "Dark mode" : "Light mode"}
            </button>
          </div>
        )}

        {/* Control row, sitting directly above the slide */}
        <div className="stage__controls">
          <div className="stage__tabs">
            {SLIDE_ORDER.map((id) => (
              <button
                key={id}
                className={`stage__tab${
                  activeSlide === id ? " is-active" : ""
                }`}
                onClick={() => setActiveSlide(id)}
              >
                {SLIDE_LABELS[id]}
              </button>
            ))}
          </div>
          <span className="spacer" />
          {presenting ? (
            <div className="stage__actions">
              <button
                className={spotlight ? "" : "ghost"}
                onClick={() => setSpotlight((s) => !s)}
                title="Spotlight a block while you talk"
              >
                <SpotIcon />
                Spotlight
              </button>
              <button className="ghost" onClick={() => setPresenting(false)}>
                Exit present
              </button>
            </div>
          ) : (
          <div className="stage__actions">
            {showWarning && (
              <span
                role="status"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  color: warningColour,
                  fontWeight: 700,
                  fontFamily: '"JetBrains Mono", Consolas, monospace',
                  fontSize: 12,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: warningColour,
                  }}
                />
                {warning}
              </span>
            )}
            {isAll && (
              <span
                style={{
                  fontFamily: '"JetBrains Mono", Consolas, monospace',
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: theme.inkSoft,
                }}
              >
                Read-only roll-up
              </span>
            )}
            {!isAll && activeSlide === "summary" && (
              <>
                <button onClick={() => updateSummary((b) => addAsk(b))}>
                  + Decision
                </button>
                <button className="ghost" onClick={exampleSummary}>
                  Populate examples
                </button>
                <button className="ghost" onClick={resetSummary}>
                  Reset quarter
                </button>
              </>
            )}
            {!isAll && activeSlide === "objectives" && (
              <>
                <button onClick={() => updateObjectives((b) => addObjective(b))}>
                  + Objective
                </button>
                <button className="ghost" onClick={exampleObjectives}>
                  Populate examples
                </button>
                <button className="ghost" onClick={resetObjectives}>
                  Reset quarter
                </button>
              </>
            )}
            {!isAll && activeSlide === "roadmap" && (
              <>
                <button onClick={() => updateRoadmap((r) => addTheme(r))}>
                  + Theme
                </button>
                {canCopyFromPrev && (
                  <button onClick={copyFromPrev}>
                    Copy structure from {shortQuarter(prev)}
                  </button>
                )}
                <button className="ghost" onClick={exampleRoadmap}>
                  Populate examples
                </button>
                <button className="ghost" onClick={resetRoadmap}>
                  Reset quarter
                </button>
              </>
            )}
            {!isAll && activeSlide === "dependencies" && (
              <>
                <button className="ghost" onClick={exampleBoard}>
                  Populate examples
                </button>
                <button className="ghost" onClick={resetBoard}>
                  Reset quarter
                </button>
              </>
            )}
            {!isAll && activeSlide === "delivery" && (
              <>
                <button onClick={() => updateDelivery(key, (b) => addHighlight(b))}>
                  + Highlight
                </button>
                <button className="ghost" onClick={exampleDelivery}>
                  Populate examples
                </button>
                <button className="ghost" onClick={resetDelivery}>
                  Reset quarter
                </button>
              </>
            )}
          </div>
          )}
        </div>

      {/* Wrapper sized to the scaled canvas so the page flows without scroll. */}
      <div
        className="stage__canvas"
        style={{
          width: slide.width * scale,
          height: slide.height * scale,
        }}
      >
        <div
          ref={liveRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: slide.width,
            height: slide.height,
          }}
        >
          <ThemeProvider value={theme}>
           <TeamsProvider
             value={{ teams, addTeam, removeTeam, activeTeam, setActiveTeam }}
           >
            {activeSlide === "charts" && (
              <ChartsSlide
                quarter={quarter}
                onQuarterChange={setQuarter}
                org={org}
                onEditOrg={editOrg}
                year={quarter.year}
                series={yearSeries}
                ragSeries={ragSeries}
              />
            )}
            {activeSlide === "summary" && (
              <SummarySlide
                quarter={quarter}
                onQuarterChange={setQuarter}
                org={org}
                onEditOrg={editOrg}
                board={summaryBoard}
                stats={summaryStats}
                derived={derivedStory}
                onEditField={(field, text) =>
                  updateSummary((b) => editSummaryField(b, field, text))
                }
                onAddAsk={() => updateSummary((b) => addAsk(b))}
                onEditAsk={(id, field, text) =>
                  updateSummary((b) => editAsk(b, id, field, text))
                }
                onRemoveAsk={(id) => updateSummary((b) => removeAsk(b, id))}
              />
            )}
            {activeSlide === "objectives" && (
              <ObjectivesSlide
                quarter={quarter}
                onQuarterChange={setQuarter}
                org={org}
                onEditOrg={editOrg}
                board={objectivesBoard}
                onEditTitle={(t) =>
                  updateObjectives((b) => editObjectivesTitle(b, t))
                }
                onAddObjective={() => updateObjectives((b) => addObjective(b))}
                onEditObjective={(id, t) =>
                  updateObjectives((b) => editObjective(b, id, t))
                }
                onCycleObjectiveStatus={(id) =>
                  updateObjectives((b) => cycleObjectiveStatus(b, id))
                }
                onRemoveObjective={(id) =>
                  updateObjectives((b) => removeObjective(b, id))
                }
                onAddKr={(oid) => updateObjectives((b) => addKeyResult(b, oid))}
                onEditKr={(oid, kid, field, t) =>
                  updateObjectives((b) => editKeyResult(b, oid, kid, field, t))
                }
                onCycleKrStatus={(oid, kid) =>
                  updateObjectives((b) => cycleKeyResultStatus(b, oid, kid))
                }
                onRemoveKr={(oid, kid) =>
                  updateObjectives((b) => removeKeyResult(b, oid, kid))
                }
              />
            )}
            {activeSlide === "roadmap" && (
              <Slide
                roadmap={roadmap}
                quarter={quarter}
                onQuarterChange={setQuarter}
                org={org}
                onEditOrg={editOrg}
                onEdit={(path, level, text) =>
                  updateRoadmap((r) => editText(r, path, level, text))
                }
                onEditRef={(path, level, text) =>
                  updateRoadmap((r) => editRef(r, path, level, text))
                }
                onEditMeta={(field, text) =>
                  updateRoadmap((r) => editMeta(r, field, text))
                }
                onAddChild={(path, level) =>
                  updateRoadmap((r) => addChild(r, path, level))
                }
                onRemove={(path, level) =>
                  updateRoadmap((r) => removeNode(r, path, level))
                }
                onMove={(path, level, dir) =>
                  updateRoadmap((r) => moveNode(r, path, level, dir))
                }
                onCapacity={handleCapacity}
              />
            )}
            {activeSlide === "dependencies" && (
              <DependenciesSlide
                board={board}
                quarter={quarter}
                onQuarterChange={setQuarter}
                org={org}
                onEditOrg={editOrg}
                onEditField={(field, text) =>
                  updateBoard((b) => editBoardField(b, field, text))
                }
                onAddDep={(horizon, status) =>
                  updateBoard((b) => addDependency(b, horizon, status))
                }
                onEditDep={(horizon, id, text) =>
                  updateBoard((b) => editDependency(b, horizon, id, text))
                }
                onCycleStatus={(horizon, id) =>
                  updateBoard((b) => cycleStatus(b, horizon, id))
                }
                onToggleOrigin={(horizon, id) =>
                  updateBoard((b) => toggleOrigin(b, horizon, id))
                }
                onRemoveDep={(horizon, id) =>
                  updateBoard((b) => removeDependency(b, horizon, id))
                }
                onAddEscalation={() => updateBoard((b) => addEscalation(b))}
                onEditEscalation={(id, text) =>
                  updateBoard((b) => editEscalation(b, id, text))
                }
                onRemoveEscalation={(id) =>
                  updateBoard((b) => removeEscalation(b, id))
                }
                onAddRisk={() => updateBoard((b) => addRisk(b))}
                onEditRisk={(id, text) =>
                  updateBoard((b) => editRisk(b, id, text))
                }
                onCycleSeverity={(id) => updateBoard((b) => cycleSeverity(b, id))}
                onRemoveRisk={(id) => updateBoard((b) => removeRisk(b, id))}
              />
            )}
            {activeSlide === "delivery" && (
              <DeliverySlide
                quarter={quarter}
                onQuarterChange={setQuarter}
                org={org}
                onEditOrg={editOrg}
                title={selectedDelivery.title}
                onEditTitle={(t) =>
                  updateDelivery(key, (b) => editDeliveryTitle(b, t))
                }
                columns={deliveryColumns}
                onEditMetric={(qk, field, text) =>
                  updateDelivery(qk, (b) => setMetric(b, field, text))
                }
                highlights={selectedDelivery.highlights}
                onAddHighlight={() =>
                  updateDelivery(key, (b) => addHighlight(b))
                }
                onEditHighlight={(id, field, text) =>
                  updateDelivery(key, (b) => editHighlight(b, id, field, text))
                }
                onRemoveHighlight={(id) =>
                  updateDelivery(key, (b) => removeHighlight(b, id))
                }
              />
            )}
           </TeamsProvider>
          </ThemeProvider>
        </div>
      </div>
      </div>
    </div>
  );
}
