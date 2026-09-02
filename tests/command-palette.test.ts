// ---------------------------------------------------------------------------
// tests/command-palette.test.ts
// ---------------------------------------------------------------------------
// Covers src/components/command-ranking.ts's pure ranking/recents helpers
// (re-exported unchanged from src/components/CommandPalette.tsx, which is not
// imported here — it pulls in Portal/useAnchoredPopover/theme-context and
// JSX at module scope, none of which this "node" test environment provides).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach } from "vitest";
import { matchTier, rankPool, loadRecents, saveRecents, recentsKey } from "../src/components/command-ranking";
import type { RecentEntry } from "../src/components/command-ranking";

// Mirrors CommandPalette.tsx's own private PaletteItem shape closely enough
// for rankPool's generic constraint ({ id, label }).
interface Item {
  id: string;
  label: string;
  group: string;
}

// CommandPalette.tsx's own private caps (MAX_PER_GROUP / MAX_TOTAL) — kept in
// sync by hand since they are not exported (only the ranking/recents helpers
// are); see the task note in command-ranking.ts.
const MAX_PER_GROUP = 6;
const MAX_TOTAL = 24;
const GROUP_ORDER = ["Pages", "Processes", "Spokes", "Saved views", "Alerts", "Actions", "Help"];

describe("matchTier", () => {
  it("empty query matches everything at tier 0", () => {
    expect(matchTier("Anything at all", "")).toBe(0);
  });

  it("exact prefix match is tier 0", () => {
    expect(matchTier("Investment Onboarding", "invest")).toBe(0);
  });

  it("a word-start (not label-start) match is tier 1", () => {
    expect(matchTier("Investment Onboarding", "onboard")).toBe(1);
  });

  it("an in-order but non-contiguous subsequence match is tier 2", () => {
    // "iob" only appears as a subsequence: I-nvestment -nB-oarding — the 'o'
    // used comes from "Onboarding", not "Investment".
    expect(matchTier("Investment Onboarding", "iob")).toBe(2);
  });

  it("no match at all returns null", () => {
    expect(matchTier("Investment Onboarding", "xyz")).toBeNull();
  });

  it("tier ordering: exact prefix (0) outranks word-start (1) outranks subsequence (2)", () => {
    const exact = matchTier("Onboarding Investment", "onboarding");
    const wordStart = matchTier("Investment Onboarding", "onboard");
    const subsequence = matchTier("Investment Onboarding", "iob");
    expect(exact).toBe(0);
    expect(wordStart).toBe(1);
    expect(subsequence).toBe(2);
    expect(exact! < wordStart!).toBe(true);
    expect(wordStart! < subsequence!).toBe(true);
  });
});

