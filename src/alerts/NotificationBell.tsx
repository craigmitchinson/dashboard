import { useEffect, useRef, useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { IconBell, IconAlert } from "../components/icons";
import { useAlerts } from "./alerts-context";
import { headlineFor, severityLabelFor } from "./format";

// ---------------------------------------------------------------------------
// alerts/NotificationBell.tsx
// ---------------------------------------------------------------------------
// Header bell + a COMPACT preview dropdown. The full alert feed — with
// per-row actions (Open page, Acknowledge/Unacknowledge), the "Hide
// acknowledged" toggle, and the summary toolbar — now lives on the dedicated
// Alerts page (alerts/AlertsPage.tsx). This panel is deliberately
// informational-only: the top 5 alerts as one-line entries with no action
// buttons, plus a prominent "View all alerts →" deep link.
//
// Evaluation + ack state are NOT owned here — both come from the single
// shared AlertsProvider (alerts/alerts-context.tsx) so the bell, the nav
// badge and the Alerts page can never diverge or re-evaluate
// evaluateAlerts() independently.
//
// Interaction pattern mirrors ViewsMenu in App.tsx exactly (a lightweight
// dropdown menu, not a focus-trapped modal): outside-mousedown closes,
// Escape closes and returns focus to the trigger, ArrowUp/ArrowDown cycles
// focus among the panel's buttons, and focus moves to the panel's first
// button on open.
// ---------------------------------------------------------------------------

const PREVIEW_COUNT = 5;

export function NotificationBell({ setPageId }: { setPageId: (id: string) => void }) {
  const t = useTheme();
  const { alerts, sortedAlerts, acked, unackedCount, ackAll } = useAlerts();

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

  const goToAlertsPage = () => {
    setPageId("alerts");
    setOpen(false);
  };

  const badgeText = unackedCount > 9 ? "9+" : String(unackedCount);
  // Unacknowledged alerts always take priority for the 5 preview slots (in
  // the shared sort order), so acking something can never make it linger in
  // place of a newer unacked alert. Only once every unacked alert is showing
  // do we backfill remaining slots with acknowledged alerts (also in sort
  // order) so the panel still shows up to 5 rows when there are enough
  // alerts overall — those backfilled rows are visually marked as
  // acknowledged below (mirrors AlertsPage's muted + "Acknowledged" tag).
  const unackedAlerts = sortedAlerts.filter((a) => !acked.has(a.id));
  const ackedAlerts = sortedAlerts.filter((a) => acked.has(a.id));
  const preview =
    unackedAlerts.length >= PREVIEW_COUNT
      ? unackedAlerts.slice(0, PREVIEW_COUNT)
      : [...unackedAlerts, ...ackedAlerts.slice(0, PREVIEW_COUNT - unackedAlerts.length)];

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
          className="dropdown-panel liquid-glass"
          style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, width: 320, maxHeight: 420, overflowY: "auto", border: `1px solid ${t.ruleSoft}`, padding: 8 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 8px", borderBottom: `1px solid ${t.ruleSoft}`, marginBottom: 6 }}>
            <span style={{ fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: t.ink }}>
              {unackedCount} unacknowledged
            </span>
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
            preview.map((a) => {
              const isAcked = acked.has(a.id);
              return (
                <div
                  key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 6px", borderBottom: `1px solid ${t.ruleSoft}`, opacity: isAcked ? 0.6 : 1 }}
                >
                  <IconAlert size={13} style={{ flex: "0 0 auto", color: a.severity === "breach" ? t.accent : t.inkSoft }} />
                  <span
                    style={{
                      fontFamily: fonts.body,
                      fontSize: 12.5,
                      color: t.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                      flex: 1,
                    }}
                    title={headlineFor(a)}
                  >
                    <strong style={{ fontWeight: 700, color: a.severity === "breach" ? t.accent : t.inkSoft }}>
                      {severityLabelFor(a)}
                    </strong>
                    {" — "}
                    {headlineFor(a)}
                  </span>
                  {isAcked && (
                    <span
                      style={{
                        flex: "0 0 auto",
                        fontFamily: fonts.mono,
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        color: t.inkSoft,
                      }}
                    >
                      Acknowledged
                    </span>
                  )}
                </div>
              );
            })
          )}

          <button
            onClick={goToAlertsPage}
            style={{
              width: "100%",
              textAlign: "left",
              marginTop: 6,
              fontFamily: fonts.mono,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              border: "none",
              background: "transparent",
              color: t.accent,
              cursor: "pointer",
              padding: "8px 6px 4px",
            }}
          >
            View all alerts →
          </button>
        </div>
      )}

      <div aria-live="polite" role="status" className="sr-only">
        {announceMsg ?? ""}
      </div>
    </div>
  );
}
