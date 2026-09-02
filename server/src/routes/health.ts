import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

/**
 * GET /api/health -> { ok, dataThrough, lastPullAt, dbOk, version }
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
 * No auth required — this is a liveness/monitoring endpoint.
 */
export function registerHealthRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/health", async (_req, reply) => {
    const cached = ctx.modelCache.get();
    const dataThrough = cached?.dateThrough ?? null;
    const [lastPullAt] = await Promise.allSettled([ctx.data.getLastPullAt()]).then((r) => [r[0].status === "fulfilled" ? r[0].value : null]);
    reply.send({
      ok: true,
      dataThrough,
      lastPullAt,
      dbOk: ctx.data.isDbOk(),
      version: ctx.appVersion,
    });
  });
}