describe("rankPool", () => {
  it("orders matches by tier first (prefix > word-start > subsequence), dropping non-matches", () => {
    const pool: Item[] = [
      { id: "1", label: "Review onboarding checklist", group: "Help" }, // word-start on "onboard" -> tier 1
      { id: "2", label: "Nothing relevant here", group: "Help" }, // no match -> excluded
      { id: "3", label: "Onboard investment review", group: "Help" }, // label-start on "onboard" -> tier 0
    ];
    const ranked = rankPool(pool, "onboard", []);
    expect(ranked.map((i) => i.id)).toEqual(["3", "1"]);
  });

  it('"inv onb" ranks "Drill into Investment Onboarding" above "Investment Servicing" and above a fuzzy-only match', () => {
    const pool: Item[] = [
      // Also a subsequence match for "inv onb" (contains the literal
      // substring "Inv" ... "Onb" out of order relative to the target's own
      // words), inserted first so a naive insertion-order fallback would
      // otherwise beat the target.
      { id: "fuzzy", label: "Archived Inventory Onboard Backlog", group: "Processes" },
      { id: "target", label: "Drill into Investment Onboarding", group: "Processes" },
      // Does not match "inv onb" at all: after "inv" matches inside
      // "Investment", there is no "o" anywhere in "Servicing" for the
      // subsequence scan to find.
      { id: "servicing", label: "Investment Servicing", group: "Processes" },
    ];
    // Better recency for the target breaks the tie against the other
    // equally-fuzzy (tier 2) match, exactly as CommandPalette's own recency
    // tie-break does for two matches of the same tier.
    const ranked = rankPool(pool, "inv onb", ["target"]);
    expect(ranked.map((i) => i.id)).toEqual(["target", "fuzzy"]);
    expect(ranked.find((i) => i.id === "servicing")).toBeUndefined();
  });

  it("recency tie-break: within the same tier, a more recent id ranks first", () => {
    const pool: Item[] = [
      { id: "a", label: "Reset slicers", group: "Actions" },
      { id: "b", label: "Reset filters", group: "Actions" },
      { id: "c", label: "Reset view", group: "Actions" },
    ];
    // All three are tier 0 (label starts with "reset"); "c" was used most
    // recently (index 0 = most recent), "b" less recently, "a" never.
    const ranked = rankPool(pool, "reset", ["c", "b"]);
    expect(ranked.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("falls back to original pool order when tier and recency both tie", () => {
    const pool: Item[] = [
      { id: "first", label: "Reset slicers", group: "Actions" },
      { id: "second", label: "Reset filters", group: "Actions" },
    ];
    const ranked = rankPool(pool, "reset", []);
    expect(ranked.map((i) => i.id)).toEqual(["first", "second"]);
  });
});

describe("recentsKey", () => {
  it("namespaces the storage key by userId", () => {
    expect(recentsKey("u1")).toBe("bp-cmdk-recent::u1");
  });

  it("falls back to an empty userId segment when undefined", () => {
    expect(recentsKey(undefined)).toBe("bp-cmdk-recent::");
  });
});

describe("loadRecents / saveRecents persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when nothing has been stored for this user", () => {
    expect(loadRecents("nobody")).toEqual([]);
  });

  it("returns [] (not a throw) for corrupt stored JSON", () => {
    localStorage.setItem(recentsKey("broken"), "{not json");
    expect(loadRecents("broken")).toEqual([]);
  });

  it("round-trips a list written under this user's key", () => {
    const list: RecentEntry[] = [{ id: "page:alerts", label: "Alerts", group: "Pages" }];
    saveRecents("u1", list);
    expect(loadRecents("u1")).toEqual(list);
    // A different user's key is untouched.
    expect(loadRecents("u2")).toEqual([]);
  });

  it("keeps at most the last 8, most-recent-first, de-duplicated by id", () => {
    // Mirrors CommandPalette.tsx's own recordRecent: prepend, drop any prior
    // entry with the same id, cap at 8.
    const recordRecent = (prev: RecentEntry[], entry: RecentEntry): RecentEntry[] =>
      [entry, ...prev.filter((r) => r.id !== entry.id)].slice(0, 8);

    let recents: RecentEntry[] = [];
    for (let i = 0; i < 10; i++) {
      recents = recordRecent(recents, { id: `item-${i}`, label: `Item ${i}`, group: "Pages" });
      saveRecents("u1", recents);
    }
    const loaded = loadRecents("u1");
    expect(loaded).toHaveLength(8);
    // Most-recent-first: the last-recorded item (item-9) is first, and the
    // two oldest (item-0, item-1) were evicted by the 8-item cap.
    expect(loaded.map((r) => r.id)).toEqual(["item-9", "item-8", "item-7", "item-6", "item-5", "item-4", "item-3", "item-2"]);

    // Re-using an existing id moves it to the front instead of duplicating it.
    recents = recordRecent(recents, { id: "item-5", label: "Item 5", group: "Pages" });
    saveRecents("u1", recents);
    const afterReuse = loadRecents("u1");
    expect(afterReuse.map((r) => r.id)).toEqual(["item-5", "item-9", "item-8", "item-7", "item-6", "item-4", "item-3", "item-2"]);
    expect(afterReuse.filter((r) => r.id === "item-5")).toHaveLength(1);
  });
});

// The two composition rules below (the per-group/total caps, and the
// empty-query "Recent + Pages" branch) live in CommandPalette.tsx's own
// `items` useMemo, not in an exported helper — that memo is plain glue code
// around rankPool/loadRecents, so these tests replicate it verbatim (kept in
// sync by hand) to pin its behaviour via the helpers under test here.
describe("result composition built from rankPool (mirrors CommandPalette's items memo)", () => {
  it("caps each group at 6 and the combined total at 24", () => {
    const allItems: Item[] = [];
    for (const group of GROUP_ORDER) {
      for (let i = 0; i < 10; i++) {
        allItems.push({ id: `${group}:${i}`, label: `Reset ${group} ${i}`, group });
      }
    }
    let result: Item[] = [];
    for (const g of GROUP_ORDER) {
      if (result.length >= MAX_TOTAL) break;
      const pool = allItems.filter((i) => i.group === g);
      const ranked = rankPool(pool, "reset", []).slice(0, MAX_PER_GROUP);
      const room = MAX_TOTAL - result.length;
      result = result.concat(ranked.slice(0, room));
    }
    expect(result.length).toBe(MAX_TOTAL);
    // Only the first 4 groups (4 * 6 = 24) contribute given the room budget.
    const groupsRepresented = [...new Set(result.map((i) => i.group))];
    expect(groupsRepresented).toEqual(GROUP_ORDER.slice(0, 4));
    // Within the first group, only the best 6 (lowest original index — all
    // tier 0, so idx tie-break) survive the per-group cap.
    const firstGroupIds = result.filter((i) => i.group === GROUP_ORDER[0]).map((i) => i.id);
    expect(firstGroupIds).toEqual([0, 1, 2, 3, 4, 5].map((i) => `${GROUP_ORDER[0]}:${i}`));
  });

  it("empty query resolves to Recent (from loadRecents) followed by Pages, nothing else", () => {
    const allItems: Item[] = [
      { id: "page:hub", label: "Hub", group: "Pages" },
      { id: "page:alerts", label: "Alerts", group: "Pages" },
      { id: "process:123", label: "Drill into Loan Review", group: "Processes" },
    ];
    const recents: RecentEntry[] = [{ id: "process:123", label: "Drill into Loan Review", group: "Processes" }];

    const byId = new Map(allItems.map((i) => [i.id, i] as const));
    const recentItems: Item[] = [];
    for (const r of recents) {
      const live = byId.get(r.id);
      if (live) recentItems.push({ ...live, group: "Recent" });
    }
    const pages = allItems.filter((i) => i.group === "Pages");
    const result = [...recentItems, ...pages].slice(0, MAX_TOTAL);

    expect(result.map((i) => i.id)).toEqual(["process:123", "page:hub", "page:alerts"]);
    expect(result[0].group).toBe("Recent");
  });
});
