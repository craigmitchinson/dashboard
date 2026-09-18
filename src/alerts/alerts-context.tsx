import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useReference } from "../reference/reference-context";
import { useAuth } from "../auth/auth-context";
import type { Filters } from "../filters-context";
import type { User } from "../auth/types";
import { RES_ROWS, PROCESS_BY_ID } from "../rpaData";
import { evaluateAlerts } from "./engine";
import type { Alert } from "./engine";
import { sortAlerts } from "./format";
import { readAcks, writeAcks, readSnoozes, writeSnoozes, alertSnoozeKey, pruneSnoozes } from "./acks";

// Index: VDI id (Alert.scopeLabel for scope:"vdi", same as VDIS[].id/name and
// RES_ROWS[].resource) -> the set of spokes whose processes actually ran on
// it, per the resource fact rows. Pulled out as a plain function (no React,
// no module-level rpaData bindings baked in) so it — and scopeAlertsForUser
// below — can be unit tested with fabricated rows instead of only through
// initData()+evaluateAlerts().
export function buildVdiSpokeIndex(
  resRows: { resource: string; processId: string }[],
  spokeForProcess: (processId: string) => string | undefined,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of resRows) {
    const spoke = spokeForProcess(r.processId);
    if (!spoke) continue;
    let s = m.get(r.resource);
    if (!s) m.set(r.resource, (s = new Set()));
    s.add(spoke);
  }
  return m;
}

