import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { themes } from "./theme";
import type { Mode } from "./theme";
import { fonts, liquidGlassVars } from "./theme";
import { ThemeProvider, useTheme } from "./theme-context";
import { FiltersProvider, useFilters, RATE_AUTO } from "./filters-context";
import type { SavedView } from "./filters-context";
import { NavContext } from "./nav-context";
import { PAGE_LABELS } from "./page-labels";
import { FilterBar } from "./components/Slicers";
import { fmtDateFull, DATE_MAX, META, SPOKE_INFO } from "./rpaData";
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
  IconRefresh,
  IconChevron,
  IconGraph,
  IconRoute,
  IconAccessibility,
  IconClose,
  IconShield,
  IconBook,
} from "./components/icons";
import { NotificationBell } from "./alerts/NotificationBell";
import { AlertsProvider, useAlerts } from "./alerts/alerts-context";
import { AlertsPage } from "./alerts/AlertsPage";
import { Overview } from "./pages/Overview";
import { InputOutcome } from "./pages/InputOutcome";
import { ProcessAnalysis } from "./pages/ProcessAnalysis";
import { Exceptions } from "./pages/Exceptions";
import { Capacity } from "./pages/Capacity";
import { Commercial } from "./pages/Commercial";
import { ProcessDetail } from "./pages/ProcessDetail";
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
}

const PAGES: Page[] = [
  { id: "overview", label: PAGE_LABELS.overview, group: "Monitor", Icon: IconGrid, Component: Overview, blurb: "Headline performance, outcome mix and the operational watchlist" },
  { id: "alerts", label: PAGE_LABELS.alerts, group: "Monitor", Icon: IconBell, Component: AlertsPage, blurb: "Threshold breaches and early warnings across the estate" },
  { id: "input-outcome", label: "Input & Outcome", group: "Monitor", Icon: IconFlow, Component: InputOutcome, blurb: "Case flow in and out, by outcome, daily or monthly" },
  { id: "process", label: "Process Analysis", group: "Monitor", Icon: IconBars, Component: ProcessAnalysis, blurb: "Completion time, throughput and exception trends by process" },
  { id: "exceptions", label: PAGE_LABELS.exceptions, group: "Monitor", Icon: IconAlert, Component: Exceptions, blurb: "Exception heatmap and searchable detail" },
  { id: "process-detail", label: PAGE_LABELS["process-detail"], group: "Monitor", Icon: IconRoute, Component: ProcessDetail, blurb: "Drill-through — one process in depth (click a process anywhere)" },
  { id: "capacity", label: PAGE_LABELS.capacity, group: "Optimise", Icon: IconServer, Component: Capacity, blurb: "Digital-worker utilisation, idle time and estate cost" },
  { id: "commercial", label: PAGE_LABELS.commercial, group: "Optimise", Icon: IconCoins, Component: Commercial, blurb: "Cost per case, grade-based benefit and cumulative ROI" },
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

function loadViews(userId: string | undefined): SavedView[] {
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

// The theme accent follows the active spoke: each spoke has its own validated
// accent per surface (SPOKE_INFO); the hub view keeps the brand accent.
function ThemedReport() {
  const { filters } = useFilters();
  const { prefs } = useDisplayPrefs();
  // High-contrast is a black/white CSS overlay (see styles.css) layered on top
  // of the dark-mode JS tokens — there is no separate "high-contrast" Mode in
  // theme.ts, so it maps to "dark" here for token/spoke-colour purposes.
  const mode: Mode = prefs.theme === "light" ? "light" : "dark";
  const spokeColor = filters.spoke !== "All" ? SPOKE_INFO[filters.spoke]?.[mode === "dark" ? "dark" : "light"] : undefined;
  const base = themes[mode];
  const theme = spokeColor ? { ...base, accent: spokeColor, accentSoft: spokeColor } : base;

  useEffect(() => {
    document.body.style.background = theme.page;
    document.title = "Intelligent Automation — Performance";
  }, [theme.page]);

  return (
    <ThemeProvider value={theme}>
      <AlertsProvider>
        <Report />
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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
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
        style={btn(t)}
      >
        <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>☆</span>
        Views{views.length ? ` (${views.length})` : ""}
      </button>
      {open && (
        <div ref={panelRef} className="dropdown-panel liquid-glass" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, width: 262, border: `1px solid ${t.ruleSoft}`, padding: 6 }}>
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
                <span style={{ display: "block", fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft, fontWeight: 400 }}>
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
      )}
    </div>
  );
}

