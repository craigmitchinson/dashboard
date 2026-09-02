// ---------------------------------------------------------------------------
// tests/mock-stale-vdi.test.ts
// ---------------------------------------------------------------------------
// tools/generate-mock-data.mjs deliberately idles ONE active, registered VDI
// (VDI-RPA-PROD-06) ~30 days before data-through so the D6 stale-VDI alert
// (src/alerts/engine.ts) and the Capacity page's idle-review queue have a
// real signal to fire on in the mock dataset. This test loads the ACTUAL
// built public/data/model.json (not a synthetic fixture) and asserts the
// real mock estate yields exactly one staleVdi alert, for that VDI, against
// the base reference's un-overridden targets.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initData, type ModelJson } from "../src/rpaData";
import { evaluateAlerts } from "../src/alerts/engine";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = join(root, "public", "data", "model.json");

describe("mock dataset: deterministic idle VDI (D6 stale-VDI demonstrability)", () => {
  it.skipIf(!existsSync(modelPath))("yields exactly one staleVdi alert, for VDI-RPA-PROD-06, against the base reference's default targets", () => {
    const model: ModelJson = JSON.parse(readFileSync(modelPath, "utf8"));
    initData(model);
    const alerts = evaluateAlerts(model.reference).filter((a) => a.metric === "staleVdi");

    expect(alerts).toHaveLength(1);
    expect(alerts[0].scopeLabel).toBe("VDI-RPA-PROD-06");
    expect(alerts[0].severity).toBe("warn");
    expect(alerts[0].value).toBeGreaterThan(model.reference.targets.vdiStaleDays);
  });
});
