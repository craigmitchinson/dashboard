// ---------------------------------------------------------------------------
// tests/parity.test.ts
// ---------------------------------------------------------------------------
// Shells out to tools/verify-economics.mjs against the CURRENTLY BUILT
// public/data/model.json and asserts it reports PARITY OK — i.e. the client
// economics engine (src/reference/economics.ts) reproduces the pipeline's
// baked benefit/cost/exception-cost totals within tolerance. This is a
// regression trip-wire on the whole data pipeline, not just the pure
// functions exercised elsewhere in this suite.
//
// Fast in practice (well under a second against the mock dataset), so it
// runs as part of the default `npm test` run; `npm run test:parity` remains
// available to run just this check on its own (e.g. right after
// `npm run data:all`, before a full test pass).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = join(root, "public", "data", "model.json");

describe("data pipeline parity (tools/verify-economics.mjs)", () => {
  it.skipIf(!existsSync(modelPath))("reports PARITY OK against public/data/model.json", () => {
    const output = execFileSync(process.execPath, [join(root, "tools", "verify-economics.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("PARITY OK");
  });
});
