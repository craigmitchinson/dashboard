import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

/** Pure so it's unit-testable without a database — see test/health.test.ts.
 *  "unknown" (null watermarkAgeMinutes) is never stale: staleness is a
 *  claim about the data's age, and an unmeasurable age isn't evidence of
 *  either freshness or staleness. */
export function computeStale(watermarkAgeMinutes: number | null | undefined, pullCadenceMinutes: number): boolean {
  if (watermarkAgeMinutes == null) return false;
  return watermarkAgeMinutes > pullCadenceMinutes * 3;
}

/**
 * GET /api/health -> { ok, dataThrough, lastPullAt, dbOk, version, lastRun, stale }
 *   ok          the API process itself is up and able to answer (always
 *               true here — dbOk carries the DB-specific signal so a
 *               monitor can distinguish "service down" from "DB down,
 *               serving stale/cached data").
 *   dataThrough the latest outcome date the currently cached model covers
 *               (meta.dateMax), or null if no model has been built yet.
 *   lastPullAt  latest successful core.PipelineRun.FinishedAt (sql mode),
 *               or null in fixture mode / if that table doesn't exist yet.
 *   dbOk        false if DATA_SOURCE=sql and the pool isn't connected;
 *               always true in fixture mode (no DB to be down).
 *   version     this server's package.json version.
 *   lastRun     the latest core.PipelineRun row (report.vw_PipelineHealth),
 *               WHATEVER its status — 'running'/'success'/'failed' — so a
 *               failed or stuck run is visible here even while lastPullAt
 *               above still reports the last time a pull actually
 *               succeeded. null only if that view doesn't exist yet (a
 *               database not migrated with 13_api_model_views.sql's latest
 *               addition). Fixture mode returns a synthetic healthy object
 *               (see data/fixtures.ts's fixtureLastRun()) — there is no
 *               live pipeline to report on.
 *   stale       true when lastRun.watermarkAgeMinutes exceeds 3x
 *               PULL_CADENCE_MINUTES (env, default 15) — the underlying BP
 *               data hasn't moved in far longer than a normal gap between
 *               pulls would explain, independent of whether the pipeline
 *               process itself is reporting success. false if
 *               watermarkAgeMinutes is unknown (null) — "unknown" isn't
 *               "stale".
 * No auth required — this is a liveness/monitoring endpoint.
 */
export function registerHealthRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/health", async (_req, reply) => {
    const cached = ctx.modelCache.get();
    const dataThrough = cached?.dateThrough ?? null;
    const [lastPullAtResult, lastRunResult] = await Promise.allSettled([
      ctx.data.getLastPullAt(),
      ctx.data.getLastRun(),
    ]);
    const lastPullAt = lastPullAtResult.status === "fulfilled" ? lastPullAtResult.value : null;
    const lastRun = lastRunResult.status === "fulfilled" ? lastRunResult.value : null;
    const stale = computeStale(lastRun?.watermarkAgeMinutes, ctx.config.pullCadenceMinutes);
    reply.send({
      ok: true,
      dataThrough,
      lastPullAt,
      dbOk: ctx.data.isDbOk(),
      version: ctx.appVersion,
      lastRun,
      stale,
    });
  });
}
