// ---------------------------------------------------------------------------
// components/command-ranking.ts — pure ranking/recents helpers
// ---------------------------------------------------------------------------
// Split out of CommandPalette.tsx (unchanged in behaviour) so these can be
// unit-tested without importing CommandPalette.tsx itself, which pulls in
// Portal/useAnchoredPopover/theme-context and JSX at module scope —
// CommandPalette.tsx re-exports these same names for the app's own usage, so
// this file is the one place their behaviour is defined. Nothing here
// touches the DOM at import time; `localStorage` is only ever reached inside
// try/catch'd function bodies (loadRecents/saveRecents), same convention as
// src/reference/reference-store.ts.
// ---------------------------------------------------------------------------

export interface RecentEntry {
  id: string;
  label: string;
  group: string;
}

export function recentsKey(userId: string | undefined) {
  return `bp-cmdk-recent::${userId ?? ""}`;
}

export function loadRecents(userId: string | undefined): RecentEntry[] {
  try {
    const raw = localStorage.getItem(recentsKey(userId));
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveRecents(userId: string | undefined, list: RecentEntry[]) {
  try {
    localStorage.setItem(recentsKey(userId), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// Ranking tiers, lowest (best) first: exact prefix on the label, any word in
// the label starting with the query, then an in-order (not necessarily
// contiguous) subsequence fuzzy match. Returns null for no match at all.
export function matchTier(label: string, query: string): 0 | 1 | 2 | null {
  if (!query) return 0;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l.startsWith(q)) return 0;
  const words = l.split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 1;
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++;
  }
  return qi === q.length ? 2 : null;
}

// Generic over any item shaped like a palette row (id + label) so this module
// never needs to import CommandPalette.tsx's own PaletteItem type — avoids a
// circular import now that CommandPalette.tsx re-exports from here.
export function rankPool<T extends { id: string; label: string }>(pool: T[], query: string, recentIds: string[]): T[] {
  const scored: { item: T; tier: number; recency: number; idx: number }[] = [];
  pool.forEach((item, idx) => {
    const tier = matchTier(item.label, query);
    if (tier === null) return;
    const recency = recentIds.indexOf(item.id);
    scored.push({ item, tier, recency: recency === -1 ? Infinity : recency, idx });
  });
  scored.sort((a, b) => a.tier - b.tier || a.recency - b.recency || a.idx - b.idx);
  return scored.map((s) => s.item);
}
