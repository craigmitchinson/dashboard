// ---------------------------------------------------------------------------
// help/tour-storage.ts
// ---------------------------------------------------------------------------
// Per-user "have they seen the first-run tour" flag, namespaced the same way
// App.tsx namespaces its own persisted keys (see keyFor/readNamespaced there)
// — bp-tour-v1::{userId} = done. try/catch around every localStorage access:
// a private-browsing/blocked-storage session must never crash the app, it
// should just show the tour every time instead.
// ---------------------------------------------------------------------------

const KEY_BASE = "bp-tour-v1";

export function tourKey(userId: string | undefined): string {
  return userId ? `${KEY_BASE}::${userId}` : KEY_BASE;
}

export function hasTourRun(userId: string | undefined): boolean {
  try {
    return localStorage.getItem(tourKey(userId)) != null;
  } catch {
    // Storage unavailable — treat as "already seen" so we fail closed
    // (never showing an unwanted tour) rather than looping every render.
    return true;
  }
}

export function markTourDone(userId: string | undefined): void {
  try {
    localStorage.setItem(tourKey(userId), "1");
  } catch {
    /* ignore */
  }
}
