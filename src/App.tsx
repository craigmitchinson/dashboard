import { useEffect, useLayoutEffect, useState } from "react";
import type { ComponentType } from "react";
import { themes } from "./theme";
import type { Mode } from "./theme";
import { fonts } from "./theme";
import { ThemeProvider, useTheme } from "./theme-context";
import { FiltersProvider, useFilters } from "./filters-context";
import { FilterBar } from "./components/Slicers";
import { fmtDateFull, DATE_MAX } from "./rpaData";
import {
  IconGrid,
  IconFlow,
  IconBars,
  IconAlert,
  IconServer,
  IconCoins,
  IconRefresh,
  IconChevron,
  IconBook,
} from "./components/icons";
import { Overview } from "./pages/Overview";
import { InputOutcome } from "./pages/InputOutcome";
import { ProcessAnalysis } from "./pages/ProcessAnalysis";
import { Exceptions } from "./pages/Exceptions";
import { Capacity } from "./pages/Capacity";
import { Commercial } from "./pages/Commercial";
import { BuildGuide } from "./pages/BuildGuide";

// Fixed Power BI report-page canvas (16:9). Designed at this size, scaled to fit
// the viewport — so a screenshot of the frame is exactly a 16:9 report page.
const FRAME = { w: 1600, h: 900 };

interface Page {
  id: string;
  label: string;
  group: string;
  Icon: ComponentType<{ size?: number }>;
  Component: ComponentType;
  blurb: string;
}

const PAGES: Page[] = [
  { id: "overview", label: "Overview", group: "Monitor", Icon: IconGrid, Component: Overview, blurb: "Headline performance, outcome mix and the operational watchlist" },
  { id: "input-outcome", label: "Input & Outcome", group: "Monitor", Icon: IconFlow, Component: InputOutcome, blurb: "Case flow in and out, by outcome, daily or monthly" },
  { id: "process", label: "Process Analysis", group: "Monitor", Icon: IconBars, Component: ProcessAnalysis, blurb: "Completion time, throughput and exception trends by process" },
  { id: "exceptions", label: "Exceptions", group: "Monitor", Icon: IconAlert, Component: Exceptions, blurb: "Exception heatmap and searchable detail" },
  { id: "capacity", label: "VDI & Capacity", group: "Optimise", Icon: IconServer, Component: Capacity, blurb: "Digital-worker utilisation, idle time and licence cost" },
  { id: "commercial", label: "Commercial Performance", group: "Optimise", Icon: IconCoins, Component: Commercial, blurb: "Cost per case, benefit modelling and cumulative ROI" },
  { id: "guide", label: "Build guide", group: "Reference", Icon: IconBook, Component: BuildGuide, blurb: "How to rebuild each visual in Power BI — native visuals, measures and Deneb" },
];

const PERSIST = "bp-report-v1";
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST) || "null") || {};
  } catch {
    return {};
  }
})();

function useFit(margin: number) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const recompute = () => setScale(Math.min(1, (window.innerWidth - 32) / FRAME.w, (window.innerHeight - margin) / FRAME.h));
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [margin]);
  return scale;
}

export default function App() {
  const [mode, setMode] = useState<Mode>(saved.mode ?? "dark");
  const theme = themes[mode];
  useEffect(() => {
    document.body.style.background = theme.page;
    document.title = "Blue Prism — Automation Performance";
  }, [theme.page]);

  return (
    <ThemeProvider value={theme}>
      <FiltersProvider>
        <Report mode={mode} setMode={setMode} />
      </FiltersProvider>
    </ThemeProvider>
  );
}

