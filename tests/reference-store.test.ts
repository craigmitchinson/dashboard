// ---------------------------------------------------------------------------
// tests/reference-store.test.ts
// ---------------------------------------------------------------------------
// Covers src/reference/reference-store.ts's persistence semantics (overlay
// merge, SCHEMA_VERSION rejection), the FK-safe statement ordering + escaping
// of exportReferenceSql, and resolveThreshold's precedence rule.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach } from "vitest";
import {
  mergeReference,
  exportReferenceSql,
  resolveThreshold,
  loadOverlay,
  saveOverlay,
  clearOverlay,
  SCHEMA_VERSION,
  BP_REFERENCE_STORAGE_KEY,
  type OverlaySnapshot,
} from "../src/reference/reference-store";
import { makeReference } from "./fixtures";

describe("mergeReference", () => {
  it("overlay replaces the base WHOLESALE when present", () => {
    const base = makeReference({ vdiOperatingHoursPerDay: 20 });
    const overlay = makeReference({ vdiOperatingHoursPerDay: 24 });
    expect(mergeReference(base, overlay)).toBe(overlay);
    expect(mergeReference(base, overlay).vdiOperatingHoursPerDay).toBe(24);
  });

  it("a null overlay falls back to the base", () => {
    const base = makeReference({ vdiOperatingHoursPerDay: 20 });
    expect(mergeReference(base, null)).toBe(base);
  });
});

describe("resolveThreshold precedence: process > spoke > global", () => {
  it("a process-scoped override wins over a matching spoke-scoped override, which wins over the global target", () => {
    const reference = makeReference({
      spokes: [{ spokeId: 1, spokeName: "Spoke1", shortName: "S1", colorLight: "#111", colorDark: "#eee" }],
      propositions: [{ propositionId: 1, propositionName: "Prop1", spokeId: 1 }],
      processes: [
        { processId: 101, processName: "P101", processAcronym: "P1", processDescription: "", propositionId: 1, smvMinutes: 10, grade: "G1", isActive: true, icon: "form", tags: [] },
      ],
      targets: { completionPct: 0.9, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 },
      thresholdOverrides: [
        { scope: "spoke", scopeId: "Spoke1", metric: "completionPct", value: 0.8 },
        { scope: "process", scopeId: "101", metric: "completionPct", value: 0.7 },
      ],
    });

    // direct process override wins
    expect(resolveThreshold(reference, "completionPct", "process", "101")).toBe(0.7);
    // a process with no direct override, but whose spoke has one, inherits the spoke override
    const noDirect = makeReference({
      ...reference,
      thresholdOverrides: [{ scope: "spoke", scopeId: "Spoke1", metric: "completionPct", value: 0.8 }],
    });
    expect(resolveThreshold(noDirect, "completionPct", "process", "101")).toBe(0.8);
    // no overrides at all -> falls back to the global target
    const none = makeReference({ ...reference, thresholdOverrides: [] });
    expect(resolveThreshold(none, "completionPct", "process", "101")).toBe(0.9);
  });

  it("spoke-scope resolution only ever looks at spoke-scoped overrides for that exact spoke", () => {
    const reference = makeReference({
      targets: { completionPct: 0.9, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 },
      thresholdOverrides: [{ scope: "spoke", scopeId: "Spoke1", metric: "completionPct", value: 0.8 }],
    });
    expect(resolveThreshold(reference, "completionPct", "spoke", "Spoke1")).toBe(0.8);
    expect(resolveThreshold(reference, "completionPct", "spoke", "Spoke2")).toBe(0.9);
  });
});

