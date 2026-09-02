// ---------------------------------------------------------------------------
// assembler.test.ts — the parity guarantee between the static build
// (tools/build-dashboard-data.mjs -> public/data/model.json) and this API:
// assembleModel() fed the JSON view-port fixtures under
// public/data/views/vw_Model*.json (+ vw_EstateRateByDate.json) and the base
// data/reference/reference.json — via the SAME FixtureModelSource the
// server uses in DATA_SOURCE=fixtures mode — must deep-equal
// public/data/model.json, module the two fields that are legitimately
// caller-supplied rather than derived (meta.generatedAt, meta.source).
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FixtureModelSource, InMemoryReferenceStore, loadFixtureReference } from "../src/data/fixtures.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { assembleModel } from "../../shared/model-assembler.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..");
const fixturesDir = join(repoRoot, "public", "data", "views");
const referencePath = join(repoRoot, "data", "reference", "reference.json");
const modelJsonPath = join(repoRoot, "public", "data", "model.json");

describe("assembleModel <-> public/data/model.json parity", () => {
  it("reproduces the static build's ModelJson exactly (module generatedAt/source)", async () => {
    const initialReference = await loadFixtureReference(referencePath);
    const store = new InMemoryReferenceStore(initialReference);
    const source = new FixtureModelSource(fixturesDir, store);
    const rowsets = await source.buildRowsets();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built: any = assembleModel(rowsets, { generatedAt: "X", source: "X" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected: any = JSON.parse(readFileSync(modelJsonPath, "utf8"));
    expected.meta.generatedAt = "X";
    expected.meta.source = "X";

    expect(built).toEqual(expected);
  });
});
