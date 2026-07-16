import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useReference } from "../reference/reference-context";
import { useFilters } from "../filters-context";
import { useAuth } from "../auth/auth-context";
import { IconBell, IconAlert } from "../components/icons";
import { evaluateAlerts } from "./engine";
import type { Alert, AlertMetric, AlertScope } from "./engine";

// ---------------------------------------------------------------------------
// alerts/NotificationBell.tsx
// ---------------------------------------------------------------------------
// Header bell + dropdown panel surfacing evaluateAlerts() results. Interaction
// pattern mirrors ViewsMenu in App.tsx exactly (a lightweight dropdown menu,
// not a focus-trapped modal): outside-mousedown closes, Escape closes and
// returns focus to the trigger, ArrowUp/ArrowDown cycles focus among the
// panel's buttons, and focus moves to the panel's first button on open.
//
// Acknowledgements are per-user, stored in localStorage keyed by user id (see
// ackKey below — a small local equivalent of App.tsx's keyFor/readNamespaced,
// duplicated here rather than imported to avoid a circular import since
// App.tsx imports this component). Acked ids are pruned to whatever is in the
// CURRENT alerts array so an ack naturally expires once the data-through date
// moves on (Alert.id embeds dataThroughISO — see alerts/engine.ts).
// ---------------------------------------------------------------------------

const ACKS_STORAGE_KEY = "bp-alert-acks-v1";
function ackKey(userId: string | undefined) {
  return userId ? `${ACKS_STORAGE_KEY}::${userId}` : ACKS_STORAGE_KEY;
}

function readAcks(userId: string | undefined): string[] {
  try {
    const raw = localStorage.getItem(ackKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SEVERITY_ORDER: Record<Alert["severity"], number> = { breach: 0, warn: 1 };
const SCOPE_ORDER: Record<AlertScope, number> = { estate: 0, spoke: 1, process: 2, vdi: 3 };

function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] ||
      a.scopeLabel.localeCompare(b.scopeLabel),
  );
}

const METRIC_LABEL: Record<AlertMetric, string> = {
  completionPct: "Completion rate",
  exceptionRate: "Exception rate",
  systemRate: "System exception rate",
  costPerCase: "Cost per case",
  utilisation: "Utilisation",
};

function formatMetricValue(metric: AlertMetric, value: number): string {
  return metric === "costPerCase" ? `£${value.toFixed(2)}` : `${(value * 100).toFixed(1)}%`;
}

// Read directly off alert.direction (set explicitly at construction in
// engine.ts) rather than inferring it from value vs threshold — the warn band
// for a "min" (floor) threshold can fire for values slightly ABOVE the
// threshold (see engine.ts's classify()), so a value/threshold comparison at
// render time would misclassify a warn-severity floor alert as a ceiling.
function directionSymbolFor(alert: Alert): "≥" | "≤" {
  return alert.direction === "min" ? "≥" : "≤";
}

const menuBtnStyle = (t: ReturnType<typeof useTheme>): CSSProperties => ({
  fontFamily: fonts.mono,
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  border: `1px solid ${t.ruleSoft}`,
  background: "transparent",
  color: t.ink,
  cursor: "pointer",
  padding: "4px 8px",
  borderRadius: 6,
});

