import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { REFERENCE_BASE } from "../rpaData";
import { appendChangelog, exportReferenceJson, exportReferenceSql, loadOverlay, mergeReference } from "./reference-store";
import type { ChangelogEntry, ReferenceJson } from "./reference-store";
import { DATA_MODE } from "../data/client";
import { clearLocalReferenceOverlay, createReferenceBackend } from "./backend";
import type { ReferenceBackend, ReferenceSaveResult } from "./backend";

// ---------------------------------------------------------------------------
// reference-context.tsx
// ---------------------------------------------------------------------------
// Holds the editable reference-data store.
//
// LOCAL mode (DATA_MODE === "local", unchanged from before the api-mode work
// below existed): a BASE reference (REFERENCE_BASE from rpaData.ts, populated
// by initData() from model.json's embedded `reference` field before first
// render) overlaid with whatever's in localStorage, so editing reference
// data in the browser changes every money figure instantly via
// filters-context.tsx's rate tables.
//
// API mode (DATA_MODE === "api"): there is no bundled base to fall back to —
// the reference IS whatever the API's GET /api/reference last returned (see
// src/reference/backend.ts's ApiBackend), no localStorage overlay involved.
// update() applies an edit OPTIMISTICALLY (the UI reflects it immediately)
// and fires the PUT in the background; a 409 surfaces as `conflict` (see
// resolveConflict()); a network/server failure keeps the edit applied in
// memory and surfaces `pendingSync` + `error`, with retrySync() to try again.
// ---------------------------------------------------------------------------

interface ConflictState {
  /** The reference this browser tried to save. */
  mine: ReferenceJson;
  /** The reference actually current on the server right now. */
  theirs: ReferenceJson;
  theirsVersion: number;
  theirsUpdatedAt: string;
  theirsUpdatedBy: string | null;
}

interface ReferenceCtx {
  reference: ReferenceJson;
  /**
   * mutator receives a shallow copy of the current reference (top-level
   * fields copied, NOT deep-cloned) and should either mutate it and return
   * nothing, or return a whole new reference object. Replace top-level
   * arrays (e.g. `draft.resources = [...]`) rather than mutating an array
   * in place — deep mutation of nested arrays/objects on the shallow copy is
   * not guaranteed to be observed by the memoized rate tables downstream.
   */
  update(mutator: (draft: ReferenceJson) => ReferenceJson | void, opts?: { section?: string; actor?: string }): void;
  resetToBase(): void;
  exportJson(): string;
  exportSql(): string;
  /** True whenever an edit has been applied this session (an overlay exists
   *  in local mode, or the api-mode loaded state has diverged from what was
   *  last confirmed-loaded from the server) — same meaning as before this
   *  file grew api-mode support; unrelated to whether that edit has finished
   *  SYNCING (see `pendingSync` for that, api mode only). */
  dirty: boolean;
  changelog: ChangelogEntry[];
  /**
   * Set by independent failure paths, each with its own message: (1) the
   * initial load failing (local mode: the defensive fallback fetch of
   * reference.json, only reachable if REFERENCE_BASE was never populated by
   * initData(); api mode: GET /api/reference failing) — figures may render
   * £0; and (2) a save failing outright (not a conflict — see `conflict` for
   * that) — local mode: saveOverlay() write failure (e.g. storage quota);
   * api mode: PUT failing for a reason other than 409 (network, 403, expired
   * session, server error). On a money dashboard a silent failure is worse
   * than a visible one, so both surface here rather than only console.error'd.
   * Admin.tsx renders this as its page-top error banner.
   */
  error: string | null;
  // --- additive, api-mode-only fields (see src/reference/backend.ts) ---------
  /** True while a locally-applied edit hasn't yet been confirmed synced to
   *  the server. Always false in local mode (a local save completes synchronously
   *  enough that there's nothing meaningful to show as "pending"). */
  pendingSync: boolean;
  /** Set when a save() came back as a 409 (someone else's edit landed first
   *  against the version this edit was based on). Always null in local mode. */
  conflict: ConflictState | null;
  /** Resolves an active conflict: "reload" discards this browser's pending
   *  edit and adopts the server's current version; "overwrite" re-submits
   *  this browser's edit using the server's current version as the new
   *  base. No-op if there is no active conflict. */
  resolveConflict(strategy: "reload" | "overwrite"): void;
  /** Re-attempts persisting the last unsynced edit after a network/server
   *  error (not a conflict — see resolveConflict for that). No-op if
   *  there's nothing pending. */
  retrySync(): void;
}

const ReferenceContext = createContext<ReferenceCtx | null>(null);

const FALLBACK_URL = `${import.meta.env.BASE_URL}data/reference/reference.json`;

