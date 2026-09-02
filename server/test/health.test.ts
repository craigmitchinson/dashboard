// ---------------------------------------------------------------------------
// health.test.ts — GET /api/health response shape, fixture mode (no auth
// required, no database).
// ---------------------------------------------------------------------------
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../src/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..");
const fixturesDir = join(repoRoot, "public", "data", "views");

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/health", () => {
  it("responds with the documented shape, no auth required", async () => {
    process.env.AUTH_MODE = "none";
    process.env.NODE_ENV = "test";
    process.env.DATA_SOURCE = "fixtures";
    process.env.FIXTURES_DIR = fixturesDir;

    const { app } = await buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, dbOk: true });
    expect(body).toHaveProperty("dataThrough");
    expect(body).toHaveProperty("lastPullAt");
    expect(body).toHaveProperty("version");
    expect(typeof body.version).toBe("string");
    await app.close();
  });
});
