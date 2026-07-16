// ---------------------------------------------------------------------------
// alerts/acks.ts
// ---------------------------------------------------------------------------
// Pure (no React) localStorage persistence for per-user alert acknowledgements.
// Extracted from the original NotificationBell.tsx so the shared
// AlertsProvider (alerts/alerts-context.tsx) can own ack state without a
// component file needing to expose these as a side effect of import.
// Same localStorage key ("bp-alert-acks-v1") and per-user namespacing as
// before — no migration needed.
// ---------------------------------------------------------------------------

const ACKS_STORAGE_KEY = "bp-alert-acks-v1";

function ackKey(userId: string | undefined): string {
  return userId ? `${ACKS_STORAGE_KEY}::${userId}` : ACKS_STORAGE_KEY;
}

export function readAcks(userId: string | undefined): string[] {
  try {
    const raw = localStorage.getItem(ackKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeAcks(userId: string | undefined, ids: string[]): void {
  try {
    localStorage.setItem(ackKey(userId), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export { ACKS_STORAGE_KEY, ackKey };