// Header user chip: name + highest-role badge, opens a small dropdown with
// "Sign out" — same visual idiom as ViewsMenu's dropdown (position:absolute
// panel anchored under the trigger, closes on outside click).
function UserMenu({ user, signOut }: { user: User; signOut: () => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="bar-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        style={{ ...btn(t), gap: 7, color: t.ink, textTransform: "none", letterSpacing: 0, padding: "4px 12px 4px 5px" }}
      >
        <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", background: t.accentFill, color: "#fff", fontFamily: fonts.mono, fontSize: 10, fontWeight: 700, flex: "0 0 auto" }}>
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span style={{ fontFamily: fonts.body, fontWeight: 600 }}>{user.name}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft }}>{highestRoleLabel(user.roles)}</span>
      </button>
      {open && (
        <div ref={panelRef} className="dropdown-panel liquid-glass" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, minWidth: 180, border: `1px solid ${t.ruleSoft}`, padding: 6 }}>
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
      )}
    </div>
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

function Report() {
  const t = useTheme();
  const { reset, filters, peopleRate } = useFilters();
  const { user, signOut } = useAuth();
  const { can } = usePermissions();
  const { unackedCount } = useAlerts();
  const { prefs, cycleTheme } = useDisplayPrefs();
  // High-contrast is a black/white CSS overlay (see styles.css) layered on top
  // of the dark-mode JS tokens — there is no separate "high-contrast" Mode in
  // theme.ts, so it maps to "dark" here for token/spoke-colour purposes.
  const mode: Mode = prefs.theme === "light" ? "light" : "dark";
  const persistKey = keyFor(PERSIST, user?.id);
  const [pageId, setPageId] = useState<string>(() => readNamespaced(PERSIST, user?.id, {} as { pageId?: string; collapsed?: boolean }).pageId ?? "overview");
  const [collapsed, setCollapsed] = useState<boolean>(() => readNamespaced(PERSIST, user?.id, {} as { pageId?: string; collapsed?: boolean }).collapsed ?? false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showA11yPanel, setShowA11yPanel] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Pages gated behind a permission (e.g. Admin behind view_admin, Playbook
  // and Data Model behind view_docs — see the Page.permission comment) drop
  // out of the nav entirely for a user who can't view them.
  const visiblePages = PAGES.filter((p) => !p.permission || can(p.permission));
  const page = visiblePages.find((p) => p.id === pageId) ?? visiblePages[0];
  const PageBody = page.Component;

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
      { keys: "Shift+A", description: "Open Accessibility & display settings", test: (e) => e.shiftKey && e.key.toLowerCase() === "a", run: () => setShowA11yPanel(true) },
      { keys: "/", description: "Focus the first slicer (Spoke)", test: (e) => e.key === "/", run: () => { if (!page.noSlicers) (document.querySelector('[data-first-slicer="true"]') as HTMLElement | null)?.focus(); } },
      { keys: "[", description: "Toggle navigation collapse", test: (e) => e.key === "[", run: () => setCollapsed((c) => !c) },
      { keys: "Esc", description: "Close the shortcuts list", test: (e) => e.key === "Escape", run: () => setShowShortcuts(false) },
      ...visiblePages.slice(0, 9).map((p, i) => ({
        keys: `Alt+${i + 1}`,
        description: `Go to ${p.label}`,
        test: (e: KeyboardEvent) => e.altKey && e.key === String(i + 1),
        run: () => setPageId(p.id),
      })),
    ],
    [visiblePages, collapsed, page]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the shortcuts cheat-sheet or the Accessibility & display panel
      // is open, that dialog owns the keyboard (it has its own focus trap and
      // Escape handling) — global shortcuts like Alt+1..9 or "/" must not
      // reach through the modal and change the page/focus behind it.
      if (showA11yPanel || showShortcuts) return;
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if (typing) return;
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
  }, [shortcuts, showA11yPanel, showShortcuts]);

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
      <div className="report" data-mode={mode} style={{ background: t.page, color: t.ink }}>
        <div aria-live="polite" className="sr-only">
          {page.label} page loaded. {activeFilters} filter{activeFilters === 1 ? "" : "s"} active.
        </div>
        <ReadingRuler />
        {/* ---- left navigation ---- */}
        <aside className="report__nav" style={{ width: collapsed ? 62 : 232, background: t.paper, borderRight: `1px solid ${t.ruleSoft}` }}>
          <div className="report__brand" style={{ borderBottom: `1px solid ${t.ruleSoft}` }}>
            <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: t.accentFill, color: "#fff", flex: "0 0 auto", fontFamily: fonts.display, fontWeight: 700, fontSize: 17 }}>IA</span>
            {!collapsed && (
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: fonts.display, fontSize: 13, fontWeight: 700, lineHeight: 1.15, color: t.ink }}>Intelligent Automation</span>
                {/* brand sub-label carries the active spoke identity + its colour */}
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: filters.spoke !== "All" ? t.accent : t.inkSoft, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {filters.spoke !== "All" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent, flex: "0 0 auto" }} />}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{filters.spoke !== "All" ? SPOKE_INFO[filters.spoke]?.short ?? filters.spoke : "IA CoE · Hub view"}</span>
                </span>
              </span>
            )}
          </div>

          <nav aria-label="Pages" style={{ flex: 1, overflow: "auto", padding: "10px 8px" }}>
            {groups.map((g) => (
              <div key={g} style={{ marginBottom: 10 }}>
                {!collapsed && <div style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: t.inkSoft, padding: "6px 10px 4px", opacity: 0.8 }}>{g}</div>}
                {visiblePages.filter((p) => p.group === g).map((p) => {
                  const on = p.id === pageId;
                  const isAlerts = p.id === "alerts";
                  const showBadge = isAlerts && unackedCount > 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPageId(p.id)}
                      title={p.label}
                      aria-current={on ? "page" : undefined}
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
                        position: "relative",
                      }}
                    >
                      <p.Icon size={18} />
                      {!collapsed && <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>}
                      {showBadge && (
                        <span
                          aria-hidden
                          className="nav-badge"
                          style={{
                            background: on ? "#fff" : t.accentFill,
                            color: on ? t.accent : "#fff",
                            ...(collapsed ? { position: "absolute", top: 4, right: 4 } : { marginLeft: "auto" }),
                          }}
                        >
                          {unackedCount > 9 ? "9+" : unackedCount}
                        </span>
                      )}
                      {showBadge && <span className="sr-only">, {unackedCount} unacknowledged</span>}
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
            {/* Title + blurb share one baseline row (blurb truncates first) so
                the header fits the shared --header-h band. */}
            <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 10, overflow: "hidden" }}>
              <h1 style={{ margin: 0, fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: t.ink, lineHeight: 1.1, whiteSpace: "nowrap" }}>{page.label}</h1>
              <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                <Bionic>{page.blurb}</Bionic>
              </p>
            </div>
            <div style={{ flex: 1 }} />
            {/* Right cluster: data-freshness pill · greeting · clocks — each a
                SINGLE line, centre-aligned in the 56px band, separated by
                hairline dividers. Detail (source, build time, full date,
                season) lives in tooltips, not extra visual lines. */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.04em", color: t.inkSoft, whiteSpace: "nowrap" }} title={`Data through ${fmtDateFull(DATE_MAX)} · Source: ${META.source} · ${META.sourceRows.toLocaleString()} queue items · built ${META.generatedAt.slice(0, 16).replace("T", " ")}`}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.status.committed.dot, flex: "0 0 auto" }} className="pulse-soft" />
              Data to {fmtDateFull(DATE_MAX)} · {META.sourceRows.toLocaleString()}
            </span>
            <span aria-hidden="true" style={{ width: 1, height: 18, background: t.ruleSoft, flex: "0 0 auto" }} />
            {/* Personalisation: greeting + live clocks, grouped near the user
                chip since both are per-user rather than per-page content. */}
            <Welcome name={user!.name} />
            <span aria-hidden="true" style={{ width: 1, height: 18, background: t.ruleSoft, flex: "0 0 auto" }} />
            <Clocks />
            <ViewsMenu pageId={pageId} setPageId={setPageId} />
            <button onClick={reset} className="hdr-btn" style={btn(t)} title="Clear all slicers">
              <IconRefresh size={13} /> Reset{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            <NotificationBell setPageId={setPageId} />
            <button
              onClick={() => setShowA11yPanel(true)}
              className="bar-btn"
              aria-label="Accessibility and display settings"
              title="Accessibility & display (Shift+A)"
              style={{ ...btn(t), padding: "6px 9px" }}
            >
              <IconAccessibility size={15} />
            </button>
            <button
              onClick={cycleTheme}
              className="bar-btn"
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
            {user && <UserMenu user={user} signOut={signOut} />}
          </header>

          {!page.noSlicers && (
            <div className="report__slicers" style={{ background: t.page, borderBottom: `1px solid ${t.ruleSoft}` }}>
              <FilterBar />
            </div>
          )}

          <main id="main-content" tabIndex={-1} ref={mainRef} className="report__canvas">
            <NavContext.Provider value={setPageId}>
              <PageBody key={page.id} />
            </NavContext.Provider>
          </main>
        </div>
      </div>
      {showA11yPanel && <DisplayPanel onClose={() => setShowA11yPanel(false)} />}
      {showShortcuts && <ShortcutsDialog shortcuts={shortcuts} onClose={() => setShowShortcuts(false)} />}
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
        className="modal-dialog liquid-glass"
        style={liquidGlassVars(t)}
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
