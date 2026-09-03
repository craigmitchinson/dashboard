import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { themes } from "./theme";
import type { Mode } from "./theme";
import { fonts, glassOverlayVars } from "./theme";
import { ThemeProvider, useTheme } from "./theme-context";
import { FiltersProvider, useFilters, RATE_AUTO } from "./filters-context";
import type { SavedView } from "./filters-context";
import { NavContext, NavOriginContext } from "./nav-context";
import { PAGE_LABELS } from "./page-labels";
import { FilterBar } from "./components/Slicers";
import { Portal } from "./components/Portal";
import { useAnchoredPopover } from "./components/useAnchoredPopover";
import { HeaderOverflowMenu } from "./components/HeaderOverflowMenu";
import { fmtDateFull, DATE_MAX, META, SPOKE_INFO, PROCESS_BY_ID } from "./rpaData";
import { AuthContextProvider, useAuth, usePermissions } from "./auth/auth-context";
import type { PermAction } from "./auth/auth-context";
import { DisplayPrefsProvider, useDisplayPrefs } from "./a11y/prefs-context";
import { DisplayPanel } from "./a11y/DisplayPanel";
import { Welcome } from "./a11y/Welcome";
import { Clocks } from "./a11y/Clocks";
import { ReadingRuler } from "./a11y/ReadingRuler";
import { Bionic } from "./a11y/Bionic";
import { highestRoleLabel } from "./auth/types";
import type { User } from "./auth/types";
import { Login } from "./pages/Login";
import {
  IconGrid,
  IconFlow,
  IconBars,
  IconAlert,
  IconBell,
  IconServer,
  IconCoins,
  IconValue,
  IconRefresh,
  IconChevron,
  IconGraph,
  IconRoute,
  IconAccessibility,
  IconClose,
  IconShield,
  IconBook,
  IconSun,
  IconMoon,
  IconContrastCircle,
  IconInfo,
  IconSearch,
} from "./components/icons";
import { CommandPalette } from "./components/CommandPalette";
import { NotificationBell } from "./alerts/NotificationBell";
import { AlertsProvider, useAlerts } from "./alerts/alerts-context";
import { AlertsPage } from "./alerts/AlertsPage";
import { useReference } from "./reference/reference-context";
import { useSystemStatus } from "./data/status";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Overview } from "./pages/Overview";
import { InputOutcome } from "./pages/InputOutcome";
import { ProcessAnalysis } from "./pages/ProcessAnalysis";
import { Exceptions } from "./pages/Exceptions";
import { Capacity } from "./pages/Capacity";
import { Commercial } from "./pages/Commercial";
import { ProcessDetail } from "./pages/ProcessDetail";
import { ValueFinance } from "./pages/ValueFinance";
import { DataModel } from "./pages/DataModel";
import { Playbook } from "./pages/Playbook";
import { Admin } from "./pages/Admin";

interface Page {
  id: string;
  label: string;
  group: string;
  Icon: ComponentType<{ size?: number }>;
  Component: ComponentType;
  blurb: string;
  // Gate this page behind a permission (see usePermissions()/can() in
  // auth/auth-context.tsx). Unset = visible to everyone signed in.
  // Currently used by: "admin" (view_admin) and "model"/"playbook"
  // (view_docs, admin-only reference/ops pages).
  permission?: PermAction;
  // Hide the persistent slicer bar (report__slicers / FilterBar) for this
  // page — for admin/reference/docs pages where cross-filtering doesn't
  // apply, not data-viz pages.
  noSlicers?: boolean;
  // Page-header contextual actions slot (nav/motion P1). Optional — no
  // PAGES entry below sets one yet, that's the next pass, done by each
  // page's own owner. To use it: write a small component that renders
  // ActionButton/ExportCsvButton/GrainToggle from components/PageActions.tsx
  // (keep it to the static 32px control height those already are) and set
  // it here. Rendered left of the global header chrome, right after the
  // title/blurb block — see `{page.actions && <page.actions />}` below.
  // Known limitation: it disappears below a 1200px `.report__main`
  // container width (see the `.hdr-page-actions` container-query rule in
  // styles.css) until a real overflow-menu integration for it is built —
  // HeaderOverflowMenu's flat `items: OverflowItem[]` shape doesn't
  // generically reduce an arbitrary rendered `<page.actions/>` component to
  // a menu row, so that collapse is structural-only for now.
  actions?: ComponentType;
}

const PAGES: Page[] = [
  { id: "overview", label: PAGE_LABELS.overview, group: "Overview", Icon: IconGrid, Component: Overview, blurb: "Headline performance, outcome mix and the operational watchlist" },
  { id: "alerts", label: PAGE_LABELS.alerts, group: "Overview", Icon: IconBell, Component: AlertsPage, blurb: "Threshold breaches and early warnings across the estate" },
  { id: "input-outcome", label: "Input & Outcome", group: "Operate", Icon: IconFlow, Component: InputOutcome, blurb: "Case flow in and out, by outcome, daily or monthly" },
  { id: "process", label: "Process Analysis", group: "Operate", Icon: IconBars, Component: ProcessAnalysis, blurb: "Completion time, throughput and exception trends by process" },
  { id: "exceptions", label: PAGE_LABELS.exceptions, group: "Operate", Icon: IconAlert, Component: Exceptions, blurb: "Exception heatmap and searchable detail" },
  { id: "process-detail", label: PAGE_LABELS["process-detail"], group: "Operate", Icon: IconRoute, Component: ProcessDetail, blurb: "Drill-through — one process in depth (click a process anywhere)" },
  { id: "capacity", label: PAGE_LABELS.capacity, group: "Optimise", Icon: IconServer, Component: Capacity, blurb: "Digital-worker utilisation, idle time and estate cost" },
  { id: "value", label: PAGE_LABELS.value, group: "Value", Icon: IconValue, Component: ValueFinance, blurb: "Net value, ROI, cost composition and run-rate forecast for finance and the exec" },
  { id: "commercial", label: PAGE_LABELS.commercial, group: "Value", Icon: IconCoins, Component: Commercial, blurb: "Cost per case, grade-based benefit and cumulative ROI" },
  { id: "admin", label: "Administration", group: "Manage", Icon: IconShield, Component: Admin, blurb: "Reference data, users and roles — every edit here updates the dashboards instantly", permission: "view_admin", noSlicers: true },
  { id: "model", label: "Data model", group: "Reference", Icon: IconGraph, Component: DataModel, blurb: "Architecture, star schema and the data contract under every visual", permission: "view_docs", noSlicers: true },
  { id: "playbook", label: "Playbook", group: "Reference", Icon: IconBook, Component: Playbook, blurb: "How to run, extend and troubleshoot this dashboard — plain-English operations guide", permission: "view_docs", noSlicers: true },
];

// Base localStorage key names — persisted UI state and saved views are
// namespaced per signed-in user (see keyFor below) so two people sharing a
// browser profile don't clobber each other's page/slicer/view choices.
const PERSIST = "bp-report-v2";
const VIEWS_KEY = "bp-saved-views-v1";

// Namespaced key for a base name + the current user id ("" while signed out,
// though in practice both consumers below only ever read/write once a user
// is known — see App()'s !session early-return).
function keyFor(base: string, userId: string | undefined): string {
  return userId ? `${base}::${userId}` : base;
}