export function NotificationBell({ setPageId }: { setPageId: (id: string) => void }) {
  const t = useTheme();
  const { reference } = useReference();
  const { setFilters } = useFilters();
  const { user } = useAuth();

  // Deliberately depends ONLY on `reference` — alerts are estate/spoke/
  // process/vdi-scoped facts, not filter-relative, so re-evaluating on every
  // slicer change would be both wrong and wasteful.
  const alerts = useMemo(() => evaluateAlerts(reference), [reference]);
  const sortedAlerts = useMemo(() => sortAlerts(alerts), [alerts]);
  const alertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);

  const [acked, setAcked] = useState<Set<string>>(() => {
    const loaded = readAcks(user?.id);
    return new Set(loaded.filter((id) => alertIds.has(id)));
  });

  // Re-prune whenever the alerts set changes after mount (e.g. reference
  // edited while panel state was already initialized) so a stale ack id can
  // never linger.
  useEffect(() => {
    setAcked((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (alertIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [alertIds]);

  useEffect(() => {
    try {
      localStorage.setItem(ackKey(user?.id), JSON.stringify([...acked]));
    } catch {
      /* ignore */
    }
  }, [acked, user?.id]);

  const unackedCount = alerts.filter((a) => !acked.has(a.id)).length;

  // Announce only on an INCREASE in unacked count, never on a decrease (which
  // happens when the user acknowledges something).
  const [announceMsg, setAnnounceMsg] = useState<string | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUnackedRef = useRef(unackedCount);
  useEffect(() => {
    if (unackedCount > prevUnackedRef.current) {
      const n = unackedCount;
      setAnnounceMsg(`${n} new threshold alert${n === 1 ? "" : "s"}`);
      if (announceTimer.current) clearTimeout(announceTimer.current);
      announceTimer.current = setTimeout(() => setAnnounceMsg(null), 4500);
    }
    prevUnackedRef.current = unackedCount;
  }, [unackedCount]);
  useEffect(() => () => { if (announceTimer.current) clearTimeout(announceTimer.current); }, []);

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
  // the popover's buttons (with wraparound), matching ViewsMenu exactly.
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

  const ackOne = (id: string) => setAcked((prev) => new Set(prev).add(id));
  const ackAll = () =>
    setAcked((prev) => {
      const next = new Set(prev);
      alerts.forEach((a) => next.add(a.id));
      return next;
    });

  const view = (a: Alert) => {
    // Reset proposition/queue alongside spoke/processId — matching Slicers.tsx's
    // convention of resetting dependent/narrower filters together — so a stale
    // proposition or queue selection can't intersect with the newly-set
    // spoke/processId and leave the destination page showing zero rows.
    setFilters({ spoke: a.spokeFilter ?? "All", proposition: "All", processId: a.processFilter ?? "All", queue: "All" });
    setPageId(a.pageId);
    setOpen(false);
  };

  const badgeText = unackedCount > 9 ? "9+" : String(unackedCount);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="bar-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Notifications, ${unackedCount} unacknowledged`}
        style={{ position: "relative", display: "inline-flex", alignItems: "center", border: `1px solid ${t.ruleSoft}`, color: t.inkSoft }}
      >
        <IconBell size={15} />
        {unackedCount > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 15,
              height: 15,
              borderRadius: "50%",
              background: t.accentFill,
              color: "#fff",
              fontFamily: fonts.mono,
              fontSize: 9,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="dropdown-panel"
          style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, width: 360, maxHeight: 420, overflowY: "auto", background: t.paper, border: `1px solid ${t.ruleSoft}`, borderRadius: 10, boxShadow: t.shadow, padding: 8 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 8px", borderBottom: `1px solid ${t.ruleSoft}`, marginBottom: 6 }}>
            <span style={{ fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: t.ink }}>Notifications</span>
            {unackedCount > 0 && (
              <button
                onClick={ackAll}
                style={{ fontFamily: fonts.mono, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", border: "none", background: "transparent", color: t.accent, cursor: "pointer", padding: "4px 6px" }}
              >
                Acknowledge all
              </button>
            )}
          </div>

          {alerts.length === 0 ? (
            <div style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, padding: "10px 6px" }}>
              No threshold breaches — all metrics within targets.
            </div>
          ) : (
            sortedAlerts.map((a) => {
              const isAcked = acked.has(a.id);
              const dir = directionSymbolFor(a);
              return (
                <div key={a.id} style={{ padding: "8px 6px", borderBottom: `1px solid ${t.ruleSoft}`, opacity: isAcked ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: a.severity === "breach" ? t.accent : t.inkSoft }}>
                    <IconAlert size={14} />
                    {a.severity === "breach" ? "Breach" : "Warning"}
                  </div>
                  <div style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: 600, color: t.ink, marginTop: 3 }}>
                    {a.scopeLabel} — {METRIC_LABEL[a.metric]}
                  </div>
                  <div style={{ fontFamily: fonts.mono, fontSize: 11.5, color: t.inkSoft, marginTop: 2 }}>
                    {formatMetricValue(a.metric, a.value)} vs target {dir}{formatMetricValue(a.metric, a.threshold)}
                  </div>
                  <div style={{ fontFamily: fonts.body, fontSize: 11, color: t.inkSoft, marginTop: 2 }}>{a.windowLabel}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <button onClick={() => view(a)} style={menuBtnStyle(t)}>
                      View
                    </button>
                    {isAcked ? (
                      <span style={{ fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft, fontWeight: 700, textTransform: "uppercase" }}>Acknowledged</span>
                    ) : (
                      <button onClick={() => ackOne(a.id)} style={menuBtnStyle(t)}>
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <div aria-live="polite" role="status" className="sr-only">
        {announceMsg ?? ""}
      </div>
    </div>
  );
}
