import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useAuth, usePermissions } from "../auth/auth-context";
import type { PermAction } from "../auth/auth-context";
import { useReference } from "../reference/reference-context";
import type { ReferenceJson } from "../reference/reference-store";
import { PageGrid } from "../components/viz";
import { ErrorBanner, PrimaryButton, DangerButton } from "./admin/shared";
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

// ---------------------------------------------------------------------------
// api-mode conflict resolution (see src/reference/reference-context.tsx's
// `conflict`/`resolveConflict`/`pendingSync`/`retrySync` — only ever non-null/
// true in api mode; local mode never triggers any of what follows below).
// ---------------------------------------------------------------------------

interface SectionDiff {
  section: string;
  changedCount: number;
}

/** Counts entries present in one array but not the other, by structural
 *  (JSON) equality — a modified entry (same "identity" but different fields)
 *  has no separate identity key to match on here, so it counts as one removed
 *  + one added, which is fine for a magnitude-of-change summary. */
function countArrayDiff(a: unknown[], b: unknown[]): number {
  const setA = new Set(a.map((x) => JSON.stringify(x)));
  const setB = new Set(b.map((x) => JSON.stringify(x)));
  let changed = 0;
  for (const item of setA) if (!setB.has(item)) changed++;
  for (const item of setB) if (!setA.has(item)) changed++;
  return changed;
}

/** Which top-level ReferenceJson sections differ between `mine` and `theirs`,
 *  and roughly how many entries changed in each — shown in the conflict
 *  dialog so the user has some idea what they'd be discarding either way. */
function diffReferenceSections(mine: ReferenceJson, theirs: ReferenceJson): SectionDiff[] {
  const keys = new Set<string>([...Object.keys(mine), ...Object.keys(theirs)]);
  const results: SectionDiff[] = [];
  for (const key of keys) {
    if (key === "_comment") continue;
    const a = (mine as unknown as Record<string, unknown>)[key];
    const b = (theirs as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      results.push({ section: key, changedCount: countArrayDiff(a, b) });
    } else if (a && b && typeof a === "object" && typeof b === "object") {
      const subKeys = new Set<string>([...Object.keys(a as object), ...Object.keys(b as object)]);
      let changed = 0;
      for (const sk of subKeys) {
        if (JSON.stringify((a as Record<string, unknown>)[sk]) !== JSON.stringify((b as Record<string, unknown>)[sk])) changed++;
      }
      results.push({ section: key, changedCount: changed });
    } else {
      results.push({ section: key, changedCount: 1 });
    }
  }
  return results.sort((x, y) => x.section.localeCompare(y.section));
}

const CONFLICT_FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Rendered when useReference()'s `conflict` is set (api mode only — a 409 on
 * save, someone else's edit landed first). Deliberately NOT a reuse of
 * admin/shared.tsx's ConfirmDialog: that component's Esc key calls onCancel
 * (a silent "pick cancel" outcome), which is exactly wrong here — losing
 * either this browser's edit or the other editor's needs an explicit button
 * press, so Esc here only keeps the focus trap active and does nothing else.
 * There's also no neutral "cancel"/close affordance (no X button, backdrop
 * click is inert) for the same reason.
 */
function ConflictResolutionDialog({
  mine,
  theirs,
  theirsUpdatedBy,
  theirsUpdatedAt,
  onResolve,
}: {
  mine: ReferenceJson;
  theirs: ReferenceJson;
  theirsUpdatedBy: string | null;
  theirsUpdatedAt: string;
  onResolve: (strategy: "reload" | "overwrite") => void;
}) {
  const t = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  const diffs = useMemo(() => diffReferenceSections(mine, theirs), [mine, theirs]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Focuses the dialog container itself (tabIndex=-1 below) rather than
    // either action button — with no safe "default" choice between reload
    // and overwrite, auto-focusing one of them risks an accidental Enter
    // press picking it.
    dialogRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Deliberately a no-op beyond swallowing the key: an explicit choice
        // is required, so Esc must not silently resolve the conflict either way.
        e.preventDefault();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(CONFLICT_FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="conflict-dialog-title" tabIndex={-1} className="modal-dialog liquid-glass" style={{ maxWidth: 480, outline: "none" }}>
        <h2 id="conflict-dialog-title" style={{ margin: 0, fontFamily: fonts.display, fontSize: 17, fontWeight: 700, color: t.ink }}>
          Someone else changed the reference data
        </h2>
        <p style={{ margin: "10px 0", fontFamily: fonts.body, fontSize: 13, color: t.inkSoft, lineHeight: 1.5 }}>
          {theirsUpdatedBy ?? "Someone"} saved a change {new Date(theirsUpdatedAt).toLocaleString("en-GB")}, after this edit was started. You can only keep one version — choose which.
        </p>
        {diffs.length > 0 ? (
          <ul style={{ margin: "0 0 14px", padding: "0 0 0 18px", fontFamily: fonts.body, fontSize: 12.5, color: t.ink, lineHeight: 1.6 }}>
            {diffs.map((d) => (
              <li key={d.section}>
                {d.section}: {d.changedCount} {d.changedCount === 1 ? "entry differs" : "entries differ"}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: "0 0 14px", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft }}>No section-level differences detected.</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <PrimaryButton onClick={() => onResolve("reload")}>Reload theirs (discard my edit)</PrimaryButton>
          <DangerButton onClick={() => onResolve("overwrite")}>Overwrite with mine</DangerButton>
        </div>
      </div>
    </div>
  );
}

export function Admin() {
  const t = useTheme();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { reference, update, error, dirty, changelog, conflict, resolveConflict, pendingSync, retrySync } = useReference();

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
        {pendingSync && <PrimaryButton onClick={retrySync}>Retry sync</PrimaryButton>}
      </div>

      {conflict && (
        <ConflictResolutionDialog
          mine={conflict.mine}
          theirs={conflict.theirs}
          theirsUpdatedBy={conflict.theirsUpdatedBy}
          theirsUpdatedAt={conflict.theirsUpdatedAt}
          onResolve={resolveConflict}
        />
      )}

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
                  borderRadius: 6,
                  border: "none",
                  borderLeft: `3px solid ${on ? (t.spoke ?? t.accent) : "transparent"}`,
                  cursor: "pointer",
                  background: on ? `${t.ink}14` : "transparent",
                  color: t.ink,
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
          style={{ minHeight: 0, height: "100%", overflowY: "auto", borderLeft: `1px solid ${t.ruleSoft}`, padding: "2px 4px 18px 20px", background: "transparent" }}
        >
          <ActiveComponent {...sectionProps} />
        </div>
      </div>
    </PageGrid>
  );
}