// Reads a per-user JSON value, falling back to the legacy un-namespaced key
// the first time a given user has no namespaced value of their own yet.
// Writes always go to the namespaced key only — the legacy key is never
// deleted (other logic may still reference it) and never written again once
// a namespaced key exists.
function readNamespaced<T>(base: string, userId: string | undefined, fallback: T): T {
  try {
    const raw = localStorage.getItem(keyFor(base, userId)) ?? localStorage.getItem(base);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Exported for CommandPalette.tsx's "Saved views" group — ViewsMenu below
// already calls this unqualified in the same file, so exporting it is a
// safe, additive change.
export function loadViews(userId: string | undefined): SavedView[] {
  return readNamespaced<SavedView[]>(VIEWS_KEY, userId, []);
}

export default function App() {
  return (
    <AuthContextProvider>
      <AppShell />
    </AuthContextProvider>
  );
}

// Signed-out branch renders Login inside a fixed dark ThemeProvider (there's
// no persisted theme preference to read before someone's signed in). Once
// signed in, the existing FiltersProvider/ThemedReport tree mounts fresh —
// so every piece of per-user state below (pageId, collapsed, saved views)
// is computed at that fresh mount, already knowing which user is signed in.
function AppShell() {
  const { session, user } = useAuth();

  if (!session) {
    return (
      <ThemeProvider value={themes.dark}>
        <Login />
      </ThemeProvider>
    );
  }

  return (
    // key={user?.id} so DisplayPrefsProvider re-initializes (fresh localStorage
    // read) across a user change, mirroring the remount-per-user idiom used
    // for FiltersProvider's saved views elsewhere in this file.
    <DisplayPrefsProvider key={user?.id} userId={user?.id}>
      <FiltersProvider>
        <ThemedReport />
      </FiltersProvider>
    </DisplayPrefsProvider>
  );
}

// The active spoke gets its own identity colour via `t.spoke` — it no longer
// overrides `accent`/`accentSoft` (that silently recoloured every
// accent-reading control across the whole app, including ones never audited
// against the brand red's contrast pairing, to an arbitrary spoke hex — a
// WCAG failure caught in the design audit, §1.3). Consumers that want spoke
// identity (this file's nav active state; admin tabs/buttons/KPI accents in
// the pages half of this pass) read `t.spoke ?? t.accent` explicitly instead.
function ThemedReport() {
  const { filters } = useFilters();
  const { prefs } = useDisplayPrefs();
  // High-contrast is a black/white CSS overlay (see styles.css) layered on top
  // of the dark-mode JS tokens — there is no separate "high-contrast" Mode in
  // theme.ts, so it maps to "dark" here for token/spoke-colour purposes.
  const mode: Mode = prefs.theme === "light" ? "light" : "dark";
  const spokeColor = filters.spoke !== "All" ? SPOKE_INFO[filters.spoke]?.[mode === "dark" ? "dark" : "light"] : undefined;
  const base = themes[mode];
  const theme = spokeColor ? { ...base, spoke: spokeColor } : base;
  // Ambient accent: the active spoke colour, consumed by `.report`'s first
  // radial-gradient layer (styles.css) — undefined (no spoke) resolves to
  // that rule's own `transparent` fallback, so the hub view still gets the
  // brand-teal + warm ambient layers with no spoke tint. Alpha is high
  // enough (20% light / 24% dark) and that layer's radius large enough to
  // read as tinting the whole room once a spoke is selected, not just a
  // corner glow — liquid glass needs a real, present backdrop to refract.
  const ambientAccent = spokeColor ? `color-mix(in srgb, ${spokeColor} ${mode === "dark" ? "24%" : "20%"}, transparent)` : undefined;

  useEffect(() => {
    document.body.style.background = theme.page;
    document.title = "Intelligent Automation — Performance";
  }, [theme.page]);

  return (
    <ThemeProvider value={theme}>
      <AlertsProvider>
        <Report ambientAccent={ambientAccent} />
      </AlertsProvider>
    </ThemeProvider>
  );
}

// Saved views: named slicer/rate/page bookmarks, per user (localStorage today;
// swap the two load/save helpers for an API call when views move server-side).
function ViewsMenu({ pageId, setPageId }: { pageId: string; setPageId: (id: string) => void }) {
  const t = useTheme();
  const { filters, peopleRate, applyView } = useFilters();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(user?.id));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Write-through migration: the first time a signed-in user has no
  // namespaced saved-views entry of their own yet, persist whatever we just
  // read (their own list if they already have one, else the legacy shared
  // fallback, else []) to their namespaced key immediately — mirroring what
  // Report's PERSIST effect already does for pageId/collapsed. Without this,
  // a user who never saves/deletes a view would keep reading the shared
  // un-namespaced legacy blob forever, and two such users would silently
  // see the exact same stale pre-auth views list. ViewsMenu remounts fresh
  // per signed-in user (Report unmounts/remounts across sign-out/sign-in),
  // so this only needs to run once per mount, not on every views change.
  useEffect(() => {
    const key = keyFor(VIEWS_KEY, user?.id);
    try {
      if (localStorage.getItem(key) == null) {
        localStorage.setItem(key, JSON.stringify(views));
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Portal + useAnchoredPopover (§3): the panel is no longer a DOM
  // descendant of `box`, so outside-click detection checks both the trigger
  // AND the (portalled) panel now — previously `box` wrapped both as
  // siblings and a single `.contains()` check covered the whole widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Esc closes + returns focus to the trigger; arrow keys move focus among
  // the popover's buttons (with wraparound), matching a standard menu widget.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const buttons = Array.from(panelRef.current?.querySelectorAll("button") ?? []);
      if (!buttons.length) return;
      e.preventDefault();
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // On open, move focus to the first focusable element inside the popover.
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector("button")?.focus();
    }
  }, [open]);

  const close = () => setOpen(false);
  const anchorStyle = useAnchoredPopover(triggerRef, open, close, { align: "end", width: 262 });

  const persist = (v: SavedView[]) => {
    setViews(v);
    try {
      localStorage.setItem(keyFor(VIEWS_KEY, user?.id), JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };

  const saveCurrent = () => {
    const nm = name.trim() || `View ${views.length + 1}`;
    persist([...views.filter((v) => v.name !== nm), { name: nm, filters, peopleRate, pageId, savedAt: new Date().toISOString() }]);
    setName("");
    setNaming(false);
  };

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="bar-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Views${views.length ? `, ${views.length} saved` : ""}`}
        style={btn(t)}
      >
        <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>☆</span>
        {/* Full label >=1400px container width; icon+count compact form
            below that — see the .hdr-views-* container queries in
            styles.css. Kept inline (not collapsed into the ⋯ overflow menu
            like accessibility/theme) even below 1040px — see the deviation
            note on `.hdr-overflow-trigger` in styles.css. */}
        <span className="hdr-views-full">Views{views.length ? ` (${views.length})` : ""}</span>
        <span className="hdr-views-compact" aria-hidden>{views.length || ""}</span>
      </button>
      {open && anchorStyle && (
        <Portal>
          <div ref={panelRef} className="dropdown-panel glass-overlay" style={{ ...anchorStyle, zIndex: "var(--z-popover)" as unknown as number, border: `1px solid ${t.ruleSoft}`, padding: 6, ...glassOverlayVars(t) }}>
          {views.length === 0 && (
            <div style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, padding: "8px 9px", textTransform: "none", letterSpacing: 0 }}>
              <Bionic>No saved views yet. Set your spoke and slicers, then save them as a named view.</Bionic>
            </div>
          )}
          {views.map((v) => (
            <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => {
                  applyView(v);
                  if (v.pageId) setPageId(v.pageId);
                  setOpen(false);
                }}
                style={{ flex: 1, minWidth: 0, textAlign: "left", fontFamily: fonts.body, fontSize: 13, textTransform: "none", letterSpacing: 0, padding: "7px 9px", borderRadius: 7, border: "none", background: "transparent", color: t.ink, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = t.themeBand)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                title={`${v.filters.spoke !== "All" ? v.filters.spoke + " · " : ""}saved ${new Date(v.savedAt).toLocaleDateString("en-GB")}`}
              >
                {v.name}
                <span style={{ display: "block", fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft, fontWeight: 400 }}>
                  {v.filters.spoke === "All" ? "Hub-wide" : v.filters.spoke}
                  {v.filters.processId !== "All" ? " · 1 process" : ""}
                </span>
              </button>
              <button onClick={() => persist(views.filter((x) => x.name !== v.name))} title="Delete view" style={{ border: "none", background: "transparent", color: t.inkSoft, cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>
                ×
              </button>
            </div>
          ))}
          <div style={{ borderTop: views.length ? `1px solid ${t.ruleSoft}` : "none", marginTop: views.length ? 5 : 0, paddingTop: 5 }}>
            {naming ? (
              <div style={{ display: "flex", gap: 6, padding: "2px 2px" }}>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
                  placeholder="View name…"
                  style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13, padding: "6px 8px", borderRadius: 7, border: `1px solid ${t.ruleSoft}`, background: t.themeBand, color: t.ink, outline: "none" }}
                />
                <button onClick={saveCurrent} style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", padding: "6px 10px", borderRadius: 7, border: "none", background: t.accentFill, color: "#fff", cursor: "pointer" }}>
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNaming(true)}
                style={{ width: "100%", textAlign: "left", fontFamily: fonts.body, fontSize: 13, textTransform: "none", letterSpacing: 0, padding: "7px 9px", borderRadius: 7, border: "none", background: "transparent", color: t.accent, cursor: "pointer", fontWeight: 700 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = t.themeBand)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                + Save current view
              </button>
            )}
          </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// Header user chip: name + highest-role badge, opens a small dropdown with
// "Sign out" — same visual idiom as ViewsMenu's dropdown (portalled panel
// anchored under the trigger, closes on outside click). `extra` renders the
// greeting+clocks (Welcome/Clocks) at the top of the popover once the header
// container drops below 1400px — see Report()'s `headerCompactGreeting`.
function UserMenu({ user, signOut, extra }: { user: User; signOut: () => void; extra?: ReactNode }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Esc closes + returns focus to the trigger; arrow keys move focus among
  // the popover's buttons (with wraparound), matching a standard menu widget.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const buttons = Array.from(panelRef.current?.querySelectorAll("button") ?? []);
      if (!buttons.length) return;
      e.preventDefault();
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // On open, move focus to the first focusable element inside the popover.
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector("button")?.focus();
    }
  }, [open]);

  const close = () => setOpen(false);
  const anchorStyle = useAnchoredPopover(triggerRef, open, close, { align: "end", width: 220 });

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="bar-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${user.name}, ${highestRoleLabel(user.roles)}`}
        style={{ ...btn(t), gap: 7, color: t.ink, textTransform: "none", letterSpacing: 0, padding: "0 12px 0 5px" }}
      >
        <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", background: t.accentFill, color: "#fff", fontFamily: fonts.mono, fontSize: 10, fontWeight: 700, flex: "0 0 auto" }}>
          {user.name.charAt(0).toUpperCase()}
        </span>
        {/* Full name+role >=1040px container width; avatar-only below that —
            see the .hdr-user-* container queries in styles.css. */}
        <span className="hdr-user-name" style={{ fontFamily: fonts.body, fontWeight: 600 }}>{user.name}</span>
        <span className="hdr-user-role" style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft }}>{highestRoleLabel(user.roles)}</span>
      </button>
      {open && anchorStyle && (
        <Portal>
          <div ref={panelRef} className="dropdown-panel glass-overlay" style={{ ...anchorStyle, zIndex: "var(--z-popover)" as unknown as number, border: `1px solid ${t.ruleSoft}`, padding: 6, ...glassOverlayVars(t) }}>
            {extra && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 9px 9px", borderBottom: `1px solid ${t.ruleSoft}`, marginBottom: 4 }}>
                {extra}
              </div>
            )}
            <div style={{ padding: "7px 9px", fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, borderBottom: `1px solid ${t.ruleSoft}`, marginBottom: 4 }}>{user.email}</div>
            <button
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              style={{ width: "100%", textAlign: "left", fontFamily: fonts.body, fontSize: 13, padding: "7px 9px", borderRadius: 7, border: "none", background: "transparent", color: t.accent, cursor: "pointer", fontWeight: 700 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = t.themeBand)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Sign out
            </button>
          </div>
        </Portal>
      )}
    </div>
  );
}

