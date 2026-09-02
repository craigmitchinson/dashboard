// ---------------------------------------------------------------------------
// tests/alerts-engine.test.ts
// ---------------------------------------------------------------------------
// src/alerts/engine.ts's evaluateAlerts() reads its inputs off the rpaData
// module-level live bindings (ROWS, PROCESS_BY_ID, VDIS, ...), which are only
// populated by calling initData(). classify()/pushRateAlerts() are NOT
// exported, so its warn/breach/null branches are exercised indirectly through
// evaluateAlerts()'s estate-scope output -- the only exported entry point
// that surfaces classify()'s decision. (classify itself could not be unit
// tested directly without a src change, which is out of scope here.)
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { initData, type ModelJson, type DayRow as _DayRow } from "../src/rpaData";
import { evaluateAlerts, MIN_ALERT_VOLUME } from "../src/alerts/engine";
import { resolveThreshold } from "../src/reference/reference-store";
import { makeModel, makeReference } from "./fixtures";

type DayRowSrc = ModelJson["dayRows"][number];

const SPOKE1 = { id: 1, name: "Spoke1", short: "S1", colorLight: "#111", colorDark: "#eee" };
const PROP1 = { name: "Prop1", spoke: "Spoke1" };

function process(id: number, name: string, spoke = "Spoke1"): ModelJson["processes"][number] {
  return {
    id, name, acronym: name.slice(0, 3).toUpperCase(), description: "",
    proposition: "Prop1", spoke,
    queues: [], smvMinutes: 10, grade: "G1", gradeName: "Grade 1", currentHourly: 20,
    icon: "form", tags: [],
  };
}

function dayRow(d: string, p: number, c: number, b: number, s: number): DayRowSrc {
  return { d, p, c, b, s, n: 0, w: 0, cw: 0, gb: 0, ec: 0 };
}

// ===========================================================================
// classify() via evaluateAlerts's estate scope: breach / warn / the
// high-floor "headroom fix" that clears the warn band.
// ===========================================================================
describe("evaluateAlerts: completionPct classification at estate scope", () => {
  const referenceTargets = makeReference({ targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 } });

  function run(completed: number, business: number, system: number) {
    const model = makeModel({
      meta: { generatedAt: "2026-01-01T00:00:00.000Z", source: "test", sourceRows: 0, dateMin: "2026-01-01", dateMax: "2026-01-10", unmappedQueues: [] },
      spokes: [SPOKE1],
      propositions: [PROP1],
      processes: [process(1, "Proc1")],
      dayRows: [dayRow("2026-01-10", 1, completed, business, system)],
      reference: referenceTargets,
    });
    initData(model);
    return evaluateAlerts(referenceTargets).filter((a) => a.scope === "estate" && a.metric === "completionPct");
  }

  it("value below threshold -> breach", () => {
    const alerts = run(560, 70, 70); // completionPct = 560/700 = 0.8
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("breach");
    expect(alerts[0].value).toBeCloseTo(0.8, 6);
  });

  it("value inside the warn band (threshold <= value < threshold + (1-threshold)*WARN_MARGIN) -> warn", () => {
    // warnCeiling = 0.95 + 0.05*0.10 = 0.955; 0.951 sits inside [0.95, 0.955).
    const alerts = run(9510, 245, 245); // completionPct = 9510/10000 = 0.951
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warn");
  });

  it("high-floor headroom fix: 0.999 completion against a 0.95 floor clears the warn band entirely (null, no alert)", () => {
    const alerts = run(9990, 5, 5); // completionPct = 0.999
    expect(alerts).toHaveLength(0);
  });
});

// ===========================================================================
// MIN_ALERT_VOLUME guard
// ===========================================================================
describe("evaluateAlerts: MIN_ALERT_VOLUME guard on per-process alerts", () => {
  it("suppresses a process below MIN_ALERT_VOLUME even with a terrible completion rate, but still flags one above it", () => {
    const reference = makeReference({ targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 } });
    const lowVolTotal = 2;
    const highVolTotal = MIN_ALERT_VOLUME; // exactly at the guard boundary -> NOT suppressed (guard is "< MIN_ALERT_VOLUME")
    expect(lowVolTotal).toBeLessThan(MIN_ALERT_VOLUME);

    const model = makeModel({
      meta: { generatedAt: "2026-01-01T00:00:00.000Z", source: "test", sourceRows: 0, dateMin: "2026-01-01", dateMax: "2026-01-10", unmappedQueues: [] },
      spokes: [SPOKE1],
      propositions: [PROP1],
      processes: [process(1, "LowVol"), process(2, "HighVol")],
      dayRows: [
        dayRow("2026-01-10", 1, 0, 1, 1), // total volume 2 -- below MIN_ALERT_VOLUME
        dayRow("2026-01-10", 2, 0, highVolTotal / 2, highVolTotal / 2), // total volume === MIN_ALERT_VOLUME, all exceptions
      ],
      reference,
    });
    initData(model);
    const alerts = evaluateAlerts(reference);
    const processAlerts = alerts.filter((a) => a.scope === "process");

    expect(processAlerts.some((a) => a.scopeLabel === "LowVol")).toBe(false);
    expect(processAlerts.some((a) => a.scopeLabel === "HighVol")).toBe(true);
  });
});

