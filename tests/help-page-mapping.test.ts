// ---------------------------------------------------------------------------
// tests/help-page-mapping.test.ts
// ---------------------------------------------------------------------------
// src/help/page-mapping.ts — the page id -> feature-catalogue section id map
// the help drawer keys its content on, checked against the real section ids
// in docs/feature-catalogue.data.mjs so the mapping can never silently point
// at a section that doesn't exist (or stop pointing at one that gets
// renamed).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { PAGE_SECTION_MAP, sectionIdForPage, metricIdsForPage, PAGE_METRIC_ALLOWLIST } from "../src/help/page-mapping";
import { SECTIONS } from "../docs/feature-catalogue.data.mjs";

const REAL_SECTION_IDS = new Set(SECTIONS.map((s) => s.id));
const METRIC_ITEM_IDS = new Set(SECTIONS.find((s) => s.id === "metrics")!.items.map((it) => it.id));

describe("PAGE_SECTION_MAP", () => {
  it("maps every dashboard page id spelled out in the brief", () => {
    const expectedPageIds = [
      "overview",
      "alerts",
      "input-outcome",
      "process",
      "exceptions",
      "process-detail",
      "capacity",
      "exec",
      "value",
      "commercial",
      "admin",
      "model",
      "playbook",
    ];
    for (const id of expectedPageIds) {
      expect(PAGE_SECTION_MAP[id], `missing mapping for page "${id}"`).toBeDefined();
    }
  });

  it("every mapped section id exists in the real feature catalogue", () => {
    for (const [pageId, sectionId] of Object.entries(PAGE_SECTION_MAP)) {
      expect(REAL_SECTION_IDS.has(sectionId), `page "${pageId}" maps to unknown section "${sectionId}"`).toBe(true);
    }
  });

  it("sectionIdForPage returns undefined for an unknown page", () => {
    expect(sectionIdForPage("not-a-real-page")).toBeUndefined();
  });

  it("model and playbook (Reference group) share the same reference section", () => {
    expect(PAGE_SECTION_MAP.model).toBe(PAGE_SECTION_MAP.playbook);
  });
});

describe("PAGE_METRIC_ALLOWLIST", () => {
  it("overview matches the metric set given verbatim by the brief", () => {
    expect(new Set(PAGE_METRIC_ALLOWLIST.overview)).toEqual(
      new Set(["m-completion", "m-cpc", "m-exceptions", "m-netfte", "m-completed", "m-timesaved", "m-excrate", "m-outcomemix"]),
    );
  });

  it("every allowlisted metric id exists in the real metric dictionary", () => {
    for (const [pageId, ids] of Object.entries(PAGE_METRIC_ALLOWLIST)) {
      for (const id of ids) {
        expect(METRIC_ITEM_IDS.has(id), `page "${pageId}" allowlists unknown metric "${id}"`).toBe(true);
      }
    }
  });

  it("metricIdsForPage falls back to an empty list for a page with no entry", () => {
    expect(metricIdsForPage("not-a-real-page")).toEqual([]);
  });
});
