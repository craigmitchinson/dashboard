import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useReference } from "../reference/reference-context";
import { useAuth } from "../auth/auth-context";
import type { Filters } from "../filters-context";
import { evaluateAlerts } from "./engine";
import type { Alert } from "./engine";
import { sortAlerts } from "./format";
import { readAcks, writeAcks } from "./acks";

// ---------------------------------------------------------------------------
// alerts/alerts-context.tsx
// ---------------------------------------------------------------------------
// The SINGLE shared evaluation + ack-state provider. evaluateAlerts() is
// expensive-ish (walks the trailing window across four scopes) and ack state
// must be identical everywhere it's read, so the bell, the nav badge and the
// Alerts page all read from this one provider instead of each calling
// evaluateAlerts() and holding their own ack Set.
// ---------------------------------------------------------------------------

interface AlertsCtx {
  alerts: Alert[]; // evaluateAlerts(reference) output, filtered to what the signed-in user may see (see AlertsProvider)
  sortedAlerts: Alert[]; // sortAlerts(alerts)
  acked: Set<string>;
  ackOne: (id: string) => void;
  unackOne: (id: string) => void;
  ackAll: () => void;
  // Acks exactly the given ids (idempotent — already-acked ids are a no-op).
  // Added for AlertsPage's "Acknowledge all", which must act on the
  // slicer-filtered subset only, not every alert the user can see (that
  // remains ackAll's contract, unchanged, for NotificationBell).
  ackMany: (ids: string[]) => void;
  unackedCount: number;
  breachCount: number; // UNACKED breaches
  warnCount: number; // UNACKED warns
  ackedCount: number; // acked count among CURRENT alerts
}

const AlertsContext = createContext<AlertsCtx | null>(null);

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { reference } = useReference();
  const { user } = useAuth();

  // Deliberately depends ONLY on `reference` — alerts are estate/spoke/
  // process/vdi-scoped facts, not filter-relative, so re-evaluating on every
  // slicer change would be both wrong and wasteful.
  const rawAlerts = useMemo(() => evaluateAlerts(reference), [reference]);

  // --- spoke-scoped visibility -----------------------------------------
  // Applied ONCE, here, immediately after the raw evaluation, so every
  // downstream consumer (bell, nav badge, Alerts page) inherits the same
  // visible set automatically — none of them call evaluateAlerts()
  // themselves or see `rawAlerts`.
  //
  // Rule: an admin, or a CoE-wide user (spokeIds.length === 0, which also
  // naturally covers admin), sees every alert unfiltered. A spoke-scoped
  // user (non-empty spokeIds) sees every estate-scope alert PLUS every
  // alert whose spokeFilter is one of their spokeIds.
  //
  // Judgment call: a vdi-scope alert for a Hub-owned VDI has
  // spokeFilter: undefined and scope: "vdi" (not "estate"). Read literally,
  // the rule above EXCLUDES it for a spoke-scoped user — it's neither
  // estate-scope nor does its spokeFilter match anything in their
  // spokeIds. We keep that literal reading rather than special-casing
  // undefined-spokeFilter vdi alerts into visibility: a Hub-owned VDI is a
  // CoE/hub operational concern, not any one spoke's, so a spoke-scoped
  // user not seeing it is consistent with "a spoke's staff shouldn't see
  // other spokes' (or the hub's) breaches."
  const alerts = useMemo(() => {
    if (!user) return rawAlerts;
    const isAdmin = user.roles.includes("admin");
    if (isAdmin || user.spokeIds.length === 0) return rawAlerts;
    return rawAlerts.filter((a) => a.scope === "estate" || (a.spokeFilter !== undefined && user.spokeIds.includes(a.spokeFilter)));
  }, [rawAlerts, user]);

  const sortedAlerts = useMemo(() => sortAlerts(alerts), [alerts]);
  const alertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);

  const [acked, setAcked] = useState<Set<string>>(() => {
    const loaded = readAcks(user?.id);
    return new Set(loaded.filter((id) => alertIds.has(id)));
  });

  // Re-prune whenever the alerts set changes after mount (e.g. reference
  // edited while state was already initialized) so a stale ack id can never
  // linger — Alert.id embeds the data-through date (see engine.ts), so an
  // ack naturally expires once the data-through date moves on.
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
    writeAcks(user?.id, [...acked]);
  }, [acked, user?.id]);

  const ackOne = useCallback((id: string) => setAcked((prev) => new Set(prev).add(id)), []);
  const unackOne = useCallback(
    (id: string) =>
      setAcked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  const ackAll = useCallback(
    () =>
      setAcked((prev) => {
        const next = new Set(prev);
        alerts.forEach((a) => next.add(a.id));
        return next;
      }),
    [alerts],
  );
  const ackMany = useCallback(
    (ids: string[]) =>
      setAcked((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      }),
    [],
  );

  const unackedCount = useMemo(() => alerts.filter((a) => !acked.has(a.id)).length, [alerts, acked]);
  const breachCount = useMemo(() => alerts.filter((a) => !acked.has(a.id) && a.severity === "breach").length, [alerts, acked]);
  const warnCount = useMemo(() => alerts.filter((a) => !acked.has(a.id) && a.severity === "warn").length, [alerts, acked]);
  const ackedCount = useMemo(() => alerts.filter((a) => acked.has(a.id)).length, [alerts, acked]);

  const value: AlertsCtx = {
    alerts,
    sortedAlerts,
    acked,
    ackOne,
    unackOne,
    ackAll,
    ackMany,
    unackedCount,
    breachCount,
    warnCount,
    ackedCount,
  };

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsCtx {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used within AlertsProvider");
  return ctx;
}

/**
 * Same cascade the original NotificationBell's local `view()` had — lifted
 * out so the bell and the Alerts page call one shared implementation instead
 * of duplicating it. Resets proposition/queue alongside spoke/processId
 * (matching Slicers.tsx's convention of resetting dependent/narrower filters
 * together) so a stale proposition or queue selection can't intersect with
 * the newly-set spoke/processId and leave the destination page showing zero
 * rows.
 */
export function viewAlert(alert: Alert, setFilters: (f: Partial<Filters>) => void, setPageId: (id: string) => void): void {
  setFilters({ spoke: alert.spokeFilter ?? "All", proposition: "All", processId: alert.processFilter ?? "All", queue: "All" });
  setPageId(alert.pageId);
}