// One collapsed-nav item: the nav button plus its custom tooltip (role=
// tooltip, hover + focus, replacing the native `title` attribute — §5). The
// tooltip bubble is Portal-rendered to document.body, NOT a CSS `.tip__bubble`
// positioned relative to the button in-place — `<nav>` (App.tsx's Report())
// is `overflow-y:auto` for its own scrolling, and a mismatched overflow-x
// stays a clipping box in every major engine despite being set to "visible"
// (the visible/non-visible-axis quirk), so an in-place absolutely-positioned
// bubble would get silently clipped at the nav's right edge. A tiny
// hover/focus-driven position capture sidesteps that entirely.
function NavItem({ collapsed, on, label, Icon, showBadge, badgeCount, onClick, isActiveRef }: {
  collapsed: boolean;
  on: boolean;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  showBadge: boolean;
  badgeCount: number;
  onClick: () => void;
  isActiveRef: (el: HTMLButtonElement | null) => void;
}) {
  const t = useTheme();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const tipId = useRef(`nav-tip-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (!collapsed) {
      setTipPos(null);
      return;
    }
    const el = btnRef.current;
    if (!el) return;
    const show = () => {
      const r = el.getBoundingClientRect();
      setTipPos({ top: r.top + r.height / 2, left: r.right + 8 });
    };
    const hide = () => setTipPos(null);
    el.addEventListener("mouseenter", show);
    el.addEventListener("mouseleave", hide);
    el.addEventListener("focus", show);
    el.addEventListener("blur", hide);
    return () => {
      el.removeEventListener("mouseenter", show);
      el.removeEventListener("mouseleave", hide);
      el.removeEventListener("focus", show);
      el.removeEventListener("blur", hide);
    };
  }, [collapsed]);

  return (
    <>
      <button
        ref={(el) => {
          (btnRef as { current: HTMLButtonElement | null }).current = el;
          isActiveRef(el);
        }}
        onClick={onClick}
        aria-current={on ? "page" : undefined}
        aria-describedby={collapsed ? tipId : undefined}
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
          background: "transparent",
          color: t.ink,
          fontFamily: fonts.body,
          fontSize: 13.5,
          fontWeight: on ? 700 : 500,
          position: "relative",
        }}
      >
        <Icon size={18} />
        {!collapsed && <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
        {showBadge && (
          <span
            aria-hidden
            className="nav-badge"
            style={{
              background: on ? t.paper : t.accentFill,
              color: on ? t.ink : "#fff",
              ...(collapsed ? { position: "absolute", top: 4, right: 4 } : { marginLeft: "auto" }),
            }}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
        {showBadge && <span className="sr-only">, {badgeCount} unacknowledged</span>}
      </button>
      {collapsed && tipPos && (
        <Portal>
          <span
            role="tooltip"
            id={tipId}
            style={{
              position: "fixed",
              top: tipPos.top,
              left: tipPos.left,
              transform: "translateY(-50%)",
              zIndex: "var(--z-popover)" as unknown as number,
              transitionDuration: "60ms",
              pointerEvents: "none",
              display: "block",
              background: t.paper,
              color: t.ink,
              border: `1px solid ${t.ruleSoft}`,
              borderRadius: 7,
              padding: "5px 9px",
              fontFamily: fonts.body,
              fontSize: 12,
              boxShadow: t.shadow,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        </Portal>
      )}
    </>
  );
}

// Keyboard shortcuts: a single registry entry drives both the global keydown
// handler and the cheat-sheet dialog's rendered list, so the two can never
// drift out of sync.
interface ShortcutEntry {
  keys: string; // display label, e.g. "Alt+1"
  description: string;
  test: (e: KeyboardEvent) => boolean;
  run: () => void;
}

// True when motion should be skipped: either the OS-level media query or the
// in-app "Reduce motion" override (data-reduce-motion="true" on <html>, set
// by DisplayPrefsProvider — see src/a11y/prefs-context.tsx). Mirrors the two
// conditions every animated CSS class in styles.css is already gated behind.
function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.getAttribute("data-reduce-motion") === "true"
  );
}

// Page-transition crossfade buffer (nav/motion P1). `.anim-up` (styles.css)
// already gives every page an "incoming fade+rise" on mount via React's
// key={page.id} swap — what it can't give is an "outgoing fade" for the OLD
// page, since a key change unmounts it instantly with no chance to animate
// out. This holds the previous page on screen for --d-fast (120ms) behind a
// `.page-leaving` opacity transition before swapping to the new one.
function PageTransition({ page }: { page: Page }) {
  const [shown, setShown] = useState(page);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (page.id === shown.id) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (prefersReducedMotion()) {
      setShown(page);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    // 120ms == --d-fast — keep in sync with that CSS token and with
    // .page-leaving's own transition-duration in styles.css.
    timerRef.current = setTimeout(() => {
      setShown(page);
      setLeaving(false);
    }, 120);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const ShownComponent = shown.Component;
  return (
    <div className={leaving ? "page-leaving" : undefined} style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ErrorBoundary resetKey={shown.id} label="This page">
        <ShownComponent key={shown.id} />
      </ErrorBoundary>
    </div>
  );
}

function Report({ ambientAccent }: { ambientAccent?: string }) {
  const t = useTheme();
  const { reset, filters, setFilters, peopleRate, applyView } = useFilters();
  const { user, signOut } = useAuth();
  const { can } = usePermissions();
  const { unackedCount, sortedAlerts, acked, ackAll } = useAlerts();
  const { pendingSync } = useReference();
  const systemStatus = useSystemStatus();
  const { prefs, cycleTheme } = useDisplayPrefs();
  // High-contrast is a black/white CSS overlay (see styles.css) layered on top
  // of the dark-mode JS tokens — there is no separate "high-contrast" Mode in
  // theme.ts, so it maps to "dark" here for token/spoke-colour purposes.
  const mode: Mode = prefs.theme === "light" ? "light" : "dark";
  const warnDot = t.status.warn;
  const persistKey = keyFor(PERSIST, user?.id);
  const [pageId, setPageId] = useState<string>(() => readNamespaced(PERSIST, user?.id, {} as { pageId?: string; collapsed?: boolean }).pageId ?? "overview");
  const [collapsed, setCollapsed] = useState<boolean>(() => readNamespaced(PERSIST, user?.id, {} as { pageId?: string; collapsed?: boolean }).collapsed ?? false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showA11yPanel, setShowA11yPanel] = useState(false);
  // Command palette (nav/motion P1). Report() owns this state and passes
  // everything CommandPalette needs down as props — see that component's
  // file header for why (mirrors ViewsMenu/UserMenu's pageId/setPageId
  // props rather than a new context).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const cmdkFullRef = useRef<HTMLButtonElement>(null);
  const cmdkIconRef = useRef<HTMLButtonElement>(null);
  // Only one of the full/icon-label trigger buttons is ever visible at a
  // given `.report__main` container width (see the .hdr-cmdk-full/
  // .hdr-cmdk-icon container queries in styles.css, toggled via display:none
  // — both stay mounted). A getter-based ref always reads whichever one is
  // currently on-screen, so the coach mark (anchored via useAnchoredPopover
  // inside CommandPalette) positions correctly regardless of header width.
  const cmdkTriggerRef = useMemo<{ current: HTMLElement | null }>(
    () => ({
      get current() {
        return cmdkFullRef.current?.offsetParent != null ? cmdkFullRef.current : cmdkIconRef.current;
      },
    }),
    []
  );
  // mainRef is the .report__canvas element — the scroll container as of the
  // scroll-model rework (see styles.css's .report__main comment) — used both
  // for the skip-link focus target and the scroll listener below.
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [navOrigin, setNavOrigin] = useState<string | null>(null);

  // Sliding nav active-state indicator (§4): one shared absolutely-positioned
  // bar, repositioned to the active item's offset within the nav list rather
  // than rendered per-button, so it can visibly slide between items. Nav is
  // `position:relative` (see the aside JSX) so offsetTop/offsetHeight are
  // already relative to it, scroll-position included, with no extra math.
  const navListRef = useRef<HTMLElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const [barRect, setBarRect] = useState<{ top: number; height: number } | null>(null);

  // Drill-through origin + browser Back support (§5). setPageId already
  // flows through NavContext unchanged (other-owned pages call it as a plain
  // `(id) => void` — see nav-context.ts's file header for why that contract
  // is preserved) — `go` wraps it here, transparently, so origin-tracking
  // and history both work regardless of whether navigation came from a
  // nav-item click or a page's own useNav() call.
  const go = (id: string) => {
    setPageId((prev) => {
      if (prev !== id) setNavOrigin(prev);
      return id;
    });
  };
  // `isPopRef` skips the push below when a page change came FROM popstate
  // (the browser Back/Forward buttons already moved the history pointer —
  // pushing again there would stack a duplicate entry and break Forward).
  const isPopRef = useRef(false);
  useEffect(() => {
    if (isPopRef.current) {
      isPopRef.current = false;
      return;
    }
    try {
      window.history.pushState({ pageId }, "", window.location.pathname + window.location.search);
    } catch {
      /* ignore (e.g. sandboxed iframe) */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const id = (e.state as { pageId?: string } | null)?.pageId;
      if (id) {
        isPopRef.current = true;
        setPageId(id);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navOriginValue = useMemo(
    () => ({ from: navOrigin, back: () => { if (navOrigin) setPageId(navOrigin); } }),
    [navOrigin],
  );

  // Header priority collapse (§2): most breakpoints are pure CSS container
  // queries against `.report__main` (see styles.css) — the one exception is
  // greeting+clocks relocating into the user-menu popover below 1400px,
  // which can't be a container query because the destination (UserMenu's
  // portalled panel) isn't a DOM descendant of the container being queried.
  // ResizeObserver drives that one relocation at the same threshold instead.
  const [headerCompactGreeting, setHeaderCompactGreeting] = useState(false);
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const w = rect?.width ?? el.clientWidth;
      setHeaderCompactGreeting(w < 1400);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // will-change on the persistent glass surfaces only while `.report__canvas`
  // (the scroll container — see the scroll-model comment on .report__main in
  // styles.css) is actively scrolling (cleared 150ms after the last scroll
  // event) — see the .glass-persistent comment in styles.css. Also drives the
  // band's shadow-on-scroll, off the canvas's own scrollTop — the band itself
  // (`.report__top`) is a plain, never-scrolling flex child; only the canvas
  // beneath it scrolls, so its structure/padding can never scroll away.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      navRef.current?.classList.add("is-scrolling");
      topRef.current?.classList.add("is-scrolling");
      // Band shadow (nav/motion P1): tracks scrollTop live, on every scroll
      // event — unlike is-scrolling above, this is NOT idle-debounced.
      topRef.current?.classList.toggle("report__top--shadow", el.scrollTop > 8);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        navRef.current?.classList.remove("is-scrolling");
        topRef.current?.classList.remove("is-scrolling");
      }, 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  // Pages gated behind a permission (e.g. Admin behind view_admin, Playbook
  // and Data Model behind view_docs — see the Page.permission comment) drop
  // out of the nav entirely for a user who can't view them.
  const visiblePages = PAGES.filter((p) => !p.permission || can(p.permission));
  const page = visiblePages.find((p) => p.id === pageId) ?? visiblePages[0];

  // Recomputed whenever the active item might have moved: page change,
  // collapse toggle, or the visible-page set itself changing (e.g. a
  // permission change altering the group layout above it). Deliberately
  // dependency-gated rather than run-after-every-render-unconditionally —
  // an earlier version relied on returning the SAME object reference from
  // the setState updater to make an unconditional (no-deps) effect safe,
  // which is the textbook pattern, but empirically still produced a real
  // "Maximum update depth exceeded" loop at a fractional `zoom` text-scale
  // (115%/130% — confirmed via the P0 acceptance harness) even though the
  // updater verifiably always returned the prior reference once stable —
  // i.e. something about a zoomed layout pass appears to defeat React's
  // eager-bailout optimisation for a same-value functional update fired
  // from a no-deps useLayoutEffect. Gating on real dependencies sidesteps
  // that class of risk entirely rather than depending on the optimisation.
  useLayoutEffect(() => {
    const el = activeItemRef.current;
    if (!el) return;
    // Rounded to whole pixels — purely cosmetic insurance against subpixel
    // jitter under `zoom`, not load-bearing for the loop above (which is
    // now prevented by the dependency array instead).
    setBarRect({ top: Math.round(el.offsetTop), height: Math.round(el.offsetHeight) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, collapsed, visiblePages.length]);

  useEffect(() => {
    try {
      localStorage.setItem(persistKey, JSON.stringify({ pageId, collapsed }));
    } catch {
      /* ignore */
    }
  }, [pageId, collapsed, persistKey]);

  // Self-correct a persisted pageId that no longer resolves to a visible
  // page (e.g. a future permissioned page the user has lost access to) so
  // nav highlighting and the persisted id both settle back onto a real page
  // instead of silently falling back only for rendering.
  useEffect(() => {
    if (!visiblePages.some((p) => p.id === pageId) && visiblePages[0]) {
      setPageId(visiblePages[0].id);
    }
  }, [pageId, visiblePages]);

  const activeFilters =
    (filters.spoke !== "All" ? 1 : 0) +
    (filters.proposition !== "All" ? 1 : 0) +
    (filters.processId !== "All" ? 1 : 0) +
    (filters.queue !== "All" ? 1 : 0) +
    (filters.tags.length ? 1 : 0) +
    (filters.range !== 90 ? 1 : 0) +
    (peopleRate !== RATE_AUTO ? 1 : 0);

  const groups = Array.from(new Set(visiblePages.map((p) => p.group)));

  // Single shortcuts registry, consumed by both the keydown handler below and
  // the cheat-sheet dialog's rendered list, so they can never drift apart.
  const shortcuts: ShortcutEntry[] = useMemo(
    () => [
      { keys: "?", description: "Show keyboard shortcuts", test: (e) => e.key === "?", run: () => setShowShortcuts(true) },
      // The real Ctrl/Cmd+K handler lives outside this registry, in the
      // keydown effect below — it must fire even while typing in an input
      // (this array's entries are all skipped while typing, see that
      // effect's `typing` guard), so `test` here is inert. ShortcutsDialog
      // only ever renders `.keys`/`.description` off this array — it never
      // calls `.test`/`.run` — so a dummy `test` is safe: this entry exists
      // purely so the cheat-sheet lists the shortcut.
      { keys: "⌘K / Ctrl+K", description: "Open the command palette", test: () => false, run: () => {} },
      { keys: "Shift+A", description: "Open Accessibility & display settings", test: (e) => e.shiftKey && e.key.toLowerCase() === "a", run: () => setShowA11yPanel(true) },
      { keys: "/", description: "Focus the first slicer (Spoke)", test: (e) => e.key === "/", run: () => { if (!page?.noSlicers) (document.querySelector('[data-first-slicer="true"]') as HTMLElement | null)?.focus(); } },
      { keys: "[", description: "Toggle navigation collapse", test: (e) => e.key === "[", run: () => setCollapsed((c) => !c) },
      { keys: "Esc", description: "Close the shortcuts list", test: (e) => e.key === "Escape", run: () => setShowShortcuts(false) },
      ...visiblePages.slice(0, 9).map((p, i) => ({
        keys: `Alt+${i + 1}`,
        description: `Go to ${p.label}`,
        test: (e: KeyboardEvent) => e.altKey && e.key === String(i + 1),
        run: () => go(p.id),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiblePages, collapsed, page]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the shortcuts cheat-sheet or the Accessibility & display panel
      // is open, that dialog owns the keyboard (it has its own focus trap and
      // Escape handling) — global shortcuts like Alt+1..9 or "/" must not
      // reach through the modal and change the page/focus behind it.
      if (showA11yPanel || showShortcuts) return;
      // Command palette trigger (nav/motion P1): registered directly here,
      // not through the `shortcuts` registry above, and checked BEFORE the
      // `typing` early-return below — Ctrl/Cmd+K must open the palette even
      // while focus is inside an input/textarea/select (that early-return
      // exists to protect ordinary text entry from single-key shortcuts
      // like "?" or "/", which a modifier chord like this never collides
      // with).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      // Alt+1..9 (below) must keep working even while the command palette's
      // own search input has focus (a real INPUT element, which the
      // `typing` gate above would otherwise block every shortcut behind).
      // Scoped to `paletteOpen` specifically, NOT a blanket "any Alt-chord
      // bypasses typing everywhere" rule: e.altKey is also true for AltGr on
      // many European keyboard layouts (Windows reports it as Ctrl+Alt), so
      // a global bypass would let AltGr-typed characters in an ordinary
      // text field (e.g. "@" on a German layout) accidentally trigger page
      // navigation. Every OTHER registry entry above (?, Shift+A, /, [, Esc)
      // stays fully blocked while typing, unchanged, in every context.
      if (typing && !(paletteOpen && e.altKey)) return;
      for (const s of shortcuts) {
        if (s.test(e)) {
          e.preventDefault();
          s.run();
          return;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcuts, showA11yPanel, showShortcuts, paletteOpen]);

  // Hardening: every render below this point assumes `page` exists. It
  // normally always does (Overview/Alerts/etc. carry no permission gate at
  // all), but a role with no visible pages at all must render an empty
  // state rather than crash on `page.Component`/`page.label`/etc. This check
  // MUST come after every hook above (all of which must run unconditionally
  // on every render, per the Rules of Hooks) rather than as an early return
  // above them — an early return before a hook call would change how many
  // hooks run between renders (e.g. if a live permission change, via
  // refreshSession(), makes visiblePages empty on an already-mounted Report).
  if (!page) {
    return (
      <div className="report" data-mode={mode} style={{ backgroundColor: t.page, color: t.ink, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 360 }}>
          <p style={{ fontFamily: fonts.display, fontSize: 18, color: t.ink, marginBottom: 6 }}>No pages available</p>
          <p style={{ fontFamily: fonts.body, fontSize: 13, color: t.inkSoft, margin: 0 }}>
            Your account doesn't have access to any dashboard page. Contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      {/* backgroundColor, NOT the `background` shorthand — the shorthand
          resets every other background-* longhand (including
          background-image) to its initial value, and an inline style always
          wins over `.report`'s own CSS background-image rule (styles.css)
          regardless of specificity. Setting the shorthand here was silently
          killing the whole ambient-gradient effect: it computed to `none` no
          matter what the CSS said. */}
      <div className="report" data-mode={mode} style={{ backgroundColor: t.page, color: t.ink, ["--ink" as string]: t.ink, ...(ambientAccent ? { ["--ambient-accent" as string]: ambientAccent } : {}) }}>
        <div aria-live="polite" className="sr-only">
          {page.label} page loaded. {activeFilters} filter{activeFilters === 1 ? "" : "s"} active.
        </div>
        <ReadingRuler />
        {/* ---- left navigation ---- */}
        <aside ref={navRef} className="report__nav glass-persistent" style={{ width: collapsed ? 62 : 232, borderRight: `1px solid ${t.ruleSoft}` }}>
          <div className="report__brand" style={{ borderBottom: `1px solid ${t.ruleSoft}` }}>
            <span style={{ position: "relative", display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: t.accentFill, color: "#fff", flex: "0 0 auto", fontFamily: fonts.display, fontWeight: 700, fontSize: 17 }}>
              IA
              {/* Spoke dot under the brand mark when a spoke is active, even
                  collapsed — the only spoke-identity cue left once the label
                  (and its own dot, below) is hidden by collapse. */}
              {collapsed && filters.spoke !== "All" && (
                <span aria-hidden style={{ position: "absolute", bottom: -2, right: -2, width: 8, height: 8, borderRadius: "50%", background: t.spoke ?? t.accent, border: `1.5px solid ${t.paper}` }} />
              )}
            </span>
            {!collapsed && (
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: fonts.display, fontSize: 13, fontWeight: 700, lineHeight: 1.15, color: t.ink }}>Intelligent Automation</span>
                {/* brand sub-label carries the active spoke identity + its colour */}
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: filters.spoke !== "All" ? t.spoke ?? t.accent : t.inkSoft, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {filters.spoke !== "All" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.spoke ?? t.accent, flex: "0 0 auto" }} />}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{filters.spoke !== "All" ? SPOKE_INFO[filters.spoke]?.short ?? filters.spoke : "IA CoE · Hub view"}</span>
                </span>
              </span>
            )}
          </div>

          <nav ref={navListRef} aria-label="Pages" style={{ flex: 1, overflow: "auto", padding: "10px 8px", position: "relative" }}>
            <div
              aria-hidden
              className="nav-active-bar"
              style={{ top: barRect?.top ?? 0, height: barRect?.height ?? 0, opacity: barRect ? 1 : 0, background: t.spoke ?? t.accent }}
            />
            {groups.map((g, gi) => (
              <div key={g} style={{ marginBottom: 10 }}>
                {collapsed && gi > 0 && <div style={{ borderTop: `1px solid ${t.ruleSoft}`, margin: "6px 8px 8px" }} />}
                {!collapsed && <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: t.inkSoft, padding: "6px 10px 4px", opacity: 0.8 }}>{g}</div>}
                {visiblePages.filter((p) => p.group === g).map((p) => {
                  const on = p.id === pageId;
                  const isAlerts = p.id === "alerts";
                  const showBadge = isAlerts && unackedCount > 0;
                  // process-detail (the drill-through page) shows the drilled
                  // process's name instead of its generic label once a drill
                  // is active, so the nav itself previews where "back" leads.
                  const activeProcess = p.id === "process-detail" && filters.processId !== "All" ? PROCESS_BY_ID.get(filters.processId)?.name : undefined;
                  const label = activeProcess ?? p.label;
                  return (
                    <NavItem
                      key={p.id}
                      collapsed={collapsed}
                      on={on}
                      label={label}
                      Icon={p.Icon}
                      showBadge={showBadge}
                      badgeCount={unackedCount}
                      onClick={() => go(p.id)}
                      isActiveRef={(el) => {
                        if (on) activeItemRef.current = el;
                      }}
                    />
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
          {/* Glass band: header + slicer bar, a plain (never-sticky) flex
              child of `.report__main` — its padding/structure can never
              scroll away. `.report__canvas` below is the actual scroll
              container (see styles.css). `.report__main` is also the
              container-query root for the header's priority collapse. */}
          <div ref={topRef} className="report__top glass-persistent">
          <header className="report__header" style={{ borderBottom: `1px solid ${t.ruleSoft}` }}>
            {/* Title + blurb share one baseline row (blurb truncates first) so
                the header fits the shared --header-h band. h1 has a fixed
                160px floor (styles.css) and never truncates. */}
            <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 10, overflow: "hidden" }}>
              <h1 style={{ margin: 0, fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: t.ink, lineHeight: 1.1, whiteSpace: "nowrap" }}>{page.label}</h1>
              <p className="hdr-blurb-text" style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                <Bionic>{page.blurb}</Bionic>
              </p>
            </div>
            {/* <1680px container width: the blurb collapses to an info
                tooltip rather than disappearing outright. Kept OUTSIDE the
                title row above (that row's own overflow:hidden, needed for
                the blurb's text-overflow:ellipsis, would otherwise clip this
                tooltip's popup). */}
            <span className="tip hdr-blurb-tip" tabIndex={0} aria-label={page.blurb} style={{ color: t.inkSoft, flex: "0 0 auto", cursor: "help" }}>
              <IconInfo size={15} />
              <span role="tooltip" className="tip__bubble tip__bubble--below" style={{ left: 0, transform: "none", transitionDuration: "60ms" }}>
                <span style={{ display: "block", background: t.paper, color: t.ink, border: `1px solid ${t.ruleSoft}`, borderRadius: 7, padding: "7px 10px", fontFamily: fonts.body, fontSize: 12, boxShadow: t.shadow }}>
                  {page.blurb}
                </span>
              </span>
            </span>
            {/* Page-header contextual actions slot (nav/motion P1) — see the
                Page.actions field's doc comment above. Sits left, grouped
                with the title, not with the global chrome to the right of
                the spacer below. */}
            {page.actions && (
              <span className="hdr-page-actions">
                <page.actions />
              </span>
            )}
            <div style={{ flex: 1 }} />
            {/* Right cluster: data-freshness pill · greeting · clocks — each a
                SINGLE line, centre-aligned in the 56px band, separated by
                hairline dividers. Detail (source, build time, full date,
                season) lives in tooltips, not extra visual lines. */}
            <span
              className="hdr-fresh-full"
              style={{ alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.04em", color: t.inkSoft, whiteSpace: "nowrap" }}
              title={
                systemStatus.apiOk
                  ? `Data through ${fmtDateFull(DATE_MAX)} · Source: ${META.source} · ${META.sourceRows.toLocaleString()} queue items · built ${META.generatedAt.slice(0, 16).replace("T", " ")}`
                  : "API unreachable — showing last loaded data"
              }
            >
              {/* Colour-only state change (same 6px dot, same position in every
                  theme): amber when the API health poll is failing, the
                  usual status colour otherwise — see src/data/status.tsx. */}
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: systemStatus.apiOk ? t.status.committed.dot : warnDot, flex: "0 0 auto" }} className="pulse-soft" />
              Data to {fmtDateFull(DATE_MAX)} · {META.sourceRows.toLocaleString()}
            </span>
            {/* <1040px: the pill collapses to a dot + tooltip (same info, on hover/focus). */}
            <span
              className="hdr-fresh-dot"
              aria-label={`Data to ${fmtDateFull(DATE_MAX)}, ${META.sourceRows.toLocaleString()} queue items`}
              title={systemStatus.apiOk ? `Data through ${fmtDateFull(DATE_MAX)} · ${META.sourceRows.toLocaleString()} queue items` : "API unreachable — showing last loaded data"}
              style={{ alignItems: "center" }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: systemStatus.apiOk ? t.status.committed.dot : warnDot, flex: "0 0 auto" }} className="pulse-soft" />
            </span>
            {pendingSync && (
              <span
                title="Unsynced edit — saved locally and will sync automatically"
                aria-label="Unsynced edit — saved locally and will sync automatically"
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, whiteSpace: "nowrap" }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: warnDot, flex: "0 0 auto" }} className="pulse-soft" />
                Unsynced
              </span>
            )}
            {/* Personalisation: greeting + live clocks. Full inline
                >=1400px container width; below that they relocate into the
                user menu's popover (see UserMenu's `extra` prop below) since
                a container query can't reach portalled content — driven by
                `headerCompactGreeting` (ResizeObserver on .report__top). */}
            {!headerCompactGreeting && (
              <>
                <span aria-hidden="true" style={{ width: 1, height: 18, background: t.ruleSoft, flex: "0 0 auto" }} />
                <Welcome name={user!.name} />
                <span aria-hidden="true" style={{ width: 1, height: 18, background: t.ruleSoft, flex: "0 0 auto" }} />
                <Clocks />
              </>
            )}
            <ViewsMenu pageId={pageId} setPageId={go} />
            <button onClick={reset} className="hdr-btn bar-btn" style={btn(t)} title="Clear all slicers">
              <IconRefresh size={13} />
              <span className="hdr-reset-label">Reset</span>
              {activeFilters > 0 && (
                <span aria-hidden className="nav-badge" style={{ background: t.accentFill, color: "#fff" }}>
                  {activeFilters}
                </span>
              )}
              {activeFilters > 0 && <span className="sr-only">, {activeFilters} active</span>}
            </button>
            <NotificationBell setPageId={go} />
            <span className="hdr-a11y-inline">
              <button
                onClick={() => setShowA11yPanel(true)}
                className="bar-btn"
                aria-label="Accessibility and display settings"
                title="Accessibility & display (Shift+A)"
                style={{ ...btn(t), padding: "0 9px" }}
              >
                <IconAccessibility size={15} />
              </button>
            </span>
            {/* Theme control: full text label >=1400px, icon-only 1200-1399px,
                collapsed into the ⋯ overflow menu below 1200px (see
                HeaderOverflowMenu below and the .hdr-theme-* / .hdr-overflow-
                trigger container queries in styles.css). */}
            <button
              onClick={cycleTheme}
              className="bar-btn hdr-theme-full"
              // minWidth + centered text: this button's own label IS the
              // current theme name ("Light" / "Dark" / "High contrast"), so
              // without a fixed floor its content-driven width would grow
              // noticeably wider in high-contrast than light/dark (13 chars
              // vs 4-5) even though every other geometry property (padding,
              // border width/style, radius, font) is already byte-identical
              // across all three themes via btn(t) — sized to fit "High
              // contrast" so the box stays the same size in every theme.
              style={{ ...btn(t), minWidth: 118, justifyContent: "center" }}
              title="Cycle theme (light / dark / high contrast)"
            >
              {prefs.theme === "light" ? "Light" : prefs.theme === "dark" ? "Dark" : "High contrast"}
            </button>
            <button
              onClick={cycleTheme}
              className="bar-btn hdr-theme-icon"
              aria-label={`Theme: ${prefs.theme === "light" ? "Light" : prefs.theme === "dark" ? "Dark" : "High contrast"}. Activate to cycle.`}
              title="Cycle theme (light / dark / high contrast)"
              style={{ ...btn(t), padding: "0 9px" }}
            >
              {prefs.theme === "light" ? <IconSun size={15} /> : prefs.theme === "dark" ? <IconMoon size={15} /> : <IconContrastCircle size={15} />}
            </button>
            <HeaderOverflowMenu
              items={[
                { key: "a11y", label: "Accessibility & display", icon: <IconAccessibility size={15} />, onClick: () => setShowA11yPanel(true) },
                {
                  key: "theme",
                  label: `Theme: ${prefs.theme === "light" ? "Light" : prefs.theme === "dark" ? "Dark" : "High contrast"}`,
                  icon: prefs.theme === "light" ? <IconSun size={15} /> : prefs.theme === "dark" ? <IconMoon size={15} /> : <IconContrastCircle size={15} />,
                  onClick: cycleTheme,
                },
              ]}
            />
            {user && (
              <UserMenu
                user={user}
                signOut={signOut}
                extra={
                  headerCompactGreeting ? (
                    <>
                      <Welcome name={user.name} />
                      <Clocks />
                    </>
                  ) : undefined
                }
              />
            )}
            {/* Command palette trigger (nav/motion P1) — priority 3 after
                the user menu: last, rightmost in the header. Own single
                1200px full/icon threshold, kept OUT of the ⋯ overflow menu
                (see the .hdr-cmdk-* container queries in styles.css) — the
                flagship feature must always stay reachable inline. */}
            <button
              ref={cmdkFullRef}
              onClick={() => setPaletteOpen(true)}
              className="bar-btn hdr-cmdk-full"
              style={btn(t)}
              aria-haspopup="dialog"
              title="Search everything (Ctrl+K)"
            >
              <IconSearch size={13} />
              Search…
              <span
                className="cmdk-kbd"
                aria-hidden="true"
                style={{ fontFamily: fonts.mono, fontSize: 10, fontWeight: 700, background: t.themeBand, border: `1px solid ${t.ruleSoft}`, borderRadius: 6, padding: "1px 6px", marginLeft: 2 }}
              >
                ⌘K
              </span>
            </button>
            <button
              ref={cmdkIconRef}
              onClick={() => setPaletteOpen(true)}
              className="bar-btn hdr-cmdk-icon"
              aria-label="Search (Ctrl+K)"
              title="Search everything (Ctrl+K)"
              style={{ ...btn(t), padding: "0 9px" }}
            >
              <IconSearch size={15} />
            </button>
          </header>

          {!page.noSlicers && (
            <div className="report__slicers" style={{ borderBottom: `1px solid ${t.ruleSoft}` }}>
              <FilterBar />
              {/* Drill chip (nav/motion P1) — Slicers.tsx's "Process name"
                  slicer already surfaces the active process as its own
                  summary text, but nothing else on the page names it or
                  offers a one-click way out of the drill; this adds that.
                  See the task report for the "existing drill chip"
                  investigation this followed. */}
              {filters.processId !== "All" && (
                <span
                  className="drill-chip"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 10,
                    padding: "4px 6px 4px 10px",
                    borderRadius: 999,
                    background: t.themeBand,
                    border: `1px solid ${t.ruleSoft}`,
                    fontFamily: fonts.mono,
                    fontSize: 11,
                    color: t.ink,
                  }}
                >
                  Process: {PROCESS_BY_ID.get(filters.processId)?.name ?? filters.processId}
                  <button
                    onClick={() => setFilters({ processId: "All" })}
                    aria-label="Clear process filter"
                    style={{ border: "none", background: "transparent", color: t.inkSoft, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
          </div>

          <main id="main-content" tabIndex={-1} ref={mainRef} className="report__canvas">
            <NavContext.Provider value={go}>
              <NavOriginContext.Provider value={navOriginValue}>
                {/* Page-level crash containment: resetKey={shown.id} (inside
                    PageTransition) means a crash on one page never takes the
                    nav/header down with it, and navigating to a different
                    page (or back to the same one via a fresh key) always
                    recovers automatically. The app-wide ErrorBoundary in
                    src/main.tsx is the last line of defence beyond this one.
                    PageTransition (nav/motion P1) wraps this crossfade —
                    see its own comment above. */}
                <PageTransition page={page} />
              </NavOriginContext.Provider>
            </NavContext.Provider>
          </main>
        </div>
      </div>
      {showA11yPanel && <DisplayPanel onClose={() => setShowA11yPanel(false)} />}
      {showShortcuts && <ShortcutsDialog shortcuts={shortcuts} onClose={() => setShowShortcuts(false)} />}
      {/* Always mounted (unlike the two dialogs above) so its one-time coach
          mark can show near the trigger before the palette is ever opened —
          see CommandPalette.tsx's own file header. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        triggerRef={cmdkTriggerRef}
        go={go}
        visiblePages={visiblePages}
        savedViews={loadViews(user?.id)}
        setFilters={setFilters}
        applyView={applyView}
        user={user}
        reset={reset}
        cycleTheme={cycleTheme}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        setShowA11yPanel={setShowA11yPanel}
        setShowShortcuts={setShowShortcuts}
        signOut={signOut}
        can={can}
        sortedAlerts={sortedAlerts}
        acked={acked}
        ackAll={ackAll}
      />
    </>
  );
}

// Keyboard-shortcuts cheat sheet: same modal chrome as DisplayPanel (backdrop
// click-to-close, Escape-to-close, focus moved in on mount and returned to
// the opener on unmount) — see src/a11y/DisplayPanel.tsx for the pattern this
// mirrors.
function ShortcutsDialog({ shortcuts, onClose }: { shortcuts: ShortcutEntry[]; onClose: () => void }) {
  const t = useTheme();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
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
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        className="modal-dialog glass-overlay"
        style={glassOverlayVars(t)}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <h2 id="shortcuts-dialog-title" style={{ margin: 0, fontFamily: fonts.display, fontSize: 19, fontWeight: 700, color: t.ink }}>
            Keyboard shortcuts
          </h2>
          <button ref={closeBtnRef} aria-label="Close keyboard shortcuts" onClick={onClose} className="a11y-seg-btn">
            <IconClose size={20} />
          </button>
        </div>
        <dl style={{ margin: "14px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 10, columnGap: 16 }}>
          {shortcuts.map((s) => (
            <div key={s.keys + s.description} style={{ display: "contents" }}>
              <dt
                style={{
                  margin: 0,
                  fontFamily: fonts.mono,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: t.ink,
                  background: t.themeBand,
                  border: `1px solid ${t.ruleSoft}`,
                  borderRadius: 6,
                  padding: "2px 8px",
                  whiteSpace: "nowrap",
                  alignSelf: "start",
                }}
              >
                {s.keys}
              </dt>
              <dd style={{ margin: 0, fontFamily: fonts.body, fontSize: 13, color: t.inkSoft, alignSelf: "center" }}>{s.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// Unified control recipe (§2): every header control is exactly
// --control-h (32px) tall, box-sizing:border-box so padding can't push past
// that, and never wraps — controls grow sideways only. Callers that need a
// different horizontal padding (icon-only buttons, the width-floored theme
// toggle) override `padding`/`minWidth` alone; height/border/radius/font
// stay identical everywhere so every header control is visually unified.
function btn(t: ReturnType<typeof useTheme>) {
  return {
    // display is NOT set here — it lives in the `.bar-btn` CSS class instead
    // (styles.css) so the .hdr-theme-full/.hdr-theme-icon container-query
    // rules can override it; an inline style always beats an external rule
    // of any specificity, which silently defeated those container queries
    // when display used to be set here (every btn(t) consumer also carries
    // className="bar-btn" — see that class's comment).
    alignItems: "center",
    gap: 6,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    height: "var(--control-h)",
    padding: "0 12px",
    borderRadius: "var(--r-control)",
    cursor: "pointer",
    fontWeight: 700,
    border: `1px solid ${t.ruleSoft}`,
    background: "transparent",
    color: t.inkSoft,
    whiteSpace: "nowrap" as const,
    boxSizing: "border-box" as const,
  };
}
