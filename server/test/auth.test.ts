// ---------------------------------------------------------------------------
// auth.test.ts
//   1. AUTH_MODE=dev refused when NODE_ENV=production (config.ts's guard).
//   2. A hub_lead's PUT /api/reference touching a spoke outside their own
//      spokeIds -> 403; the same hub_lead editing their OWN spoke -> 200.
//   3. A stale If-Match version -> 409 with the documented { error, current }
//      shape.
// Runs the real Fastify app (DATA_SOURCE=fixtures, AUTH_MODE=dev) via
// app.inject() — no network listener, no real database.
// ---------------------------------------------------------------------------
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..");
const fixturesDir = join(repoRoot, "public", "data", "views");

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("config.ts production guard", () => {
  it("refuses AUTH_MODE=dev when NODE_ENV=production", () => {
    expect(() => loadConfig({ ...process.env, AUTH_MODE: "dev", NODE_ENV: "production", DATA_SOURCE: "fixtures", FIXTURES_DIR: fixturesDir })).toThrow(
      /AUTH_MODE=dev is not permitted when NODE_ENV=production/,
    );
  });

  it("refuses AUTH_MODE=none when NODE_ENV=production", () => {
    expect(() => loadConfig({ ...process.env, AUTH_MODE: "none", NODE_ENV: "production", DATA_SOURCE: "fixtures", FIXTURES_DIR: fixturesDir })).toThrow(
      /AUTH_MODE=none is not permitted when NODE_ENV=production/,
    );
  });

  it("allows AUTH_MODE=dev outside production", () => {
    expect(() => loadConfig({ ...process.env, AUTH_MODE: "dev", NODE_ENV: "development", DATA_SOURCE: "fixtures", FIXTURES_DIR: fixturesDir })).not.toThrow();
  });
});

describe("PUT /api/reference role + spoke enforcement (fixture mode, AUTH_MODE=dev)", () => {
  async function makeApp() {
    process.env.AUTH_MODE = "dev";
    process.env.NODE_ENV = "test";
    process.env.DATA_SOURCE = "fixtures";
    process.env.FIXTURES_DIR = fixturesDir;
    const { app } = await buildServer();
    await app.ready();
    return app;
  }

  const hubLeadRisk = { id: "u1", name: "Risk Lead", email: "risk@example.com", roles: ["hub_lead"], spokeIds: ["Risk"] };

  it("rejects a hub_lead editing a process outside their own spoke (403)", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    expect(getRes.statusCode).toBe(200);
    const snapshot = getRes.json();

    const modified = structuredClone(snapshot.reference);
    // process 101 ("Insurance New Business") belongs to the IP&I spoke, NOT Risk.
    const proc = modified.processes.find((p: { processId: number }) => p.processId === 101);
    proc.smvMinutes = proc.smvMinutes + 1;

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "processes" },
    });
    expect(putRes.statusCode).toBe(403);
    await app.close();
  });

  it("permits a hub_lead editing a process WITHIN their own spoke (200)", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    const snapshot = getRes.json();

    const modified = structuredClone(snapshot.reference);
    // process 201 ("Sanctions Screening Referrals") belongs to the Risk spoke.
    const proc = modified.processes.find((p: { processId: number }) => p.processId === 201);
    proc.smvMinutes = proc.smvMinutes + 1;

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "processes" },
    });
    expect(putRes.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a stale If-Match version with 409 and a `current` snapshot", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    const snapshot = getRes.json();
    const modified = structuredClone(snapshot.reference);
    modified.processes.find((p: { processId: number }) => p.processId === 201).smvMinutes += 1;

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version + 999), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "processes" },
    });
    expect(putRes.statusCode).toBe(409);
    const body = putRes.json();
    expect(body.current).toBeDefined();
    expect(body.current.version).toBe(snapshot.version);
    await app.close();
  });

  it("permits a hub_lead changing a financeTargets row for their OWN spoke (200)", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    const snapshot = getRes.json();

    const modified = structuredClone(snapshot.reference);
    modified.financeTargets = [{ spokeId: "Risk", annualNetBenefitTargetGBP: 50000 }];

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "financeTargets" },
    });
    expect(putRes.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a hub_lead changing a financeTargets row for ANOTHER spoke (403)", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    const snapshot = getRes.json();

    const modified = structuredClone(snapshot.reference);
    // "Insurance, Pensions & Investments" is the IP&I spoke, NOT Risk.
    modified.financeTargets = [{ spokeId: "Insurance, Pensions & Investments", annualNetBenefitTargetGBP: 50000 }];

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "financeTargets" },
    });
    expect(putRes.statusCode).toBe(403);
    await app.close();
  });

  it("rejects a hub_lead changing the ESTATE (global) financeTargets row (403)", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    const snapshot = getRes.json();

    const modified = structuredClone(snapshot.reference);
    modified.financeTargets = [{ spokeId: "ESTATE", annualNetBenefitTargetGBP: 250000 }];

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "financeTargets" },
    });
    expect(putRes.statusCode).toBe(403);
    await app.close();
  });

  it("rejects a hub_lead changing targets.fiscalYearStartMonth (global-only) (403)", async () => {
    const app = await makeApp();
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(hubLeadRisk) } });
    const snapshot = getRes.json();

    const modified = structuredClone(snapshot.reference);
    modified.targets.fiscalYearStartMonth = (modified.targets.fiscalYearStartMonth ?? 4) === 4 ? 5 : 4;

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(hubLeadRisk), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: modified, actor: "risk-lead@example.com", section: "targets" },
    });
    expect(putRes.statusCode).toBe(403);
    await app.close();
  });

  it("rejects a business_user's PUT outright (403), even for their own data", async () => {
    const app = await makeApp();
    const businessUser = { id: "u2", name: "Biz User", email: "biz@example.com", roles: ["business_user"], spokeIds: [] };
    const getRes = await app.inject({ method: "GET", url: "/api/reference", headers: { "x-dev-user": JSON.stringify(businessUser) } });
    const snapshot = getRes.json();

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/reference",
      headers: { "x-dev-user": JSON.stringify(businessUser), "if-match": String(snapshot.version), "content-type": "application/json" },
      payload: { reference: snapshot.reference, actor: "biz@example.com", section: "processes" },
    });
    expect(putRes.statusCode).toBe(403);
    await app.close();
  });
});
