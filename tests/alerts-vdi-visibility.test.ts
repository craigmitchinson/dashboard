// ---------------------------------------------------------------------------
// tests/alerts-vdi-visibility.test.ts
// ---------------------------------------------------------------------------
// src/alerts/alerts-context.tsx: buildVdiSpokeIndex + scopeAlertsForUser —
// the hub-owned-VDI visibility exception. A spoke-scoped user should see a
// hub-owned VDI's alert (spokeFilter undefined, scope "vdi") when that VDI
// ran at least one of their spoke's processes, per the resource fact rows.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { buildVdiSpokeIndex, scopeAlertsForUser } from "../src/alerts/alerts-context";
import type { Alert } from "../src/alerts/engine";

function vdiAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "staleVdi|vdi|VDI-HUB-01|2026-01-10",
    severity: "warn",
    metric: "staleVdi",
    scope: "vdi",
    scopeLabel: "VDI-HUB-01",
    value: 20,
    threshold: 14,
    direction: "max",
    windowLabel: "7 days to 10 Jan 2026",
    pageId: "capacity",
    spokeFilter: undefined,
    ...overrides,
  };
}

function estateAlert(): Alert {
  return {
    id: "completionPct|estate|estate|2026-01-10",
    severity: "breach",
    metric: "completionPct",
    scope: "estate",
    scopeLabel: "Estate-wide",
    value: 0.8,
    threshold: 0.95,
    direction: "min",
    windowLabel: "7 days to 10 Jan 2026",
    pageId: "overview",
  };
}

describe("buildVdiSpokeIndex", () => {
  it("maps a VDI id to the set of spokes whose processes ran on it", () => {
    const idx = buildVdiSpokeIndex(
      [
        { resource: "VDI-HUB-01", processId: "1" },
        { resource: "VDI-HUB-01", processId: "2" },
        { resource: "VDI-RSK-01", processId: "3" },
      ],
      (id) => ({ "1": "Risk", "2": "Commercial", "3": "Risk" })[id],
    );
    expect(idx.get("VDI-HUB-01")).toEqual(new Set(["Risk", "Commercial"]));
    expect(idx.get("VDI-RSK-01")).toEqual(new Set(["Risk"]));
  });

  it("skips rows whose process has no resolvable spoke", () => {
    const idx = buildVdiSpokeIndex([{ resource: "VDI-X", processId: "unknown" }], () => undefined);
    expect(idx.has("VDI-X")).toBe(false);
  });
});

describe("scopeAlertsForUser: hub-owned VDI visibility exception", () => {
  const vdiSpokesById = new Map([["VDI-HUB-01", new Set(["Risk"])]]);

  it("admin sees everything, including hub-VDI alerts, regardless of the index", () => {
    const out = scopeAlertsForUser([vdiAlert(), estateAlert()], { roles: ["admin"], spokeIds: [] }, new Map());
    expect(out).toHaveLength(2);
  });

  it("a CoE-wide user (spokeIds: []) sees everything unfiltered", () => {
    const out = scopeAlertsForUser([vdiAlert(), estateAlert()], { roles: ["hub_member"], spokeIds: [] }, new Map());
    expect(out).toHaveLength(2);
  });

  it("a spoke-scoped user sees a hub-owned VDI alert when that VDI ran one of their spoke's processes", () => {
    const out = scopeAlertsForUser([vdiAlert()], { roles: ["hub_lead"], spokeIds: ["Risk"] }, vdiSpokesById);
    expect(out).toHaveLength(1);
  });

  it("a spoke-scoped user does NOT see a hub-owned VDI alert for a VDI that never ran their spoke's work", () => {
    const out = scopeAlertsForUser([vdiAlert()], { roles: ["hub_lead"], spokeIds: ["Commercial"] }, vdiSpokesById);
    expect(out).toHaveLength(0);
  });

  it("a spoke-scoped user still always sees estate-scope alerts", () => {
    const out = scopeAlertsForUser([estateAlert()], { roles: ["hub_lead"], spokeIds: ["Commercial"] }, vdiSpokesById);
    expect(out).toHaveLength(1);
  });

  it("a spoke-scoped user still sees a spoke-owned (spokeFilter-set) alert for their own spoke", () => {
    const spokeOwnedVdi = vdiAlert({ spokeFilter: "Risk" });
    const out = scopeAlertsForUser([spokeOwnedVdi], { roles: ["hub_lead"], spokeIds: ["Risk"] }, new Map());
    expect(out).toHaveLength(1);
  });
});
