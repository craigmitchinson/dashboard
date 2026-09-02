// ---------------------------------------------------------------------------
// middleware.ts — authenticates every request per config.authMode, attaches
// req.user, and exposes enforceReferenceWrite() for the PUT /api/reference
// route's spoke-scoping rule.
// ---------------------------------------------------------------------------
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { parseDevUserHeader } from "./dev.js";
import { EntraAuthError, verifyEntraBearer } from "./entra.js";
import { diffReference } from "../data/reference-diff.js";
import type { AuthUser } from "./types.js";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Fastify preHandler: populates request.user, or throws AuthError. GET
 *  model/reference just need ANY authenticated user; AUTH_MODE=none permits
 *  every request through as an anonymous "business_user" (local dev only —
 *  config.ts's production guard already rules this out in prod). */
export function makeAuthenticate(config: Config) {
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (config.authMode === "none") {
      req.user = { id: "anonymous", name: "Anonymous", email: "", roles: ["business_user"], spokeIds: [] };
      return;
    }
    if (config.authMode === "dev") {
      const user = parseDevUserHeader(req.headers["x-dev-user"] as string | undefined);
      if (!user) throw new AuthError("AUTH_MODE=dev requires a valid X-Dev-User header (JSON: {id,name,email,roles,spokeIds})", 401);
      req.user = user;
      return;
    }
    // entra
    if (!config.entraTenantId || !config.entraAudience) {
      throw new AuthError("Server misconfigured: ENTRA_TENANT_ID/ENTRA_AUDIENCE not set", 500);
    }
    try {
      req.user = await verifyEntraBearer(req.headers.authorization, config.entraTenantId, config.entraAudience);
    } catch (err) {
      if (err instanceof EntraAuthError) throw new AuthError(err.message, 401);
      throw new AuthError("Invalid or expired token", 401);
    }
  };
}

/**
 * Enforces the PUT /api/reference role rule:
 *   admin       -> any change permitted
 *   hub_lead    -> permitted ONLY if every touched row's spoke is in their
 *                  own spokeIds, AND no GLOBAL section/row changed
 *   other roles -> 403, no write permitted at all
 * Throws AuthError(403) on violation; returns silently when the write is
 * permitted (including a no-op diff).
 */
export function enforceReferenceWrite(user: AuthUser, oldRef: unknown, newRef: unknown): void {
  if (user.roles.includes("admin")) return;
  if (!user.roles.includes("hub_lead")) {
    throw new AuthError("Only admin or hub_lead may write reference data", 403);
  }
  const { touchedSpokes, touchesGlobal } = diffReference(oldRef as Record<string, unknown>, newRef as Record<string, unknown>);
  if (touchesGlobal) {
    throw new AuthError("hub_lead may not change global reference sections (spokes, grades, targets, rate-card defaults, etc.)", 403);
  }
  const ownSpokes = new Set(user.spokeIds);
  for (const spoke of touchedSpokes) {
    if (!ownSpokes.has(spoke)) {
      throw new AuthError(`hub_lead may only change their own spoke(s) — this write touches "${spoke}"`, 403);
    }
  }
}
