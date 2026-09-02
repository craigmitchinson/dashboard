import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { makeAuthenticate, enforceReferenceWrite, AuthError } from "../auth/middleware.js";
import { validateReference } from "../validate/reference-schema.js";
import { VersionConflictError } from "../data/reference-store.js";

interface PutBody {
  reference?: unknown;
  actor?: string;
  section?: string;
}

/**
 * GET /api/reference  -> { reference, version, updatedAt, updatedBy }
 *   Any authenticated user (same as GET /api/model).
 *
 * PUT /api/reference  (header: If-Match: "<version>"; body: { reference,
 *                      actor, section })
 *   -> 200 { reference, version, updatedAt, updatedBy } on success
 *   -> 400 { error } on a schema validation failure (validate/reference-
 *      schema.ts) — checked BEFORE the version/role checks so a malformed
 *      body never masquerades as a conflict or a permissions issue.
 *   -> 409 { error, current: {reference,version,updatedAt,updatedBy} } if
 *      If-Match doesn't match the current version (client should refetch
 *      GET /api/reference and retry against `current`).
 *   -> 403 { error } if the authenticated user isn't admin/hub_lead, or is
 *      hub_lead but the diff touches a spoke outside user.spokeIds or
 *      anything GLOBAL (auth/middleware.ts's enforceReferenceWrite, backed
 *      by data/reference-diff.ts).
 *   Writes ALL reference tables transactionally in FK-safe order (SQL mode:
 *   data/sql-reference.ts's DELETE_ORDER/INSERT_ORDER, mirroring
 *   src/reference/reference-store.ts's exportReferenceSql — see
 *   server/test/reference-order.test.ts) or replaces the in-memory snapshot
 *   whole (fixture mode).
 */
export function registerReferenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = makeAuthenticate(ctx.config);

  app.get("/api/reference", { preHandler: authenticate }, async (_req, reply) => {
    const snapshot = await ctx.data.referenceStore.get();
    reply.send(snapshot);
  });

  app.put<{ Body: PutBody }>("/api/reference", { preHandler: authenticate }, async (req, reply) => {
    const body = req.body ?? {};
    if (!body.reference || typeof body.actor !== "string" || typeof body.section !== "string") {
      reply.code(400).send({ error: "Body must be { reference: object, actor: string, section: string }" });
      return;
    }

    const check = validateReference(body.reference);
    if (!check.ok) {
      reply.code(400).send({ error: "Invalid reference payload", details: check.errors });
      return;
    }

    const ifMatch = req.headers["if-match"];
    const expectedVersion = Number(Array.isArray(ifMatch) ? ifMatch[0] : ifMatch);
    if (!ifMatch || Number.isNaN(expectedVersion)) {
      reply.code(400).send({ error: "If-Match header with the current numeric version is required" });
      return;
    }

    try {
      const current = await ctx.data.referenceStore.get();
      enforceReferenceWrite(req.user!, current.reference, body.reference);

      const updated = await ctx.data.referenceStore.put({
        reference: body.reference as Record<string, unknown>,
        actor: body.actor,
        section: body.section,
        expectedVersion,
      });
      reply.send(updated);
    } catch (err) {
      if (err instanceof VersionConflictError) {
        reply.code(409).send({ error: err.message, current: err.current });
        return;
      }
      if (err instanceof AuthError) {
        reply.code(err.status).send({ error: err.message });
        return;
      }
      const status = (err as { status?: number }).status;
      if (status) {
        reply.code(status).send({ error: (err as Error).message });
        return;
      }
      throw err;
    }
  });
}
