// ---------------------------------------------------------------------------
// reference-store.ts — the server-side reference-data persistence
// interface, implemented by InMemoryReferenceStore (fixture mode, see
// fixtures.ts) and SqlReferenceStore (real mode, see sql.ts). GET/PUT
// /api/reference (routes/reference.ts) code against this interface only.
// ---------------------------------------------------------------------------

export interface ReferenceSnapshot {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reference: Record<string, any>;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PutReferenceInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reference: Record<string, any>;
  actor: string;
  section: string;
  expectedVersion: number;
}

export class VersionConflictError extends Error {
  current: ReferenceSnapshot;
  constructor(current: ReferenceSnapshot) {
    super(`Reference data has changed (current version ${current.version}); refetch and retry.`);
    this.current = current;
  }
}

export interface ReferenceStore {
  get(): Promise<ReferenceSnapshot>;
  /** Transactional write of ALL reference tables in FK-safe order (see
   *  sql.ts's TABLE_WRITE_ORDER, mirroring src/reference/reference-store.ts's
   *  exportReferenceSql), JSON-only sections into RefAppSettings, a
   *  RefVersion bump, and a RefChangeLog insert — or throws
   *  VersionConflictError if `expectedVersion` doesn't match. */
  put(input: PutReferenceInput): Promise<ReferenceSnapshot>;
}
