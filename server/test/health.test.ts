// ---------------------------------------------------------------------------
// health.test.ts — GET /api/health response shape, fixture mode (no auth
// required, no database).
// ---------------------------------------------------------------------------
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../src/index.js";
import { computeStale } from "../src/routes/health.js";

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

  it("includes a synthetic healthy lastRun and a false stale flag in fixture mode", async () => {
    process.env.AUTH_MODE = "none";
    process.env.NODE_ENV = "test";
    process.env.DATA_SOURCE = "fixtures";
    process.env.FIXTURES_DIR = fixturesDir;

    const { app } = await buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = res.json();
    expect(body.lastRun).toMatchObject({ status: "success", error: null });
    expect(body.stale).toBe(false);
    await app.close();
  });

});

describe("computeStale", () => {
  it("is false when watermark age is unknown (null/undefined) — unmeasurable isn't stale", () => {
    expect(computeStale(null, 15)).toBe(false);
    expect(computeStale(undefined, 15)).toBe(false);
  });

  it("is false at or under 3x the pull cadence, true beyond it", () => {
    expect(computeStale(45, 15)).toBe(false); // exactly 3x
    expect(computeStale(46, 15)).toBe(true); // just over 3x
    expect(computeStale(0, 15)).toBe(false);
  });

  it("honours a custom PULL_CADENCE_MINUTES", () => {
    expect(computeStale(4, 1)).toBe(true); // 4 > 1*3
    expect(computeStale(3, 1)).toBe(false);
  });
});
