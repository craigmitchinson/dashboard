import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { assembleModel } from "../assembler.js";
import { makeAuthenticate } from "../auth/middleware.js";

/**
 * GET /api/model -> ModelJson (src/rpaData.ts), gzip'd (via @fastify/compress,
 * registered globally in index.ts), ETag/If-None-Match aware.
 *
 * Caching: an in-memory cache keyed on a cheap "cache key" (SQL mode: latest
 * successful core.PipelineRun id, or MAX(core.FactWorkItem.LastUpdatedDate)
 * if that table doesn't exist yet, PLUS core.RefVersion — so either a new
 * data pull or a reference-data edit invalidates it; fixture mode: the
 * in-memory ReferenceStore's version alone, since the fact fixtures are
 * static for the process's lifetime). A matching If-None-Match short-
 * circuits to 304 with no body BEFORE the (possibly expensive) rowset
 * rebuild is even attempted.
 *
 * Resilience: if computing the cache key or rebuilding fails (DB down) but a
 * PREVIOUS successful build is still cached, that stale model is served with
 * `X-Data-Stale: true` and a 200 (better a slightly-old dashboard than a
 * blank one). With nothing cached yet, responds 503 with a JSON error body.
 */
export function registerModelRoute(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = makeAuthenticate(ctx.config);

  app.get("/api/model", { preHandler: authenticate }, async (req, reply) => {
    let key: string;
    try {
      key = await ctx.data.modelSource.computeCacheKey();
    } catch (err) {
      const cached = ctx.modelCache.get();
      if (cached) {
        ctx.log.warn({ err }, "computeCacheKey failed; serving last cached model");
        return sendCached(reply, cached, req.headers["if-none-match"], true);
      }
      ctx.log.error({ err }, "computeCacheKey failed and no cached model available");
      reply.code(503).send({ error: "Data source unavailable and no cached model to fall back to. See /api/health." });
      return;
    }

    let cached;
    try {
      cached = await ctx.modelCache.getOrBuild(key, async () => {
        const rowsets = await ctx.data.modelSource.buildRowsets();
        const model = assembleModel(rowsets, { generatedAt: new Date().toISOString(), source: ctx.data.sourceLabel });
        return { json: JSON.stringify(model), dateThrough: (model.meta?.dateMax as string) ?? null };
      });
    } catch (err) {
      const stale = ctx.modelCache.get();
      if (stale) {
        ctx.log.warn({ err }, "model rebuild failed; serving last cached model");
        return sendCached(reply, stale, req.headers["if-none-match"], true);
      }
      ctx.log.error({ err }, "model rebuild failed and no cached model available");
      reply.code(503).send({ error: "Failed to build model and no cached model to fall back to. See /api/health." });
      return;
    }
    return sendCached(reply, cached, req.headers["if-none-match"], false);
  });
}

function sendCached(reply: import("fastify").FastifyReply, cached: import("../cache.js").CachedModel, ifNoneMatch: string | string[] | undefined, stale: boolean) {
  reply.header("ETag", cached.etag);
  reply.header("Cache-Control", "no-cache");
  if (stale) reply.header("X-Data-Stale", "true");
  if (ifNoneMatch && ifNoneMatch === cached.etag) {
    reply.code(304).send();
    return;
  }
  reply.header("Content-Type", "application/json; charset=utf-8").send(cached.json);
}
