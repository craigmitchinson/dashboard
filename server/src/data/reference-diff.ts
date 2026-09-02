// ---------------------------------------------------------------------------
// reference-diff.ts — computes which spokes (if any) a reference-data edit
// touches, and whether it touches anything GLOBAL (a section/row not
// attributable to one spoke). Drives the hub_lead PUT /api/reference
// enforcement in auth/middleware.ts: a hub_lead may only write changes whose
// every touched row resolves to a spoke in their own spokeIds, and MAY NOT
// touch anything global.
//
// Not a general-purpose deep-diff: it is keyed to reference-store.ts's
// ReferenceJson shape and each section's identity (a natural id column, or a
// composite key function for sections with no single-column identity), and
// attributes each added/removed/changed row to the spoke(s) it belongs to
// (BOTH the old and new spoke, if a row's own spoke assignment changed) — or
// to the GLOBAL sentinel when a row/section has no single owning spoke.
// ---------------------------------------------------------------------------

export const GLOBAL = "__global__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ref = Record<string, any>;

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function byKey<T extends Ref>(rows: T[] | undefined, keyFn: (row: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows ?? []) m.set(keyFn(r), r);
  return m;
}

/** Diffs two arrays keyed by `keyFn`, calling `attribute(row)` for every
 *  added/removed/changed row (old row for removals, new row for additions,
 *  BOTH for changes) and unioning the resulting spoke sets into `touched`. */
function diffArray<T extends Ref>(
  oldRows: T[] | undefined,
  newRows: T[] | undefined,
  keyFn: (row: T) => string,
  attribute: (row: T) => Set<string>,
  touched: Set<string>,
): void {
  const oldMap = byKey(oldRows, keyFn);
  const newMap = byKey(newRows, keyFn);
  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);
  for (const k of allKeys) {
    const o = oldMap.get(k);
    const n = newMap.get(k);
    if (!o && n) for (const s of attribute(n)) touched.add(s);
    else if (o && !n) for (const s of attribute(o)) touched.add(s);
    else if (o && n && !eq(o, n)) {
      for (const s of attribute(o)) touched.add(s);
      for (const s of attribute(n)) touched.add(s);
    }
  }
}

export interface ReferenceDiffResult {
  touchedSpokes: Set<string>; // spoke NAMEs
  touchesGlobal: boolean;
}

/**
 * Diffs `oldRef` -> `newRef` (both full ReferenceJson objects). Returns the
 * set of spoke NAMEs any changed row belongs to, plus whether any change
 * touches something GLOBAL (no single owning spoke — a rate card default, a
 * universal grade-rate row, the spokes[] dimension itself, targets, etc).
 */
