// ---------------------------------------------------------------------------
// tests/filters-sanitize.test.ts
// ---------------------------------------------------------------------------
// src/filters-context.tsx's sanitizeFilters — independent per-field validity
// PLUS the spoke -> proposition -> process -> queue cascade: an internally
// inconsistent combination (e.g. spoke A paired with a process that actually
// belongs to spoke B) must never survive, or every row silently filters out.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { initData, type ModelJson } from "../src/rpaData";
import { sanitizeFilters, DEFAULT_FILTERS } from "../src/filters-context";
import { makeModel } from "./fixtures";

type ProcessSrc = ModelJson["processes"][number];

function process(id: number, name: string, spoke: string, proposition: string, queue: string): ProcessSrc {
  return {
    id,
    name,
    acronym: name.slice(0, 3).toUpperCase(),
    description: "",
    proposition,
    spoke,
    queues: [{ queue, stage: null, order: 1 }],
    smvMinutes: 10,
    grade: "G1",
    gradeName: "Grade 1",
    currentHourly: 20,
    icon: "form",
    tags: [],
  };
}

const SPOKE_A = { id: 1, name: "SpokeA", short: "A", colorLight: "#111", colorDark: "#eee" };
const SPOKE_B = { id: 2, name: "SpokeB", short: "B", colorLight: "#222", colorDark: "#ddd" };

initData(
  makeModel({
    meta: { generatedAt: "2026-01-01T00:00:00.000Z", source: "test", sourceRows: 0, dateMin: "2026-01-01", dateMax: "2026-01-10", unmappedQueues: [] },
    spokes: [SPOKE_A, SPOKE_B],
    processes: [
      process(1, "Proc A1", "SpokeA", "PropA", "Q-A1"),
      process(2, "Proc B1", "SpokeB", "PropB", "Q-B1"),
    ],
  }),
);

describe("sanitizeFilters: per-field validity", () => {
  it("returns DEFAULT_FILTERS for non-object input", () => {
    expect(sanitizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters("nonsense")).toEqual(DEFAULT_FILTERS);
  });

  it("falls back to All for an unknown spoke/proposition/process/queue", () => {
    const out = sanitizeFilters({ spoke: "Ghost", proposition: "Ghost", processId: "999", queue: "Q-GHOST", tags: [], range: 90 });
    expect(out.spoke).toBe("All");
    expect(out.proposition).toBe("All");
    expect(out.processId).toBe("All");
    expect(out.queue).toBe("All");
  });

  it("keeps an internally-consistent combination untouched", () => {
    const out = sanitizeFilters({ spoke: "SpokeA", proposition: "PropA", processId: "1", queue: "Q-A1", tags: [], range: 30 });
    expect(out).toMatchObject({ spoke: "SpokeA", proposition: "PropA", processId: "1", queue: "Q-A1", range: 30 });
  });
});

describe("sanitizeFilters: cascade enforcement", () => {
  it("resets processId AND queue when the process's spoke does not match the selected spoke", () => {
    // spoke SpokeA, but processId 2 actually belongs to SpokeB.
    const out = sanitizeFilters({ spoke: "SpokeA", proposition: "All", processId: "2", queue: "Q-B1", tags: [], range: 90 });
    expect(out.spoke).toBe("SpokeA");
    expect(out.processId).toBe("All");
    expect(out.queue).toBe("All");
  });

  it("resets proposition when its own spoke does not match the selected spoke", () => {
    const out = sanitizeFilters({ spoke: "SpokeA", proposition: "PropB", processId: "All", queue: "All", tags: [], range: 90 });
    expect(out.proposition).toBe("All");
  });

  it("resets processId when its own proposition does not match the selected proposition", () => {
    // spoke left All so the spoke-cascade rule doesn't itself already reset
    // processId — isolates the proposition-vs-processId rule.
    const out = sanitizeFilters({ spoke: "All", proposition: "PropA", processId: "2", queue: "All", tags: [], range: 90 });
    expect(out.processId).toBe("All");
  });

  it("resets queue when its owning process does not match the selected processId", () => {
    const out = sanitizeFilters({ spoke: "All", proposition: "All", processId: "1", queue: "Q-B1", tags: [], range: 90 });
    expect(out.processId).toBe("1");
    expect(out.queue).toBe("All");
  });

  it("a fully cross-spoke combination (spoke A + proposition B + process B + queue B) collapses cleanly to spoke A only", () => {
    const out = sanitizeFilters({ spoke: "SpokeA", proposition: "PropB", processId: "2", queue: "Q-B1", tags: [], range: 90 });
    expect(out).toEqual({ spoke: "SpokeA", proposition: "All", processId: "All", queue: "All", tags: [], range: 90, from: undefined, to: undefined });
  });
});