describe("exportReferenceSql", () => {
  const reference = makeReference({
    spokes: [{ spokeId: 1, spokeName: "O'Brien Spoke", shortName: "OB", colorLight: "#111", colorDark: "#eee" }],
    grades: [{ grade: "G1", gradeName: "Grade 1", spokeIds: ["1"] }],
    gradeRates: [{ grade: "G1", gradeName: "Grade 1", effectiveFrom: "2020-01-01", hourlyCostGBP: 20 }],
    propositions: [{ propositionId: 1, propositionName: "Prop1", spokeId: 1 }],
    processes: [{ processId: 101, processName: "P101", processAcronym: "P1", processDescription: "", propositionId: 1, smvMinutes: 10, grade: "G1", isActive: true, icon: "form", tags: [] }],
    queueMap: [{ queueName: "Q1", processId: 101, stageName: null, stageOrder: null }],
    resources: [
      {
        resourceName: "VDI-1", botName: "B1", botAcronym: "B1", vdiName: "VDI-1", costClass: "prod", spokeId: 1,
        activeFrom: "2020-01-01", activeTo: null, notes: null, isActive: true,
        renewalDate: "2020-01-01", annualCostGBP: null, licenseExpiryDate: null, status: "active",
      },
    ],
  });
  const sql = exportReferenceSql(reference);

  it("deletes run child-first: RefQueueMap before RefProcess before RefProposition; RefResource before RefGradeSpoke/RefSpoke/RefGrade; RefGradeSpoke before RefGrade", () => {
    const idx = (needle: string) => {
      const i = sql.indexOf(needle);
      expect(i, `expected to find "${needle}" in the generated SQL`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const delQueueMap = idx("DELETE FROM core.RefQueueMap;");
    const delProcess = idx("DELETE FROM core.RefProcess;");
    const delProposition = idx("DELETE FROM core.RefProposition;");
    const delResource = idx("DELETE FROM core.RefResource;");
    const delGradeSpoke = idx("DELETE FROM core.RefGradeSpoke;");
    const delSpoke = idx("DELETE FROM core.RefSpoke;");
    const delGrade = idx("DELETE FROM core.RefGrade;");

    expect(delQueueMap).toBeLessThan(delProcess);
    expect(delProcess).toBeLessThan(delProposition);
    expect(delResource).toBeLessThan(delGradeSpoke);
    expect(delResource).toBeLessThan(delSpoke);
    expect(delGradeSpoke).toBeLessThan(delSpoke);
    expect(delGradeSpoke).toBeLessThan(delGrade);
  });

  it("inserts run parent-first: RefSpoke before RefGrade before RefGradeSpoke before RefProposition before RefProcess before RefQueueMap before RefResource", () => {
    const idx = (needle: string) => {
      const i = sql.indexOf(needle);
      expect(i, `expected to find "${needle}" in the generated SQL`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const insSpoke = idx("INSERT INTO core.RefSpoke");
    const insGrade = idx("INSERT INTO core.RefGrade ");
    const insGradeSpoke = idx("INSERT INTO core.RefGradeSpoke");
    const insProposition = idx("INSERT INTO core.RefProposition");
    const insProcess = idx("INSERT INTO core.RefProcess ");
    const insQueueMap = idx("INSERT INTO core.RefQueueMap");
    const insResource = idx("INSERT INTO core.RefResource");

    expect(insSpoke).toBeLessThan(insGrade);
    expect(insGrade).toBeLessThan(insGradeSpoke);
    expect(insGradeSpoke).toBeLessThan(insProposition);
    expect(insProposition).toBeLessThan(insProcess);
    expect(insProcess).toBeLessThan(insQueueMap);
    expect(insQueueMap).toBeLessThan(insResource);

    // all deletes still precede all inserts overall.
    expect(sql.indexOf("DELETE FROM core.RefQueueMap;")).toBeLessThan(insSpoke);
  });

  it("escapes a single quote in a name by doubling it", () => {
    expect(sql).toContain("O''Brien Spoke");
    expect(sql).not.toContain("'O'Brien Spoke'"); // would be a broken/unescaped literal
  });
});

describe("loadOverlay / saveOverlay / clearOverlay (localStorage overlay)", () => {
  beforeEach(() => {
    clearOverlay();
  });

  it("returns null with nothing stored", () => {
    expect(loadOverlay()).toBeNull();
  });

  it("round-trips a snapshot written under the current SCHEMA_VERSION", () => {
    const snapshot: OverlaySnapshot = {
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      editedAt: "2026-01-01T00:00:00.000Z",
      reference: makeReference(),
      changelog: [],
    };
    expect(saveOverlay(snapshot)).toBe(true);
    const loaded = loadOverlay();
    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded?.version).toBe(1);
  });

  it("rejects (returns null) an overlay whose schemaVersion is stale", () => {
    const stale = {
      version: 1,
      schemaVersion: SCHEMA_VERSION - 1,
      editedAt: "2026-01-01T00:00:00.000Z",
      reference: makeReference(),
      changelog: [],
    };
    localStorage.setItem(BP_REFERENCE_STORAGE_KEY, JSON.stringify(stale));
    expect(loadOverlay()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Finance settings additive fields: TargetsRef.fiscalYearStartMonth and
// ReferenceJson.financeTargets. Both are OPTIONAL and deliberately do NOT
// bump SCHEMA_VERSION (see reference-store.ts's SCHEMA_VERSION comment) — a
// reference/overlay written before these fields existed must still load and
// merge cleanly, with every consumer defaulting their absence rather than
// assuming presence.
// ---------------------------------------------------------------------------
describe("fiscalYearStartMonth / financeTargets: additive-optional, no SCHEMA_VERSION bump", () => {
  it("mergeReference tolerates an overlay reference with no fiscalYearStartMonth or financeTargets at all", () => {
    const base = makeReference();
    // Simulate a reference literal written before these fields existed —
    // TypeScript wouldn't stop us constructing this even without `as`, since
    // both fields are optional, but the explicit omission here is the point.
    const overlay = makeReference();
    expect((overlay.targets as { fiscalYearStartMonth?: number }).fiscalYearStartMonth).toBeUndefined();
    expect(overlay.financeTargets).toBeUndefined();
    const merged = mergeReference(base, overlay);
    expect(merged).toBe(overlay);
  });

  it("loadOverlay accepts a stored snapshot whose reference predates fiscalYearStartMonth/financeTargets, under the CURRENT schemaVersion", () => {
    clearOverlay();
    const preExisting = makeReference();
    delete (preExisting.targets as { fiscalYearStartMonth?: number }).fiscalYearStartMonth;
    delete preExisting.financeTargets;
    const snapshot: OverlaySnapshot = {
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      editedAt: "2026-01-01T00:00:00.000Z",
      reference: preExisting,
      changelog: [],
    };
    expect(saveOverlay(snapshot)).toBe(true);
    const loaded = loadOverlay();
    expect(loaded).not.toBeNull();
    expect(loaded?.reference.targets.fiscalYearStartMonth).toBeUndefined();
    expect(loaded?.reference.financeTargets).toBeUndefined();
  });

  it("a reference with fiscalYearStartMonth/financeTargets set round-trips through save/load unchanged", () => {
    clearOverlay();
    const reference = makeReference({
      targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14, fiscalYearStartMonth: 1 },
      financeTargets: [{ spokeId: "ESTATE", annualNetBenefitTargetGBP: 500000 }],
    });
    const snapshot: OverlaySnapshot = { version: 1, schemaVersion: SCHEMA_VERSION, editedAt: "2026-01-01T00:00:00.000Z", reference, changelog: [] };
    expect(saveOverlay(snapshot)).toBe(true);
    const loaded = loadOverlay();
    expect(loaded?.reference.targets.fiscalYearStartMonth).toBe(1);
    expect(loaded?.reference.financeTargets).toEqual([{ spokeId: "ESTATE", annualNetBenefitTargetGBP: 500000 }]);
  });
});
