import { useMemo, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useAuth, usePermissions } from "../auth/auth-context";
import type { PermAction } from "../auth/auth-context";
import { useReference } from "../reference/reference-context";
import { PageGrid } from "../components/viz";
import { ErrorBanner } from "./admin/shared";
import type { SectionProps } from "./admin/shared";
import { SquadsSection } from "./admin/SquadsSection";
import { ProcessesSection } from "./admin/ProcessesSection";
import { PeopleCostsSection } from "./admin/PeopleCostsSection";
import { VdiSection } from "./admin/VdiSection";
import { GradeRateSection } from "./admin/GradeRateSection";
import { ExceptionPatternsSection } from "./admin/ExceptionPatternsSection";
import { UsersSection } from "./admin/UsersSection";
import { DataSyncSection } from "./admin/DataSyncSection";
import { ThresholdsSection } from "./admin/ThresholdsSection";

// ---------------------------------------------------------------------------
// Administration — the editable-reference-data control room. A left-hand
// section tab list (ARIA tabs pattern, arrow-key navigable) plus a content
// panel; every section reads/writes through useReference()'s update(), so
// every edit reflects in the dashboards instantly (the economics engine reads
// the same store — see src/reference/economics.ts).
//
// Role scoping is enforced twice, deliberately: the tab list hides sections a
// role has no business seeing at all (Squads / Exception patterns / Users are
// admin-governance surfaces), and — inside a visible section — each row's
// edit affordances are individually gated by can(), so a hub_lead sees every
// spoke but can only edit their own.
// ---------------------------------------------------------------------------

type SectionId = "squads" | "processes" | "people" | "vdi" | "grades" | "exceptions" | "users" | "sync" | "thresholds";

interface SectionDef {
  id: SectionId;
  label: string;
  Component: ComponentType<SectionProps>;
  visible: (can: (action: PermAction) => boolean) => boolean;
}

const SECTIONS: SectionDef[] = [
  { id: "squads", label: "Squads (spokes)", Component: SquadsSection, visible: (can) => can("edit_global_reference") },
  { id: "processes", label: "Propositions & processes", Component: ProcessesSection, visible: () => true },
  { id: "people", label: "People costs", Component: PeopleCostsSection, visible: () => true },
  { id: "vdi", label: "VDI estate", Component: VdiSection, visible: () => true },
  { id: "thresholds", label: "Targets & thresholds", Component: ThresholdsSection, visible: () => true },
  { id: "grades", label: "Grade rate card", Component: GradeRateSection, visible: () => true },
  { id: "exceptions", label: "Exception patterns", Component: ExceptionPatternsSection, visible: (can) => can("edit_global_reference") },
  { id: "users", label: "Users & roles", Component: UsersSection, visible: (can) => can("manage_users") },
  { id: "sync", label: "Data & sync", Component: DataSyncSection, visible: () => true },
];

export function Admin() {
  const t = useTheme();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { reference, update, error, dirty, changelog } = useReference();

  const visibleSections = useMemo(() => SECTIONS.filter((s) => s.visible(can)), [can]);
  const [activeId, setActiveId] = useState<SectionId>(visibleSections[0]?.id ?? "processes");
  const active = visibleSections.find((s) => s.id === activeId) ?? visibleSections[0];
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const lastEdited = changelog.length ? changelog[changelog.length - 1].ts : null;

  const onTabKeyDown = (e: ReactKeyboardEvent, idx: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = visibleSections.length;
    const next = e.key === "ArrowDown" ? (idx + 1) % n : e.key === "ArrowUp" ? (idx - 1 + n) % n : e.key === "Home" ? 0 : n - 1;
    const nextId = visibleSections[next].id;
    setActiveId(nextId);
    tabRefs.current[nextId]?.focus();
  };

  if (!active) {
    return (
      <PageGrid>
        <ErrorBanner>You don't have access to any Administration section.</ErrorBanner>
      </PageGrid>
    );
  }

  const ActiveComponent = active.Component;
  const sectionProps: SectionProps = { reference, update, actor: user?.name ?? "Unknown", can, isAdmin: can("edit_global_reference") };

  return (
    <PageGrid>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft }}>
          Every save here updates the dashboards immediately — the same reference data drives every chart and KPI.
        </span>
        <div style={{ flex: 1 }} />
        {dirty && (
          <span
            className="adm-pill"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em", color: t.accent, background: `${t.accent}14`, border: `1px solid ${t.accent}55`, padding: "4px 10px", borderRadius: 20 }}
            title={lastEdited ? `Last edit ${new Date(lastEdited).toLocaleString("en-GB")}` : undefined}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent }} />
            Unsynced local edits{lastEdited ? ` · ${new Date(lastEdited).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
        <nav aria-label="Administration sections" role="tablist" aria-orientation="vertical" className="adm-tabs" style={{ display: "flex", flexDirection: "column", gap: 3, overflowY: "auto", height: "100%", paddingRight: 4 }}>
          {visibleSections.map((s, idx) => {
            const on = s.id === activeId;
            return (
              <button
                key={s.id}
                ref={(el) => { tabRefs.current[s.id] = el; }}
                role="tab"
                id={`admin-tab-${s.id}`}
                aria-selected={on}
                aria-controls={`admin-panel-${s.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActiveId(s.id)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                className={`adm-tab${on ? " is-active" : ""}`}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: on ? t.accent : "transparent",
                  color: on ? "#fff" : t.ink,
                  fontFamily: fonts.body,
                  fontSize: 13,
                  fontWeight: on ? 700 : 500,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </nav>

        <div
          className="adm-panel"
          role="tabpanel"
          id={`admin-panel-${active.id}`}
          aria-labelledby={`admin-tab-${active.id}`}
          tabIndex={-1}
          style={{ minHeight: 0, height: "100%", overflowY: "auto", border: `1px solid ${t.ruleSoft}`, borderRadius: 12, padding: 18, background: `linear-gradient(168deg, ${t.paper}, ${t.themeBand})` }}
        >
          <ActiveComponent {...sectionProps} />
        </div>
      </div>
    </PageGrid>
  );
}