// One in-memory record of "the reference as last loaded from, or confirmed
// saved to, the store" — in local mode this is the localStorage overlay; in
// api mode it's the server's last-known state. `version` is the localStorage
// edit counter in local mode, or the server's optimistic-concurrency version
// in api mode — the two counters are unrelated but play the same role
// (what to send as the save's "expected previous version").
interface Loaded {
  reference: ReferenceJson;
  version: number;
  changelog: ChangelogEntry[];
}

export function ReferenceProvider({ children }: { children: ReactNode }) {
  const backend = useMemo<ReferenceBackend>(() => createReferenceBackend(), []);

  // Defensive fetch fallback (LOCAL MODE ONLY): shouldn't normally trigger
  // since main.tsx populates REFERENCE_BASE via initData() before the app
  // renders. Not meaningful in api mode — there is no bundled base there at
  // all, so this effect is a no-op when DATA_MODE === "api".
  const [fetchedBase, setFetchedBase] = useState<ReferenceJson | null>(null);
  // Two independent failure domains, deliberately in separate slots so a
  // successful save can never dismiss a load failure (and vice versa) — the
  // context's `error` is derived from both below, load errors first.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  useEffect(() => {
    if (DATA_MODE !== "local") return;
    if (REFERENCE_BASE) return;
    let cancelled = false;
    fetch(FALLBACK_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Reference fallback fetch returned ${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setFetchedBase(json as ReferenceJson);
      })
      .catch((err) => {
        console.error("ReferenceProvider: failed to fetch fallback reference.json", err);
        if (!cancelled) {
          setLoadError(
            `Reference data unavailable (${err instanceof Error ? err.message : String(err)}) — figures may show as £0 until this is resolved.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const base = REFERENCE_BASE ?? fetchedBase;

  // LOCAL mode hydrates synchronously (lazy initializer, matching the exact
  // timing this always had — loadOverlay() is a synchronous localStorage
  // read, so there's no flash of "no overlay yet"). API mode has nothing
  // synchronous to read — it hydrates via the effect below once GET
  // /api/reference resolves.
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    if (DATA_MODE !== "local") return null;
    const snap = loadOverlay();
    return snap ? { reference: snap.reference, version: snap.version, changelog: snap.changelog } : null;
  });
  // Synchronous mirror of `loaded` so update() can read the latest snapshot
  // even when several edits land in the same tick (state itself only
  // settles after the render). Written at every site that writes the state.
  const loadedRef = useRef(loaded);
  // The last edit that hasn't been confirmed synced (api mode conflict/error
  // paths) — what retrySync()/resolveConflict("overwrite") resubmit.
  // `previousChangelog` is the changelog as it stood BEFORE this edit's own
  // entry was appended — resolveConflict("reload") needs that (not the
  // current changelog, which still includes the discarded edit's entry) to
  // correctly drop the entry for an edit that's being thrown away.
  const pendingEditRef = useRef<{
    reference: ReferenceJson;
    section: string;
    actor?: string;
    expectedVersion: number;
    previousChangelog: ChangelogEntry[];
  } | null>(null);
  // Monotonic counter identifying "the most recently issued apply" — every
  // update()/resolveConflict("overwrite")/retrySync() call bumps it and
  // stamps its own async save resolution with the value it saw. If a NEWER
  // apply has since started by the time an OLDER save's promise settles,
  // that older resolution is stale and must not be allowed to overwrite the
  // newer optimistic state (see applySaveResult's guard) — otherwise two
  // rapid edits whose PUTs resolve out of order could silently revert the
  // later one.
  const saveSeqRef = useRef(0);

  useEffect(() => {
    if (DATA_MODE !== "api") return;
    let cancelled = false;
    backend
      .load()
      .then((result) => {
        if (cancelled) return;
        loadedRef.current = result;
        setLoaded(result);
        if (!result) {
          setLoadError("Reference data unavailable from the API — figures may show as £0 until this is resolved.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          `Reference data unavailable (${err instanceof Error ? err.message : String(err)}) — figures may show as £0 until this is resolved.`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const reference = useMemo<ReferenceJson>(() => {
    if (DATA_MODE === "api") {
      // No meaningful "base" independent of the server in api mode — see
      // the file-header comment. Falls back to EMPTY_REFERENCE only for the
      // brief window before the first load (or if it failed).
      return loaded?.reference ?? EMPTY_REFERENCE;
    }
    const resolvedBase = base ?? EMPTY_REFERENCE;
    return mergeReference(resolvedBase, loaded?.reference ?? null);
  }, [base, loaded]);

  const applySaveResult = useCallback(
    (
      result: ReferenceSaveResult,
      pending: { reference: ReferenceJson; section: string; actor?: string; expectedVersion: number; previousChangelog: ChangelogEntry[] },
      changelog: ChangelogEntry[],
      seq: number,
    ) => {
      // A newer update()/resolveConflict/retrySync call has already fired
      // since this one started — this resolution is stale (its edit has
      // been superseded), and applying it now would silently stomp the
      // newer optimistic state with older data. Drop it entirely; the
      // newer call's own resolution is the one that gets to win.
      if (seq !== saveSeqRef.current) return;
      if (result.ok) {
        const confirmed: Loaded = { reference: pending.reference, version: result.version, changelog };
        loadedRef.current = confirmed;
        setLoaded(confirmed);
        setPendingSync(false);
        setConflict(null);
        setSaveError(null);
        pendingEditRef.current = null;
        return;
      }
      pendingEditRef.current = pending;
      if ("conflict" in result) {
        setConflict({
          mine: pending.reference,
          theirs: result.conflict.reference,
          theirsVersion: result.conflict.version,
          theirsUpdatedAt: result.conflict.updatedAt,
          theirsUpdatedBy: result.conflict.updatedBy,
        });
        // pendingSync stays true — set at the optimistic-apply site below —
        // this edit is applied locally but unreconciled until
        // resolveConflict() runs.
        return;
      }
      setSaveError(
        DATA_MODE === "local" ? result.error : `${result.error} Your edit is kept for this session — use "Retry sync" to try again.`,
      );
      // pendingSync also stays true here in api mode (harmless/unsurfaced in
      // local mode, where the exposed `pendingSync` field is always false).
    },
    [],
  );

  const update = useCallback(
    (mutator: (draft: ReferenceJson) => ReferenceJson | void, opts?: { section?: string; actor?: string }) => {
      // Computed OUTSIDE any setState updater (via loadedRef) so this runs
      // exactly once per edit and its result is always observed — inside an
      // updater React may re-invoke the function (eager-state check, render
      // phase) and the render-phase result is never seen by code after the
      // dispatch.
      const prev = loadedRef.current;
      const current = DATA_MODE === "api" ? (prev?.reference ?? EMPTY_REFERENCE) : mergeReference(base ?? EMPTY_REFERENCE, prev?.reference ?? null);
      const draft: ReferenceJson = { ...current };
      const result = mutator(draft);
      const nextReference = result ?? draft;
      const editedAt = new Date().toISOString();
      const section = opts?.section ?? "reference";
      const changelog = appendChangelog(prev?.changelog ?? [], { ts: editedAt, section, actor: opts?.actor });
      const expectedVersion = prev?.version ?? 0;

      // Optimistic apply: the UI reflects the edit immediately in BOTH
      // modes — local mode always behaved this way (a synchronous
      // localStorage write completing before this function returns); api
      // mode now behaves the same way from the caller's point of view, with
      // the PUT happening in the background rather than blocking the edit
      // from being seen.
      const optimistic: Loaded = { reference: nextReference, version: expectedVersion + 1, changelog };
      loadedRef.current = optimistic;
      setLoaded(optimistic);
      setPendingSync(true);
      const mySeq = ++saveSeqRef.current;

      const pending = { reference: nextReference, section, actor: opts?.actor, expectedVersion, previousChangelog: prev?.changelog ?? [] };
      pendingEditRef.current = pending;
      backend
        .save(nextReference, { actor: opts?.actor, section, changelog, expectedVersion })
        .then((res) => applySaveResult(res, pending, changelog, mySeq))
        .catch((err) => {
          // backend.save() implementations are written to never reject, but
          // guard anyway — an unhandled rejection here would otherwise be
          // silent (money-figures context, see the ReferenceCtx.error doc).
          applySaveResult({ ok: false, error: err instanceof Error ? err.message : String(err) }, pending, changelog, mySeq);
        });
    },
    [base, backend, applySaveResult],
  );

  const resolveConflict = useCallback(
    (strategy: "reload" | "overwrite") => {
      const c = conflict;
      if (!c) return;
      if (strategy === "reload") {
        // Discards the pending edit entirely — restore the changelog to how
        // it stood BEFORE that edit's own entry was appended (not the
        // current changelog, which still includes it), so the session's
        // changelog display never shows an entry for a change that was
        // thrown away rather than applied.
        const previousChangelog = pendingEditRef.current?.previousChangelog ?? loadedRef.current?.changelog ?? [];
        const next: Loaded = { reference: c.theirs, version: c.theirsVersion, changelog: previousChangelog };
        loadedRef.current = next;
        setLoaded(next);
        setPendingSync(false);
        setConflict(null);
        setSaveError(null);
        pendingEditRef.current = null;
        // Invalidate any older in-flight save resolution (e.g. a retrySync
        // this reload raced with) so it can't land afterward and stomp the
        // reloaded state — see applySaveResult's seq guard.
        saveSeqRef.current++;
        return;
      }
      // "overwrite": re-submit our version, now based on the server's
      // current version as the new expected-previous-version.
      const pending = pendingEditRef.current;
      if (!pending) {
        setConflict(null);
        return;
      }
      const changelog = loadedRef.current?.changelog ?? [];
      const rebasedPending = { ...pending, expectedVersion: c.theirsVersion };
      pendingEditRef.current = rebasedPending;
      setPendingSync(true);
      const mySeq = ++saveSeqRef.current;
      backend
        .save(pending.reference, { actor: pending.actor, section: pending.section, changelog, expectedVersion: c.theirsVersion })
        .then((res) => applySaveResult(res, rebasedPending, changelog, mySeq))
        .catch((err) => applySaveResult({ ok: false, error: err instanceof Error ? err.message : String(err) }, rebasedPending, changelog, mySeq));
    },
    [conflict, backend, applySaveResult],
  );

  const retrySync = useCallback(() => {
    const pending = pendingEditRef.current;
    if (!pending) return;
    const changelog = loadedRef.current?.changelog ?? [];
    setPendingSync(true);
    const mySeq = ++saveSeqRef.current;
    backend
      .save(pending.reference, { actor: pending.actor, section: pending.section, changelog, expectedVersion: pending.expectedVersion })
      .then((res) => applySaveResult(res, pending, changelog, mySeq))
      .catch((err) => applySaveResult({ ok: false, error: err instanceof Error ? err.message : String(err) }, pending, changelog, mySeq));
  }, [backend, applySaveResult]);

  const resetToBase = useCallback(() => {
    setSaveError(null);
    setPendingSync(false);
    setConflict(null);
    pendingEditRef.current = null;
    // Invalidate any in-flight save resolution — resetToBase() discards
    // whatever edit was pending, the same way resolveConflict("reload")
    // does above.
    saveSeqRef.current++;
    if (DATA_MODE === "local") {
      clearLocalReferenceOverlay();
      loadedRef.current = null;
      setLoaded(null);
      return;
    }
    // api mode: there is no independent "base" to reset to — reload the
    // current server state, discarding any unsynced local edit.
    backend
      .load()
      .then((result) => {
        loadedRef.current = result;
        setLoaded(result);
        if (!result) setLoadError("Reference data unavailable from the API — figures may show as £0 until this is resolved.");
        else setLoadError(null);
      })
      .catch((err) => {
        setLoadError(`Couldn't reload reference data from the server (${err instanceof Error ? err.message : String(err)}).`);
      });
  }, [backend]);

  const exportJson = useCallback(() => exportReferenceJson(reference), [reference]);
  const exportSql = useCallback(() => exportReferenceSql(reference), [reference]);

  const value: ReferenceCtx = {
    reference,
    update,
    resetToBase,
    exportJson,
    exportSql,
    // LOCAL mode: unchanged — true whenever a localStorage overlay exists,
    // matching this field's original meaning exactly. API MODE: `loaded`
    // becomes non-null the instant the initial GET resolves (before any
    // edit at all), so "loaded != null" would make this permanently true
    // from boot onward — instead reuse `pendingSync`'s already-correct
    // "there's an edit not yet confirmed synced" meaning, which is exactly
    // what Admin.tsx's "Unsynced local edits" pill / "Discard local edits"
    // affordance actually needs.
    dirty: DATA_MODE === "api" ? pendingSync : loaded != null,
    changelog: loaded?.changelog ?? [],
    error: loadError ?? saveError,
    pendingSync: DATA_MODE === "api" ? pendingSync : false,
    conflict: DATA_MODE === "api" ? conflict : null,
    resolveConflict,
    retrySync,
  };

  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function useReference() {
  const ctx = useContext(ReferenceContext);
  if (!ctx) throw new Error("useReference must be used within ReferenceProvider");
  return ctx;
}

// Empty-shaped placeholder for the sliver of time (if ever) before the base/
// loaded reference resolves — keeps every consumer's array/record access safe.
const EMPTY_REFERENCE: ReferenceJson = {
  spokes: [],
  grades: [],
  gradeRates: [],
  propositions: [],
  processes: [],
  queueMap: [],
  resources: [],
  vdiOperatingHoursPerDay: 0,
  vdiCostHistory: [],
  estateCostHistory: [],
  peopleCostHistory: [],
  exceptionPatterns: [],
  exceptionDisplayCodes: {},
  targets: { completionPct: 0, exceptionRate: 0, systemRate: 0, costPerCase: 0, utilMin: 0, utilMax: 0, vdiStaleDays: 14 },
  thresholdOverrides: [],
};