// ===========================================================================
// staleVdi
// ===========================================================================
describe("evaluateAlerts: staleVdi", () => {
  function vdiResource(name: string, status: "active" | "retired"): ModelJson["resources"][number] {
    return {
      name, bot: `BOT-${name}`, acronym: name, vdi: name, class: "prod", spoke: "Spoke1", spokeId: 1,
      activeFrom: "2020-01-01", activeTo: null, notes: null,
      renewalDate: "2020-01-01", annualCostGBP: null, licenseExpiryDate: null, status,
    };
  }

  function buildModel(opts: { dateMax: string; lastSeenActive: string; lastSeenRetired: string; reference: ReturnType<typeof makeReference> }) {
    return makeModel({
      meta: { generatedAt: "2026-01-01T00:00:00.000Z", source: "test", sourceRows: 0, dateMin: "2025-01-01", dateMax: opts.dateMax, unmappedQueues: [] },
      spokes: [SPOKE1],
      propositions: [PROP1],
      processes: [process(1, "Proc1")],
      resources: [vdiResource("VDI-A", "active"), vdiResource("VDI-B", "retired"), vdiResource("VDI-C", "active")],
      dayRows: [],
      resourceActivity: {
        "VDI-A": { firstSeen: "2025-01-01", lastSeen: opts.lastSeenActive, items: 100, spokesServed: ["Spoke1"] },
        "VDI-B": { firstSeen: "2025-01-01", lastSeen: opts.lastSeenRetired, items: 100, spokesServed: ["Spoke1"] },
        // VDI-C deliberately has NO resourceActivity entry -> "never seen any activity", must not fire.
      },
      reference: opts.reference,
    });
  }

  it("fires for an active VDI idle beyond vdiStaleDays, not for a retired one, and not for one with no activity at all", () => {
    const reference = makeReference({ targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 } });
    // Dec 1 2025 -> Jan 10 2026 = 40 days idle, well past the default 14.
    const model = buildModel({ dateMax: "2026-01-10", lastSeenActive: "2025-12-01", lastSeenRetired: "2025-12-01", reference });
    initData(model);
    const alerts = evaluateAlerts(reference).filter((a) => a.metric === "staleVdi");

    const vdiA = alerts.find((a) => a.scopeLabel === "VDI-A");
    expect(vdiA).toBeDefined();
    expect(vdiA?.value).toBe(40);
    expect(vdiA?.threshold).toBe(14);
    expect(vdiA?.severity).toBe("warn");

    expect(alerts.some((a) => a.scopeLabel === "VDI-B")).toBe(false); // retired
    expect(alerts.some((a) => a.scopeLabel === "VDI-C")).toBe(false); // never seen
  });

  it("respects a spoke-scoped vdiStaleDays override", () => {
    const reference = makeReference({
      targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 },
      thresholdOverrides: [{ scope: "spoke", scopeId: "Spoke1", metric: "vdiStaleDays", value: 50 }],
    });
    expect(resolveThreshold(reference, "vdiStaleDays", "spoke", "Spoke1")).toBe(50);

    const model = buildModel({ dateMax: "2026-01-10", lastSeenActive: "2025-12-01", lastSeenRetired: "2025-12-01", reference });
    initData(model);
    const alerts = evaluateAlerts(reference).filter((a) => a.metric === "staleVdi" && a.scopeLabel === "VDI-A");
    // 40 days idle <= the overridden 50-day threshold for Spoke1 -> cleared.
    expect(alerts).toHaveLength(0);
  });

  it("fingerprint (alert.id) is stable for the same data-through date and changes when data-through changes", () => {
    const reference = makeReference({ targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 } });

    const modelA = buildModel({ dateMax: "2026-01-10", lastSeenActive: "2025-12-01", lastSeenRetired: "2025-12-01", reference });
    initData(modelA);
    const idA1 = evaluateAlerts(reference).find((a) => a.metric === "staleVdi" && a.scopeLabel === "VDI-A")?.id;
    initData(modelA); // re-run against the SAME data-through
    const idA2 = evaluateAlerts(reference).find((a) => a.metric === "staleVdi" && a.scopeLabel === "VDI-A")?.id;
    expect(idA1).toBeDefined();
    expect(idA1).toBe(idA2);

    const modelB = buildModel({ dateMax: "2026-01-11", lastSeenActive: "2025-12-01", lastSeenRetired: "2025-12-01", reference });
    initData(modelB); // one day further data-through -> 41 days idle, still stale
    const idB = evaluateAlerts(reference).find((a) => a.metric === "staleVdi" && a.scopeLabel === "VDI-A")?.id;
    expect(idB).toBeDefined();
    expect(idB).not.toBe(idA1);
  });
});
