import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode, RefObject } from "react";
import { fonts, glassOverlayVars, type } from "../theme";
import { useTheme } from "../theme-context";
import { Portal } from "./Portal";
import { useAnchoredPopover } from "./useAnchoredPopover";
import { SpokeSwatch } from "./SpokeSwatch";
import { IconSearch, IconClose } from "./icons";
import { PROCESS_BY_ID, SPOKE_INFO } from "../rpaData";
import type { Filters, SavedView } from "../filters-context";
import { viewAlert } from "../alerts/alerts-context";
import type { Alert } from "../alerts/engine";
import type { PermAction } from "../auth/auth-context";
import type { User } from "../auth/types";
import { PLAYBOOK_SECTIONS } from "../pages/playbook-content";

// ---------------------------------------------------------------------------
// components/CommandPalette.tsx — nav/motion P1
// ---------------------------------------------------------------------------
// A single Ctrl/Cmd+K command palette: jump to any page, drill into a
// process, filter to a spoke, apply a saved view, open an alert, fire a
// global action, or jump to a Playbook section. Portalled to document.body
// (it must sit above literally everything, including any already-open
// anchored popover) and built as a controlled component — App.tsx's
// Report() owns `open`/`setOpen` state and passes every piece of data this
// needs down as props (mirroring how ViewsMenu/UserMenu already receive
// pageId/setPageId as props rather than reaching for extra context).
//
// Keyboard: this component's own document-level keydown listener (active
// only while `open`) handles ArrowUp/ArrowDown (move active row, wrap),
// Tab/Shift+Tab (jump to the first row of the next/previous GROUP — the
// combobox pattern here has exactly one real focusable element, the search
// input, so Tab is fully repurposed for group navigation rather than a
// classic multi-element DOM focus trap; the visible ✕ close button is
// therefore mouse-only, same as its "not the initial focus target" note
// below), Enter (run the active row), and Escape (close + restore focus to
// whatever opened it). The GLOBAL Ctrl/Cmd+K trigger and the Alt+1..9 nav
// shortcuts both live in App.tsx's own keydown handler, not here — see the
// comments there for why (they must keep firing while typing/while this
// palette is open).
// ---------------------------------------------------------------------------

export interface CommandPaletteVisiblePage {
  id: string;
  label: string;
  group: string;
  Icon: ComponentType<{ size?: number }>;
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  run: () => void;
}

interface RecentEntry {
  id: string;
  label: string;
  group: string;
}

const GROUP_ORDER = ["Pages", "Processes", "Spokes", "Saved views", "Alerts", "Actions", "Help"];
const MAX_TOTAL = 24;
const MAX_PER_GROUP = 6;