export function diffReference(oldRef: Ref, newRef: Ref): ReferenceDiffResult {
  const touched = new Set<string>();
  let touchesGlobal = false;
  const markGlobal = () => {
    touchesGlobal = true;
  };

  const spokeNameOf = (ref: Ref, spokeId: number | string | null | undefined): string | typeof GLOBAL => {
    if (spokeId == null) return GLOBAL; // hub-owned / universal
    const s = (ref.spokes ?? []).find((x: Ref) => String(x.spokeId) === String(spokeId));
    return s ? s.spokeName : GLOBAL;
  };
  const spokeOfProposition = (ref: Ref, propositionId: number): string | typeof GLOBAL => {
    const p = (ref.propositions ?? []).find((x: Ref) => x.propositionId === propositionId);
    return p ? spokeNameOf(ref, p.spokeId) : GLOBAL;
  };
  const spokeOfProcess = (ref: Ref, processId: number): string | typeof GLOBAL => {
    const p = (ref.processes ?? []).find((x: Ref) => x.processId === processId);
    return p ? spokeOfProposition(ref, p.propositionId) : GLOBAL;
  };
  const asSet = (v: string | typeof GLOBAL): Set<string> => {
    if (v === GLOBAL) {
      markGlobal();
      return new Set();
    }
    return new Set([v]);
  };
  const unionSpoke = (a: string | typeof GLOBAL, b: string | typeof GLOBAL): Set<string> => {
    const s = new Set<string>();
    for (const x of asSet(a)) s.add(x);
    for (const x of asSet(b)) s.add(x);
    return s;
  };

  // --- whole-array-is-global sections: any change at all is global -------
  for (const section of ["grades", "exceptionPatterns", "estateCostHistory", "spokes"]) {
    if (!eq(oldRef[section], newRef[section])) markGlobal();
  }

  // --- scalar/object global sections --------------------------------------
  for (const key of ["targets", "exceptionDisplayCodes", "vdiOperatingHoursPerDay"]) {
    if (!eq(oldRef[key], newRef[key])) markGlobal();
  }

  // --- spoke-attributable arrays ------------------------------------------
  diffArray(
    oldRef.propositions,
    newRef.propositions,
    (row) => String(row.propositionId),
    (row) => asSet(spokeNameOf(newRef.spokes?.length ? newRef : oldRef, row.spokeId)),
    touched,
  );

  diffArray(
    oldRef.processes,
    newRef.processes,
    (row) => String(row.processId),
    (row) => unionSpoke(spokeOfProposition(oldRef, row.propositionId), spokeOfProposition(newRef, row.propositionId)),
    touched,
  );

  diffArray(
    oldRef.queueMap,
    newRef.queueMap,
    (row) => row.queueName,
    (row) => unionSpoke(spokeOfProcess(oldRef, row.processId), spokeOfProcess(newRef, row.processId)),
    touched,
  );

  diffArray(
    oldRef.resources,
    newRef.resources,
    (row) => row.resourceName,
    (row) => asSet(spokeNameOf(newRef.spokes?.length ? newRef : oldRef, row.spokeId)),
    touched,
  );

  const gradeRateKey = (row: Ref) => `${row.grade}|${row.effectiveFrom}|${row.spokeId ?? ""}`;
  diffArray(
    oldRef.gradeRates,
    newRef.gradeRates,
    gradeRateKey,
    (row) => (row.spokeId != null ? asSet(spokeNameOf(newRef, Number(row.spokeId))) : (markGlobal(), new Set<string>())),
    touched,
  );

  const vdiRateKey = (row: Ref) => `${row.costClass}|${row.effectiveFrom}|${row.spokeId ?? ""}`;
  diffArray(
    oldRef.vdiCostHistory,
    newRef.vdiCostHistory,
    vdiRateKey,
    (row) => (row.spokeId != null ? asSet(spokeNameOf(newRef, Number(row.spokeId))) : (markGlobal(), new Set<string>())),
    touched,
  );

  const peopleCostKey = (row: Ref) => `${row.ownerId}|${row.effectiveFrom}`;
  diffArray(oldRef.peopleCostHistory, newRef.peopleCostHistory, peopleCostKey, (row) => {
    if (row.ownerId === "HUB") {
      markGlobal();
      return new Set<string>();
    }
    return asSet(spokeNameOf(newRef, row.ownerId));
  }, touched);

  if (newRef.thresholdOverrides !== undefined || oldRef.thresholdOverrides !== undefined) {
    const thresholdKey = (row: Ref) => `${row.scope}|${row.scopeId}|${row.metric}`;
    diffArray(oldRef.thresholdOverrides, newRef.thresholdOverrides, thresholdKey, (row) => {
      if (row.scope === "spoke") return new Set([row.scopeId]);
      if (row.scope === "process") return unionSpoke(spokeOfProcess(oldRef, Number(row.scopeId)), spokeOfProcess(newRef, Number(row.scopeId)));
      markGlobal();
      return new Set<string>();
    }, touched);
  }

  // financeTargets: one net-benefit target per row, identified by spokeId —
  // which is either "ESTATE" (the whole-estate figure, GLOBAL/admin-only) or
  // a spoke NAME (matching thresholdOverrides' scope="spoke" scopeId
  // convention above — spokeId here is already the spoke's own name, not a
  // numeric id needing a spokes[] lookup).
  if (newRef.financeTargets !== undefined || oldRef.financeTargets !== undefined) {
    const financeTargetKey = (row: Ref) => String(row.spokeId);
    diffArray(oldRef.financeTargets, newRef.financeTargets, financeTargetKey, (row) => {
      if (row.spokeId === "ESTATE") {
        markGlobal();
        return new Set<string>();
      }
      return new Set([row.spokeId]);
    }, touched);
  }

  return { touchedSpokes: touched, touchesGlobal };
}
