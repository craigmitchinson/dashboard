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

// ---------------------------------------------------------------------------
// Snoozing ("Snooze until resolved") — a per-user localStorage set, same
// namespacing pattern as acks above, but keyed WITHOUT the data-through date
// component of Alert.id (`${metric}|${scope}|${scopeId}|${dataThroughISO}`)
// so a snooze survives a data build instead of expiring on every one the way
// an ack effectively does (acks are keyed on the full id, dataThroughISO
// included, so they naturally "expire" once that date moves on — snoozing is
// deliberately the opposite: it should keep hiding the SAME recurring
// breach/warning across builds, and only stop once that condition itself
// stops appearing at all).
// ---------------------------------------------------------------------------

const SNOOZE_STORAGE_KEY = "bp-alert-snooze-v1";

function snoozeKey(userId: string | undefined): string {
  return userId ? `${SNOOZE_STORAGE_KEY}::${userId}` : SNOOZE_STORAGE_KEY;
}

export function readSnoozes(userId: string | undefined): string[] {
  try {
    const raw = localStorage.getItem(snoozeKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSnoozes(userId: string | undefined, keys: string[]): void {
  try {
    localStorage.setItem(snoozeKey(userId), JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}

// An Alert.id is `${metric}|${scope}|${scopeId}|${dataThroughISO}` (see
// engine.ts) — the snooze key is everything but that trailing date segment.
// Split (not a fixed-count destructure) so it's robust to a scopeId that
// itself legitimately contains "|" — the date segment is always the LAST
// pipe-delimited part, so dropping it is safe regardless of how many parts
// precede it.
export function alertSnoozeKey(alertId: string): string {
  const parts = alertId.split("|");
  return parts.slice(0, -1).join("|");
}

// The snooze pruning rule: a snoozed key survives a data build only as long
// as SOME current alert still maps to that same key — once a build produces
// no alert with that key (the condition it named has genuinely resolved),
// the snooze is dropped so the next recurrence of that same
// metric|scope|scopeId shows up fresh rather than staying silently hidden
// forever. Pure and order-preserving (stable subset of `snoozed`) so it's
// trivial to unit test.
export function pruneSnoozes(snoozed: string[], currentAlertIds: string[]): string[] {
  const present = new Set(currentAlertIds.map(alertSnoozeKey));
  return snoozed.filter((key) => present.has(key));
}
