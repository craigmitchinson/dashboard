// ---------------------------------------------------------------------------
// reference/backend.ts
// ---------------------------------------------------------------------------
// Where reference-context.tsx's editable reference-data store actually reads
// from / writes to, abstracted behind one small interface so the context
// itself doesn't need an `if (DATA_MODE === ...)` at every call site. Two
// implementations:
//   - LocalStorageBackend: wraps the existing loadOverlay/saveOverlay pure
//     functions in reference-store.ts — behaviour identical to what
//     reference-context.tsx did inline before this abstraction existed (same
//     version-increment-per-edit + changelog-append logic, just relocated).
//   - ApiBackend: GET/PUT against {API}/api/reference via src/data/client.ts,
//     with If-Match optimistic concurrency — a version mismatch comes back
//     as this module's own `conflict` result shape rather than a thrown
//     error, so reference-context.tsx can show a reconcile UI instead of a
//     generic failure.
//
// A note on "snapshot"/opts.changelog below: reference-context.tsx keeps
// owning changelog bookkeeping itself (computing the next ChangelogEntry[]
// via the existing appendChangelog() pure function, exactly as it always
// has) and simply hands the backend the FINAL changelog to persist alongside
// the reference — the server has no concept of this client-displayed
// changelog at all (PUT's wire body is just { reference, actor, section }),
// so ApiBackend.save() below ignores opts.changelog entirely; only
// LocalStorageBackend persists it (inside the localStorage overlay, same as
// today).
// ---------------------------------------------------------------------------

import { clearOverlay, loadOverlay, saveOverlay, SCHEMA_VERSION } from "./reference-store";
import type { ChangelogEntry, OverlaySnapshot, ReferenceJson } from "./reference-store";
import { DATA_MODE, fetchReferenceApi, putReferenceApi } from "../data/client";

export interface ReferenceLoadResult {
  reference: ReferenceJson;
  version: number;
  changelog: ChangelogEntry[];
}

export interface ReferenceSaveOptions {
  actor?: string;
  section?: string;
  /** The full changelog INCLUDING the new entry for this edit (caller
   *  computes it via appendChangelog() before calling save() — see the
   *  file-header comment above). Ignored by ApiBackend. */
  changelog: ChangelogEntry[];
  /** The version this write is based on. ApiBackend sends it as the
   *  If-Match header for optimistic-concurrency conflict detection.
   *  LocalStorageBackend ignores it — it has its own independent version
   *  counter (there's only one browser writing to localStorage, so there is
   *  nothing to conflict with there). */
  expectedVersion: number;
}

export type ReferenceSaveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: { reference: ReferenceJson; version: number; updatedAt: string; updatedBy: string | null } }
  | { ok: false; error: string };

export interface ReferenceBackend {
  load(): Promise<ReferenceLoadResult | null>;
  save(reference: ReferenceJson, opts: ReferenceSaveOptions): Promise<ReferenceSaveResult>;
}

// --- local mode ------------------------------------------------------------

export class LocalStorageBackend implements ReferenceBackend {
  async load(): Promise<ReferenceLoadResult | null> {
    const snap = loadOverlay();
    return snap ? { reference: snap.reference, version: snap.version, changelog: snap.changelog } : null;
  }

  async save(reference: ReferenceJson, opts: ReferenceSaveOptions): Promise<ReferenceSaveResult> {
    // Re-reads the overlay fresh (rather than trusting a caller-supplied
    // version) so the version counter is authoritative here, exactly as it
    // was when this logic lived directly inside reference-context.tsx.
    const prev = loadOverlay();
    const editedAt = new Date().toISOString();
    const snapshot: OverlaySnapshot = {
      version: (prev?.version ?? 0) + 1,
      schemaVersion: SCHEMA_VERSION,
      editedBy: opts.actor ?? prev?.editedBy,
      editedAt,
      reference,
      changelog: opts.changelog,
    };
    const saved = saveOverlay(snapshot);
    return saved
      ? { ok: true, version: snapshot.version }
      : {
          ok: false,
          error:
            "Couldn't save your edit — browser storage may be full. Your change is still applied for this session, but won't survive a reload.",
        };
  }
}

/** Clears the local overlay entirely (used by reference-context.tsx's
 *  resetToBase() in local mode) — kept as a standalone export rather than a
 *  method on LocalStorageBackend so callers that only hold a `ReferenceBackend`
 *  (the narrower interface) aren't tempted to call a local-only reset; the
 *  context already knows which mode it's in when it calls this directly. */
export function clearLocalReferenceOverlay(): void {
  clearOverlay();
}

// --- api mode ----------------------------------------------------------------

export class ApiBackend implements ReferenceBackend {
  async load(): Promise<ReferenceLoadResult | null> {
    const res = await fetchReferenceApi();
    // api mode carries no persisted client-side changelog entries of its
    // own — the server is its own audit trail (actor/section per PUT).
    // reference-context.tsx starts a fresh, session-local changelog display
    // list from here, appending one entry per successful edit made in THIS
    // session (see its own comment) rather than trying to reconstruct one.
    return { reference: res.reference, version: res.version, changelog: [] };
  }

  async save(reference: ReferenceJson, opts: ReferenceSaveOptions): Promise<ReferenceSaveResult> {
    const result = await putReferenceApi({ reference, actor: opts.actor, section: opts.section }, opts.expectedVersion);
    if (result.ok) return { ok: true, version: result.version };
    if (result.kind === "conflict") return { ok: false, conflict: result.current };
    // "forbidden" | "auth" | "error" all collapse to the generic error slot
    // here — each already carries a user-legible message (src/data/client.ts
    // constructs "auth"'s message as "please sign in again", "forbidden"'s
    // from the server's own { error } body) and reference-context.tsx's
    // existing `error` state exists to show exactly this kind of thing.
    return { ok: false, error: result.message };
  }
}

// --- selection ---------------------------------------------------------------

export function createReferenceBackend(): ReferenceBackend {
  return DATA_MODE === "api" ? new ApiBackend() : new LocalStorageBackend();
}