function recentsKey(userId: string | undefined) {
  return `bp-cmdk-recent::${userId ?? ""}`;
}
function loadRecents(userId: string | undefined): RecentEntry[] {
  try {
    const raw = localStorage.getItem(recentsKey(userId));
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}
function saveRecents(userId: string | undefined, list: RecentEntry[]) {
  try {
    localStorage.setItem(recentsKey(userId), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function coachKey(userId: string | undefined) {
  return `bp-coach-v1::${userId ?? ""}`;
}

// Ranking tiers, lowest (best) first: exact prefix on the label, any word in
// the label starting with the query, then an in-order (not necessarily
// contiguous) subsequence fuzzy match. Returns null for no match at all.
function matchTier(label: string, query: string): 0 | 1 | 2 | null {
  if (!query) return 0;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l.startsWith(q)) return 0;
  const words = l.split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 1;
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++;
  }
  return qi === q.length ? 2 : null;
}

function rankPool(pool: PaletteItem[], query: string, recentIds: string[]): PaletteItem[] {
  const scored: { item: PaletteItem; tier: number; recency: number; idx: number }[] = [];
  pool.forEach((item, idx) => {
    const tier = matchTier(item.label, query);
    if (tier === null) return;
    const recency = recentIds.indexOf(item.id);
    scored.push({ item, tier, recency: recency === -1 ? Infinity : recency, idx });
  });
  scored.sort((a, b) => a.tier - b.tier || a.recency - b.recency || a.idx - b.idx);
  return scored.map((s) => s.item);
}

// Playbook section anchors mirror Playbook.tsx's own (unexported) anchorFor —
// see that file's `function anchorFor(id: string) { return \`sec-${id}\`; }`.
function playbookAnchor(id: string) {
  return `sec-${id}`;
}

function scrollToPlaybookSection(id: string) {
  const reduced = prefersReducedMotionNow();
  let tries = 0;
  const attempt = () => {
    const el = document.getElementById(playbookAnchor(id));
    if (el) {
      el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      return;
    }
    tries++;
    if (tries < 6) setTimeout(attempt, 50);
  };
  requestAnimationFrame(() => requestAnimationFrame(attempt));
}

function prefersReducedMotionNow(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.getAttribute("data-reduce-motion") === "true"
  );
}

const FOOTER_HINT = "? shortcuts · / slicers · [ nav";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement>;
  go: (id: string) => void;
  visiblePages: CommandPaletteVisiblePage[];
  savedViews: SavedView[];
  setFilters: (f: Partial<Filters>) => void;
  applyView: (v: SavedView) => void;
  user: User | null;
  reset: () => void;
  cycleTheme: () => void;
  collapsed: boolean;
  setCollapsed: (updater: (c: boolean) => boolean) => void;
  setShowA11yPanel: (v: boolean) => void;
  setShowShortcuts: (v: boolean) => void;
  signOut: () => void;
  can: (action: PermAction, spokeId?: string) => boolean;
  sortedAlerts: Alert[];
  acked: Set<string>;
  ackAll: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const {
    open,
    onClose,
    triggerRef,
    go,
    visiblePages,
    savedViews,
    setFilters,
    applyView,
    user,
    reset,
    cycleTheme,
    collapsed,
    setCollapsed,
    setShowA11yPanel,
    setShowShortcuts,
    signOut,
    can,
    sortedAlerts,
    acked,
    ackAll,
  } = props;

  const t = useTheme();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<RecentEntry[]>(() => loadRecents(user?.id));

  // Dialog stays MOUNTED for `--d-fast` (120ms — matches the CSS token, see
  // .cmdk-closing) after `open` flips false, purely so its 100ms exit
  // animation can play; `closing` drives the extra class for that. Skipped
  // entirely under reduced motion — see PageTransition's identical pattern
  // in App.tsx for the same JS/CSS-duration-sync comment.
  const [renderedOpen, setRenderedOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      setRenderedOpen(true);
      setClosing(false);
      return;
    }
    if (!renderedOpen) return;
    if (prefersReducedMotionNow()) {
      setRenderedOpen(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setRenderedOpen(false);
      setClosing(false);
    }, 100); // keep in sync with .cmdk-closing's 100ms in styles.css
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const requestClose = () => {
    const o = openerRef.current;
    if (o && o !== document.body && document.contains(o)) o.focus();
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // Reset the search + capture the opener each time the dialog actually
  // opens (StrictMode-safe: `openerRef.current == null` guard mirrors
  // DisplayPanel's, though since this component stays permanently mounted —
  // unlike DisplayPanel, which App.tsx mounts/unmounts per open — the
  // double-invoke this guards against would only ever matter on this
  // component's own very first mount, not on later opens; kept anyway for
  // exact parity with the documented pattern).
  useEffect(() => {
    if (!open) {
      openerRef.current = null;
      return;
    }
    setQuery("");
    setActiveIndex(0);
    if (openerRef.current == null) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // All possible items, recomputed only when their underlying data changes —
  // NOT on every keystroke (filtering/ranking below is what runs per
  // keystroke, over this already-built pool).
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    for (const p of visiblePages) {
      items.push({ id: `page:${p.id}`, group: "Pages", label: p.label, sublabel: p.group, icon: <p.Icon size={15} />, run: () => go(p.id) });
    }

    for (const proc of Array.from(PROCESS_BY_ID.values())) {
      items.push({
        id: `process:${proc.id}`,
        group: "Processes",
        label: `Drill into ${proc.name}`,
        sublabel: `${proc.spoke} · ${proc.proposition}`,
        icon: <SpokeSwatch spoke={proc.spoke} />,
        run: () => {
          setFilters({ spoke: proc.spoke, proposition: proc.proposition, processId: proc.id, queue: "All" });
          go("process-detail");
        },
      });
    }

    for (const spoke of Object.keys(SPOKE_INFO)) {
      items.push({
        id: `spoke:${spoke}`,
        group: "Spokes",
        label: `Filter to ${spoke}`,
        icon: <SpokeSwatch spoke={spoke} />,
        run: () => setFilters({ spoke, proposition: "All", processId: "All", queue: "All" }),
      });
    }

    for (const v of savedViews) {
      items.push({
        id: `view:${v.name}`,
        group: "Saved views",
        label: v.name,
        sublabel: v.filters.spoke === "All" ? "Hub-wide" : v.filters.spoke,
        run: () => {
          applyView(v);
          if (v.pageId) go(v.pageId);
        },
      });
    }

    const topAlerts = sortedAlerts.filter((a) => !acked.has(a.id)).slice(0, 5);
    for (const a of topAlerts) {
      items.push({
        id: `alert:${a.id}`,
        group: "Alerts",
        label: a.scopeLabel,
        sublabel: `${a.severity} · ${a.windowLabel}`,
        run: () => viewAlert(a, setFilters, go),
      });
    }

    const actions: { label: string; run: () => void }[] = [
      { label: "Reset slicers", run: reset },
      { label: "Toggle theme", run: cycleTheme },
      { label: collapsed ? "Expand navigation" : "Collapse navigation", run: () => setCollapsed((c) => !c) },
      { label: "Accessibility settings", run: () => setShowA11yPanel(true) },
      { label: "Show shortcuts", run: () => setShowShortcuts(true) },
      { label: "Acknowledge all alerts", run: ackAll },
      { label: "Sign out", run: signOut },
    ];
    for (const a of actions) items.push({ id: `action:${a.label}`, group: "Actions", label: a.label, run: a.run });

    if (can("view_docs")) {
      for (const s of PLAYBOOK_SECTIONS) {
        items.push({
          id: `help:${s.id}`,
          group: "Help",
          label: s.title,
          run: () => {
            go("playbook");
            scrollToPlaybookSection(s.id);
          },
        });
      }
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePages, savedViews, sortedAlerts, acked, collapsed, can, user?.id]);

  const recentIds = useMemo(() => recents.map((r) => r.id), [recents]);

  // Filter + rank `allItems` against the current query. Empty query: Recent
  // (resolved back to live items) then Pages, nothing else. A leading ">"
  // switches to action mode: only the Actions group is searched.
  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim();
    const actionMode = trimmed.startsWith(">");
    const q = (actionMode ? trimmed.slice(1) : trimmed).trim();

    if (actionMode) {
      const pool = allItems.filter((i) => i.group === "Actions");
      return rankPool(pool, q, recentIds).slice(0, MAX_TOTAL);
    }

    if (!q) {
      const byId = new Map(allItems.map((i) => [i.id, i] as const));
      const recentItems: PaletteItem[] = [];
      for (const r of recents) {
        const live = byId.get(r.id);
        if (live) recentItems.push({ ...live, group: "Recent" });
      }
      const pages = allItems.filter((i) => i.group === "Pages");
      return [...recentItems, ...pages].slice(0, MAX_TOTAL);
    }

    let result: PaletteItem[] = [];
    for (const g of GROUP_ORDER) {
      if (result.length >= MAX_TOTAL) break;
      const pool = allItems.filter((i) => i.group === g);
      const ranked = rankPool(pool, q, recentIds).slice(0, MAX_PER_GROUP);
      const room = MAX_TOTAL - result.length;
      result = result.concat(ranked.slice(0, room));
    }
    return result;
  }, [allItems, query, recentIds, recents]);

  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) if (!seen.includes(it.group)) seen.push(it.group);
    return seen;
  }, [items]);

  // Fresh refs the document-level keydown listener below always reads from
  // (it's registered with `[open]` deps, not re-registered every keystroke —
  // same "always-current-via-ref" trick as `requestCloseRef` above).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Query changed (or the dialog just opened) — the active row always
  // starts back at the top of the new result set.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const recordRecent = (item: PaletteItem) => {
    const next = [{ id: item.id, label: item.label, group: item.group }, ...recents.filter((r) => r.id !== item.id)].slice(0, 8);
    setRecents(next);
    saveRecents(user?.id, next);
  };

  const runItem = (item: PaletteItem) => {
    recordRecent(item);
    item.run();
    requestClose();
  };

  useEffect(() => {
    if (!open) return;

    const jumpGroup = (dir: 1 | -1): number => {
      const list = itemsRef.current;
      if (!list.length) return 0;
      const boundaries: number[] = [];
      list.forEach((it, i) => {
        if (i === 0 || it.group !== list[i - 1].group) boundaries.push(i);
      });
      if (!boundaries.length) return 0;
      const cur = activeIndexRef.current;
      let curBoundaryIdx = 0;
      for (let i = 0; i < boundaries.length; i++) if (boundaries[i] <= cur) curBoundaryIdx = i;
      const nextBoundaryIdx = (curBoundaryIdx + dir + boundaries.length) % boundaries.length;
      return boundaries[nextBoundaryIdx];
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = itemsRef.current.length;
        if (!n) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => (i + delta + n) % n);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setActiveIndex(jumpGroup(e.shiftKey ? -1 : 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = itemsRef.current[activeIndexRef.current];
        if (item) runItem(item);
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // --- one-time coach mark ("Press ⌘K to jump anywhere") --------------
  // Persisted dismissal (never shows again once set) is separate from a
  // transient hide (e.g. useAnchoredPopover's mutual-exclusion closing this
  // when some OTHER header popover opens) so a stray click elsewhere can't
  // burn the user's one-time tip.
  const [coachDismissed, setCoachDismissed] = useState(() => {
    try {
      return localStorage.getItem(coachKey(user?.id)) != null;
    } catch {
      return true;
    }
  });
  const [coachHidden, setCoachHidden] = useState(false);
  const dismissCoach = () => {
    setCoachDismissed(true);
    setCoachHidden(true);
    try {
      localStorage.setItem(coachKey(user?.id), "1");
    } catch {
      /* ignore */
    }
  };
  const showCoach = !coachDismissed && !coachHidden && !open;
  const coachStyle = useAnchoredPopover(triggerRef, showCoach, () => setCoachHidden(true), { align: "end", width: 224 });

  useEffect(() => {
    if (open) dismissCoach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!showCoach) return;
    const onAnyKey = () => dismissCoach();
    document.addEventListener("keydown", onAnyKey);
    return () => document.removeEventListener("keydown", onAnyKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCoach]);

  return (
    <>
      {renderedOpen && (
        <Portal>
          <div
            className="modal-backdrop cmdk-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) requestClose();
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              className={`modal-dialog glass-overlay cmdk-dialog${closing ? " cmdk-closing" : ""}`}
              style={glassOverlayVars(t)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cmdk-input-row" style={{ borderColor: t.ruleSoft }}>
                <IconSearch size={15} style={{ color: t.inkSoft, flex: "0 0 auto" }} />
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="cmdk-listbox"
                  aria-activedescendant={items.length ? `cmdk-opt-${activeIndex}` : undefined}
                  aria-autocomplete="list"
                  aria-label="Search pages, processes, spokes, views, alerts and actions"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search everything, or type > for actions…"
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: t.ink, fontFamily: fonts.body, fontSize: 14 }}
                />
                <button aria-label="Close command palette" onClick={requestClose} className="a11y-seg-btn" style={{ color: t.inkSoft, borderColor: t.ruleSoft, flex: "0 0 auto" }}>
                  <IconClose size={16} />
                </button>
              </div>

              <div id="cmdk-listbox" role="listbox" ref={listboxRef} aria-label="Results" className="cmdk-listbox">
                {items.length === 0 && (
                  <div style={{ padding: "18px 16px", fontFamily: fonts.body, fontSize: 13, color: t.inkSoft }}>No matches.</div>
                )}
                {groups.map((g) => (
                  <div key={g}>
                    <div
                      style={{
                        ...type.label,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: t.inkSoft,
                        padding: "8px 16px 4px",
                      }}
                    >
                      {g}
                    </div>
                    {items.map((it, idx) =>
                      it.group !== g ? null : (
                        <div
                          key={it.id}
                          id={`cmdk-opt-${idx}`}
                          role="option"
                          aria-selected={idx === activeIndex}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => runItem(it)}
                          className="cmdk-row"
                          style={{
                            background: idx === activeIndex ? t.themeBand : "transparent",
                            color: t.ink,
                          }}
                        >
                          {it.icon && <span className="cmdk-row__icon">{it.icon}</span>}
                          <span className="cmdk-row__label" style={{ ...type.bodyM }}>
                            {it.label}
                          </span>
                          {it.sublabel && (
                            <span className="cmdk-row__sub" style={{ ...type.label, letterSpacing: "0.06em", textTransform: "uppercase", color: t.inkSoft }}>
                              {it.sublabel}
                            </span>
                          )}
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>

              <div className="cmdk-footer" style={{ borderColor: t.ruleSoft, color: t.inkSoft }}>
                {FOOTER_HINT}
              </div>

              <div aria-live="polite" className="sr-only">
                {items.length} result{items.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        </Portal>
      )}

      {showCoach && coachStyle && (
        <Portal>
          <div
            role="status"
            className="glass-overlay"
            style={{
              ...coachStyle,
              zIndex: "var(--z-popover)" as unknown as number,
              border: `1px solid ${t.ruleSoft}`,
              padding: "9px 10px 9px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              maxWidth: 224,
              ...glassOverlayVars(t),
            }}
          >
            <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.ink, lineHeight: 1.3 }}>Press ⌘K to jump anywhere</span>
            <button
              aria-label="Dismiss tip"
              onClick={dismissCoach}
              style={{ border: "none", background: "transparent", color: t.inkSoft, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2, flex: "0 0 auto" }}
            >
              ×
            </button>
          </div>
        </Portal>
      )}
    </>
  );
}
