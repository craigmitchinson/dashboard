// ---------------------------------------------------------------------------
// tests/alerts-format.test.ts
// ---------------------------------------------------------------------------
// src/alerts/format.ts: direction symbols, headline phrasing per
// classify()'s real branches (min/max x warn/breach), omitSpoke, and the
// staleVdi headline.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { directionSymbolFor, headlineFor, scopeContextFor } from "../src/alerts/format";
import type { Alert } from "../src/alerts/engine";
import { makeReference } from "./fixtures";

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "x",
    severity: "warn",
    metric: "completionPct",
    scope: "estate",
    scopeLabel: "Estate-wide",
    value: 0.9,
    threshold: 0.95,
    direction: "min",
    windowLabel: "7 days to 01 Jan 2026",
    pageId: "overview",
    ...overrides,
  };
}

describe("directionSymbolFor", () => {
  it("min -> >=, max -> <=, read from alert.direction (not re-derived)", () => {
    expect(directionSymbolFor(makeAlert({ direction: "min" }))).toBe("≥");
    expect(directionSymbolFor(makeAlert({ direction: "max" }))).toBe("≤");
  });
});

describe("headlineFor: exact phrasing per classify()'s real branches", () => {
  it("min direction, value < threshold -> breach -> 'below the X floor'", () => {
    const h = headlineFor(makeAlert({ direction: "min", value: 0.9, threshold: 0.95, metric: "completionPct", scope: "estate" }));
    expect(h).toContain("below the 95.0% floor");
    expect(h).not.toContain("warning");
  });

  it("min direction, value >= threshold (still in the warn band) -> 'only just above the X floor (warning...)'", () => {
    const h = headlineFor(makeAlert({ direction: "min", value: 0.96, threshold: 0.95, metric: "completionPct", scope: "estate" }));
    expect(h).toContain("only just above the 95.0% floor");
    expect(h).toContain("warning");
  });

  it("max direction, value > threshold -> breach -> 'above the X ceiling'", () => {
    const h = headlineFor(makeAlert({ direction: "max", value: 0.07, threshold: 0.05, metric: "systemRate", scope: "estate" }));
    expect(h).toContain("above the 5.0% ceiling");
    expect(h).not.toContain("warning");
  });

  it("max direction, value <= threshold (still in the warn band) -> 'approaching the X ceiling (warning...)'", () => {
    const h = headlineFor(makeAlert({ direction: "max", value: 0.048, threshold: 0.05, metric: "systemRate", scope: "estate" }));
    expect(h).toContain("approaching the 5.0% ceiling");
    expect(h).toContain("warning");
  });

  it("omitSpoke drops the leading 'SpokeName -- ' prefix for a scope:spoke alert only", () => {
    const spokeAlert = makeAlert({ scope: "spoke", scopeLabel: "Risk", direction: "max", value: 0.07, threshold: 0.05, metric: "systemRate" });
    expect(headlineFor(spokeAlert)).toMatch(/^Risk/);
    expect(headlineFor(spokeAlert, { omitSpoke: true })).not.toMatch(/^Risk/);
    expect(headlineFor(spokeAlert, { omitSpoke: true })).toContain("System exception rate");

    // estate-scope always keeps its "Estate --" prefix regardless of omitSpoke.
    const estateAlert = makeAlert({ scope: "estate", scopeLabel: "Estate-wide" });
    expect(headlineFor(estateAlert, { omitSpoke: true })).toMatch(/^Estate/);
  });

  it("staleVdi gets the fixed 'no cases for N days ... review for retirement' phrasing, not floor/ceiling wording", () => {
    const alert = makeAlert({
      metric: "staleVdi",
      scope: "vdi",
      scopeLabel: "VDI-RPA-COM-04",
      value: 21,
      threshold: 14,
      direction: "max",
      lastSeenISO: "2026-06-23",
    });
    const h = headlineFor(alert);
    expect(h).toContain("VDI-RPA-COM-04");
    expect(h).toContain("no cases for 21 days");
    expect(h).toContain("review for retirement");
    expect(h).not.toContain("ceiling");
    expect(h).not.toContain("floor");
  });
});

describe("scopeContextFor", () => {
  it("omitSpoke drops the trailing spoke fragment for a process-scope alert", () => {
    const reference = makeReference({
      spokes: [{ spokeId: 1, spokeName: "Risk", shortName: "RK", colorLight: "#111", colorDark: "#eee" }],
      propositions: [{ propositionId: 1, propositionName: "Prop1", spokeId: 1 }],
      processes: [{ processId: 101, processName: "P101", processAcronym: "P1", processDescription: "", propositionId: 1, smvMinutes: 10, grade: "G1", isActive: true, icon: "form", tags: [] }],
    });
    const alert = makeAlert({ scope: "process", scopeLabel: "P101", processFilter: "101", spokeFilter: "Risk" });
    expect(scopeContextFor(alert, reference)).toContain("Spoke: Risk");
    expect(scopeContextFor(alert, reference, { omitSpoke: true })).not.toContain("Spoke:");
  });

  it("returns null for estate scope", () => {
    expect(scopeContextFor(makeAlert({ scope: "estate" }), makeReference())).toBeNull();
  });
});