function Report({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const t = useTheme();
  const { reset, filters, peopleRate } = useFilters();
  const [pageId, setPageId] = useState<string>(saved.pageId ?? "overview");
  const [collapsed, setCollapsed] = useState<boolean>(saved.collapsed ?? false);
  const scale = useFit(70);

  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0];
  const PageBody = page.Component;

  useEffect(() => {
    try {
      localStorage.setItem(PERSIST, JSON.stringify({ mode, pageId, collapsed }));
    } catch {
      /* ignore */
    }
  }, [mode, pageId, collapsed]);

  const activeFilters =
    (filters.proposition !== "All" ? 1 : 0) +
    (filters.processId !== "All" ? 1 : 0) +
    (filters.queue !== "All" ? 1 : 0) +
    (filters.tags.length ? 1 : 0) +
    (filters.range !== 90 ? 1 : 0) +
    (peopleRate !== 28 ? 1 : 0);

  const groups = Array.from(new Set(PAGES.map((p) => p.group)));

  return (
    <div className="stage" style={{ background: t.page }}>
      {/* outer app bar (not part of the report page) */}
      <div className="stage__bar" style={{ width: FRAME.w * scale }}>
        <span style={{ color: t.inkSoft }}>Blue Prism · Automation Performance — report canvas {FRAME.w} × {FRAME.h} (16:9)</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: t.inkSoft }}>Page {PAGES.indexOf(page) + 1} / {PAGES.length}</span>
        <button onClick={() => setMode(mode === "dark" ? "light" : "dark")} className="bar-btn" style={{ border: `1px solid ${t.ruleSoft}`, color: t.inkSoft }}>
          {mode === "dark" ? "Light" : "Dark"}
        </button>
      </div>

      {/* the 16:9 report page */}
      <div className="stage__frame" style={{ width: FRAME.w * scale, height: FRAME.h * scale }}>
        <div className="report" data-mode={mode} style={{ width: FRAME.w, height: FRAME.h, transform: `scale(${scale})`, transformOrigin: "top left", background: t.page, color: t.ink, boxShadow: t.shadow }}>
          {/* ---- left navigation ---- */}
          <aside className="report__nav" style={{ width: collapsed ? 62 : 232, background: t.paper, borderRight: `1px solid ${t.ruleSoft}` }}>
            <div className="report__brand" style={{ borderBottom: `1px solid ${t.ruleSoft}` }}>
              <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: t.accent, color: "#fff", flex: "0 0 auto", fontFamily: fonts.display, fontWeight: 700, fontSize: 17 }}>bp</span>
              {!collapsed && (
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: fonts.display, fontSize: 15, fontWeight: 700, lineHeight: 1.1, color: t.ink }}>Blue Prism</span>
                  <span style={{ display: "block", fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: t.inkSoft }}>RPA Performance</span>
                </span>
              )}
            </div>

            <nav style={{ flex: 1, overflow: "auto", padding: "10px 8px" }}>
              {groups.map((g) => (
                <div key={g} style={{ marginBottom: 10 }}>
                  {!collapsed && <div style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: t.inkSoft, padding: "6px 10px 4px", opacity: 0.8 }}>{g}</div>}
                  {PAGES.filter((p) => p.group === g).map((p) => {
                    const on = p.id === pageId;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPageId(p.id)}
                        title={p.label}
                        className={`nav-item${on ? " is-active" : ""}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 11,
                          width: "100%",
                          textAlign: "left",
                          padding: collapsed ? "10px" : "9px 10px",
                          justifyContent: collapsed ? "center" : "flex-start",
                          border: "none",
                          borderRadius: 8,
                          cursor: "pointer",
                          marginBottom: 2,
                          background: on ? t.accent : "transparent",
                          color: on ? "#fff" : t.ink,
                          fontFamily: fonts.body,
                          fontSize: 13.5,
                          fontWeight: on ? 700 : 500,
                        }}
                      >
                        <p.Icon size={18} />
                        {!collapsed && <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <button
              onClick={() => setCollapsed((c) => !c)}
              className="nav-collapse"
              style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, padding: "10px 14px", border: "none", borderTop: `1px solid ${t.ruleSoft}`, background: "transparent", color: t.inkSoft, cursor: "pointer", fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}
            >
              <IconChevron size={14} style={{ transform: collapsed ? "none" : "rotate(180deg)" }} />
              {!collapsed && "Collapse"}
            </button>
          </aside>

          {/* ---- main column ---- */}
          <div className="report__main">
            <header className="report__header" style={{ background: t.paper, borderBottom: `1px solid ${t.ruleSoft}` }}>
              <div style={{ minWidth: 0 }}>
                <h1 style={{ margin: 0, fontFamily: fonts.display, fontSize: 21, fontWeight: 700, color: t.ink, lineHeight: 1.1 }}>{page.label}</h1>
                <p style={{ margin: "2px 0 0", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft }}>{page.blurb}</p>
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.04em", color: t.inkSoft, textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: t.status.committed.dot }} className="pulse-soft" /> Last refreshed</span>
                <br />
                {fmtDateFull(DATE_MAX)} · 06:00
              </span>
              <button onClick={reset} className="hdr-btn" style={btn(t)} title="Clear all slicers">
                <IconRefresh size={13} /> Reset{activeFilters ? ` (${activeFilters})` : ""}
              </button>
            </header>

            {/* persistent slicer pane — cross-filters every page */}
            <div className="report__slicers" style={{ background: t.page, borderBottom: `1px solid ${t.ruleSoft}` }}>
              <FilterBar />
            </div>

            <main className="report__canvas">
              <PageBody key={page.id} />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function btn(t: ReturnType<typeof useTheme>) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    padding: "7px 12px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
    border: `1px solid ${t.ruleSoft}`,
    background: "transparent",
    color: t.inkSoft,
  };
}