// The spoke-scoped visibility rule (see the doc comment where this is
// called, below) as a pure function: an admin, or a CoE-wide user
// (spokeIds.length === 0), sees every alert unfiltered. A spoke-scoped user
// sees every estate-scope alert, every alert whose spokeFilter is one of
// their spokeIds, AND — the hub-owned-VDI exception — a vdi-scope alert
// (spokeFilter undefined) for a Hub-owned VDI that ran at least one of
// their spoke's processes per `vdiSpokesById`.
export function scopeAlertsForUser(
  rawAlerts: Alert[],
  user: Pick<User, "roles" | "spokeIds"> | null | undefined,
  vdiSpokesById: Map<string, Set<string>>,
): Alert[] {
  if (!user) return rawAlerts;
  const isAdmin = user.roles.includes("admin");
  if (isAdmin || user.spokeIds.length === 0) return rawAlerts;
  return rawAlerts.filter((a) => {
    if (a.scope === "estate") return true;
    if (a.spokeFilter !== undefined) return user.spokeIds.includes(a.spokeFilter);
    if (a.scope === "vdi") {
      const spokesRan = vdiSpokesById.get(a.scopeLabel);
      return !!spokesRan && user.spokeIds.some((s) => spokesRan.has(s));
    }
    return false;
  });
}

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
  sortedAlerts: Alert[]; // sortAlerts(alerts) — INCLUDES snoozed alerts (AlertsPage's "Show snoozed" toggle reads this)
  // `alerts`/`sortedAlerts` minus anything currently snoozed by this user —
  // what the bell and the Alerts page (by default, "Show snoozed" off) read.
  visibleAlerts: Alert[];
  sortedVisibleAlerts: Alert[];
  acked: Set<string>;
  ackOne: (id: string) => void;
  unackOne: (id: string) => void;
  ackAll: () => void;
  // Acks exactly the given ids (idempotent — already-acked ids are a no-op).
  // Added for AlertsPage's "Acknowledge all", which must act on the
  // slicer-filtered subset only, not every alert the user can see (that
  // remains ackAll's contract, unchanged, for NotificationBell).
  ackMany: (ids: string[]) => void;
  // Snoozing ("Snooze until resolved") — see acks.ts's alertSnoozeKey/
  // pruneSnoozes doc comments for why this is a SEPARATE, date-independent
  // key from acks. A snoozed alert is dropped from visibleAlerts/counts, but
  // stays in `alerts`/`sortedAlerts` so "Show snoozed" can still reveal it.
  isSnoozed: (alertId: string) => boolean;
  snoozeOne: (alertId: string) => void;
  unsnoozeOne: (alertId: string) => void;
  unackedCount: number; // UNACKED, non-snoozed
  breachCount: number; // UNACKED, non-snoozed breaches
  warnCount: number; // UNACKED, non-snoozed warns
  ackedCount: number; // acked count among CURRENT, non-snoozed alerts
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
  // A vdi-scope alert for a Hub-owned VDI has spokeFilter: undefined and
  // scope: "vdi" (not "estate") — read literally, the rule above would
  // exclude it for every spoke-scoped user. We carve out ONE exception (see
  // scopeAlertsForUser above): a hub-owned VDI is still visible to a
  // spoke-scoped hub lead/member if that VDI actually ran one of THEIR
  // spoke's processes (resolved from the resource fact rows, RES_ROWS ->
  // processId -> PROCESS_BY_ID.spoke, via buildVdiSpokeIndex) — the VDI is
  // hub-owned, but the work it did belongs to their spoke, so its health is
  // their concern too. A hub-owned VDI that never touched any of their
  // spoke's processes remains a pure CoE/hub concern and stays hidden.
  const vdiSpokesById = useMemo(
    () => buildVdiSpokeIndex(RES_ROWS, (id) => PROCESS_BY_ID.get(id)?.spoke),
    [], // RES_ROWS/PROCESS_BY_ID are populated once at data load, not per-render
  );

  const alerts = useMemo(() => scopeAlertsForUser(rawAlerts, user, vdiSpokesById), [rawAlerts, user, vdiSpokesById]);

  const sortedAlerts = useMemo(() => sortAlerts(alerts), [alerts]);
  const alertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);

  // Guards for the user-switch reload effect further down (defined after
  // both `acked` and `snoozed` state exist) — see its doc comment for why
  // these are needed. Declared up front so the write effects below (which
  // reference them) type-check regardless of source order.
  const prevUserIdRef = useRef(user?.id);
  const skipAckWriteRef = useRef(false);
  const skipSnoozeWriteRef = useRef(false);

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
    if (skipAckWriteRef.current) {
      skipAckWriteRef.current = false;
      return;
    }
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

  // Snoozing ("Snooze until resolved") — see acks.ts's alertSnoozeKey/
  // pruneSnoozes doc comments. Initialized from storage, then pruned against
  // the CURRENT alert set (`alerts` — the already permission-scoped set,
  // same basis acks use) every time it changes, so a snooze whose condition
  // has genuinely resolved (no alert maps to that key any more) is dropped
  // rather than lingering forever.
  const [snoozed, setSnoozed] = useState<Set<string>>(() => {
    const loaded = readSnoozes(user?.id);
    const currentKeys = alerts.map((a) => a.id);
    return new Set(pruneSnoozes(loaded, currentKeys));
  });

  useEffect(() => {
    setSnoozed((prev) => {
      const currentKeys = alerts.map((a) => a.id);
      const pruned = pruneSnoozes([...prev], currentKeys);
      return pruned.length === prev.size ? prev : new Set(pruned);
    });
  }, [alerts]);

  useEffect(() => {
    if (skipSnoozeWriteRef.current) {
      skipSnoozeWriteRef.current = false;
      return;
    }
    writeSnoozes(user?.id, [...snoozed]);
  }, [snoozed, user?.id]);

  // Reload acked/snoozed from storage whenever the SIGNED-IN USER changes —
  // AlertsProvider is not guaranteed to remount across a user switch (e.g.
  // refreshSession() after an admin edits the user directory), so without
  // this, `acked`/`snoozed` would still hold the PREVIOUS user's in-memory
  // sets, and the write effects above (keyed on user?.id) would immediately
  // persist that stale data under the NEW user's storage key, clobbering
  // whatever they'd already saved there. `prevUserIdRef` skips this on the
  // initial mount (state is already correctly loaded for that user via the
  // lazy initializers above) and on any render where the id hasn't actually
  // changed. Setting the skip*WriteRef flags here suppresses the write
  // effects' very next run — which, in the SAME commit, still sees the OLD
  // acked/snoozed values (this effect's setState calls only take effect on
  // the following render) — so they never get a chance to write stale data
  // under the new key; once the reload's setState re-renders, those write
  // effects fire again, flags now clear, and correctly persist the
  // just-reloaded (i.e. already-correct) data back under the new user.
  useEffect(() => {
    if (prevUserIdRef.current === user?.id) return;
    prevUserIdRef.current = user?.id;
    skipAckWriteRef.current = true;
    skipSnoozeWriteRef.current = true;
    const loadedAcks = readAcks(user?.id);
    setAcked(new Set(loadedAcks.filter((id) => alertIds.has(id))));
    const currentKeys = alerts.map((a) => a.id);
    const loadedSnoozes = readSnoozes(user?.id);
    setSnoozed(new Set(pruneSnoozes(loadedSnoozes, currentKeys)));
  }, [user?.id, alertIds, alerts]);

  const isSnoozed = useCallback((id: string) => snoozed.has(alertSnoozeKey(id)), [snoozed]);
  const snoozeOne = useCallback((id: string) => setSnoozed((prev) => new Set(prev).add(alertSnoozeKey(id))), []);
  const unsnoozeOne = useCallback(
    (id: string) =>
      setSnoozed((prev) => {
        const next = new Set(prev);
        next.delete(alertSnoozeKey(id));
        return next;
      }),
    [],
  );

  const visibleAlerts = useMemo(() => alerts.filter((a) => !isSnoozed(a.id)), [alerts, isSnoozed]);
  const sortedVisibleAlerts = useMemo(() => sortAlerts(visibleAlerts), [visibleAlerts]);

  const unackedCount = useMemo(() => visibleAlerts.filter((a) => !acked.has(a.id)).length, [visibleAlerts, acked]);
  const breachCount = useMemo(() => visibleAlerts.filter((a) => !acked.has(a.id) && a.severity === "breach").length, [visibleAlerts, acked]);
  const warnCount = useMemo(() => visibleAlerts.filter((a) => !acked.has(a.id) && a.severity === "warn").length, [visibleAlerts, acked]);
  const ackedCount = useMemo(() => visibleAlerts.filter((a) => acked.has(a.id)).length, [visibleAlerts, acked]);

  const value: AlertsCtx = {
    alerts,
    sortedAlerts,
    visibleAlerts,
    sortedVisibleAlerts,
    acked,
    ackOne,
    unackOne,
    ackAll,
    ackMany,
    isSnoozed,
    snoozeOne,
    unsnoozeOne,
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
