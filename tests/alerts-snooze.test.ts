// ---------------------------------------------------------------------------
// tests/alerts-snooze.test.ts
// ---------------------------------------------------------------------------
// src/alerts/acks.ts: alertSnoozeKey (drops the trailing dataThroughISO
// segment of an Alert.id) and pruneSnoozes (the snooze survival rule — a
// snoozed key survives a data build only as long as some current alert still
// maps to it).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { alertSnoozeKey, pruneSnoozes } from "../src/alerts/acks";

describe("alertSnoozeKey", () => {
  it("drops the trailing dataThroughISO segment of an Alert.id", () => {
    expect(alertSnoozeKey("completionPct|estate|estate|2026-01-10")).toBe("completionPct|estate|estate");
  });

  it("is robust to a scopeId that itself contains '|' — only the LAST segment is dropped", () => {
    expect(alertSnoozeKey("costPerCase|process|12|3|2026-01-10")).toBe("costPerCase|process|12|3");
  });

  it("two alert ids differing only by dataThroughISO produce the same key", () => {
    const a = alertSnoozeKey("systemRate|spoke|Risk|2026-01-10");
    const b = alertSnoozeKey("systemRate|spoke|Risk|2026-01-17");
    expect(a).toBe(b);
  });
});

describe("pruneSnoozes: the snooze survival rule", () => {
  it("keeps a snoozed key when some current alert still maps to it (even with a NEW dataThroughISO)", () => {
    const snoozed = ["completionPct|estate|estate"];
    const currentAlertIds = ["completionPct|estate|estate|2026-02-01"];
    expect(pruneSnoozes(snoozed, currentAlertIds)).toEqual(["completionPct|estate|estate"]);
  });

  it("drops a snoozed key once no current alert maps to it any more (the condition resolved)", () => {
    const snoozed = ["completionPct|estate|estate"];
    const currentAlertIds: string[] = []; // this build has no completionPct/estate alert at all
    expect(pruneSnoozes(snoozed, currentAlertIds)).toEqual([]);
  });

  it("prunes only the keys that no longer recur, keeping others untouched", () => {
    const snoozed = ["completionPct|estate|estate", "systemRate|spoke|Risk", "costPerCase|process|12"];
    const currentAlertIds = [
      "completionPct|estate|estate|2026-02-01", // still recurring
      "utilisation|vdi|VDI-01|2026-02-01", // unrelated new alert
    ];
    expect(pruneSnoozes(snoozed, currentAlertIds)).toEqual(["completionPct|estate|estate"]);
  });

  it("is a no-op on an empty snoozed list", () => {
    expect(pruneSnoozes([], ["completionPct|estate|estate|2026-02-01"])).toEqual([]);
  });
});
