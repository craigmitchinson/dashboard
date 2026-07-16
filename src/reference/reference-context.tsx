import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { REFERENCE_BASE } from "../rpaData";
import {
  appendChangelog,
  clearOverlay,
  exportReferenceJson,
  exportReferenceSql,
  loadOverlay,
  mergeReference,
  saveOverlay,
  SCHEMA_VERSION,
} from "./reference-store";
import type { ChangelogEntry, OverlaySnapshot, ReferenceJson } from "./reference-store";

// ---------------------------------------------------------------------------
// reference-context.tsx
// ---------------------------------------------------------------------------
// Holds the editable reference-data store: a BASE reference (normally
// REFERENCE_BASE from rpaData.ts, populated by initData() from model.json's
// embedded `reference` field before first render) overlaid with whatever's in
// localStorage, so editing reference data in the browser changes every money
// figure instantly via filters-context.tsx's rate tables.
// ---------------------------------------------------------------------------

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
  dirty: boolean;
  changelog: ChangelogEntry[];
  /**
   * Set by two independent failure paths, each with its own message: (1) the
   * defensive fallback fetch of reference.json failing (only reachable if
   * REFERENCE_BASE was never populated by initData() — figures may render £0),
   * and (2) update()'s saveOverlay() write failing (edit applied in memory but
   * not persisted, e.g. storage quota). On a money dashboard a silent failure
   * is worse than a visible one, so both surface here rather than only
   * console.error'd. Admin.tsx renders this as its page-top error banner.
   */
  error: string | null;
}

const ReferenceContext = createContext<ReferenceCtx | null>(null);

const FALLBACK_URL = `${import.meta.env.BASE_URL}data/reference/reference.json`;

export function ReferenceProvider({ children }: { children: ReactNode }) {
  // Defensive fetch fallback: shouldn't normally trigger since main.tsx
  // populates REFERENCE_BASE via initData() before the app renders — mirrors
  // main.tsx's own DATA_URL/BASE_URL swap-point convention.
  const [fetchedBase, setFetchedBase] = useState<ReferenceJson | null>(null);
  // Two independent failure domains, deliberately in separate slots so a
  // successful save can never dismiss a load failure (and vice versa) — the
  // context's `error` is derived from both below, load errors first.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
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
        // Surfaced via context.error (not just console.error) so a consumer
        // CAN show a banner instead of silently rendering every KPI as £0
        // against EMPTY_REFERENCE. See the `error` doc comment on ReferenceCtx.
        if (!cancelled) setLoadError(`Reference data unavailable (${err instanceof Error ? err.message : String(err)}) — figures may show as £0 until this is resolved.`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const base = REFERENCE_BASE ?? fetchedBase;

  const [overlaySnapshot, setOverlaySnapshot] = useState<OverlaySnapshot | null>(() => loadOverlay());
  // Synchronous mirror of overlaySnapshot so update() can read the latest
  // snapshot even when several edits land in the same tick (state itself only
  // settles after the render). Written at every site that writes the state.
  const overlayRef = useRef(overlaySnapshot);

  const reference = useMemo<ReferenceJson>(() => {
    // base can only be null very transiently (before the defensive fetch
    // fallback resolves) — fall back to an empty-shaped reference so callers
    // never see undefined/null.
    const resolvedBase = base ?? EMPTY_REFERENCE;
    return mergeReference(resolvedBase, overlaySnapshot?.reference ?? null);
  }, [base, overlaySnapshot]);

  const update = useCallback(
    (mutator: (draft: ReferenceJson) => ReferenceJson | void, opts?: { section?: string; actor?: string }) => {
      // Computed OUTSIDE the setState updater (via overlayRef) so the
      // localStorage write runs exactly once per edit and its result is
      // always observed — inside an updater React may re-invoke the function
      // (eager-state check, render phase) and the render-phase result is
      // never seen by code after the dispatch.
      const prev = overlayRef.current;
      const resolvedBase = base ?? EMPTY_REFERENCE;
      const current = mergeReference(resolvedBase, prev?.reference ?? null);
      const draft: ReferenceJson = { ...current };
      const result = mutator(draft);
      const nextReference = result ?? draft;
      const editedAt = new Date().toISOString();
      const changelog = appendChangelog(prev?.changelog ?? [], {
        ts: editedAt,
        section: opts?.section ?? "reference",
        actor: opts?.actor,
      });
      const snapshot: OverlaySnapshot = {
        version: (prev?.version ?? 0) + 1,
        schemaVersion: SCHEMA_VERSION,
        editedBy: opts?.actor ?? prev?.editedBy,
        editedAt,
        reference: nextReference,
        changelog,
      };
      overlayRef.current = snapshot;
      // localStorage persistence is best-effort — the in-memory state always
      // updates so the session keeps working even if the write fails (quota
      // exceeded, private-browsing storage disabled, etc.). Failure is
      // surfaced via `saveError`, which Admin.tsx's ErrorBanner renders.
      const saved = saveOverlay(snapshot);
      setOverlaySnapshot(snapshot);
      setSaveError(
        saved
          ? null
          : "Couldn't save your edit — browser storage may be full. Your change is still applied for this session, but won't survive a reload.",
      );
    },
    [base],
  );

  const resetToBase = useCallback(() => {
    clearOverlay();
    overlayRef.current = null;
    setOverlaySnapshot(null);
    setSaveError(null);
  }, []);

  const exportJson = useCallback(() => exportReferenceJson(reference), [reference]);
  const exportSql = useCallback(() => exportReferenceSql(reference), [reference]);

  const value: ReferenceCtx = {
    reference,
    update,
    resetToBase,
    exportJson,
    exportSql,
    dirty: overlaySnapshot != null,
    changelog: overlaySnapshot?.changelog ?? [],
    error: loadError ?? saveError,
  };

  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function useReference() {
  const ctx = useContext(ReferenceContext);
  if (!ctx) throw new Error("useReference must be used within ReferenceProvider");
  return ctx;
}

// Empty-shaped placeholder for the sliver of time (if ever) before the base
// reference resolves — keeps every consumer's array/record access safe.
const EMPTY_REFERENCE: ReferenceJson = {
  spokes: [],
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
  targets: { completionPct: 0, exceptionRate: 0, systemRate: 0, costPerCase: 0, utilMin: 0, utilMax: 0 },
  thresholdOverrides: [],
};
