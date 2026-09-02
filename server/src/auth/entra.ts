// ---------------------------------------------------------------------------
// entra.ts — AUTH_MODE=entra: validate a Bearer JWT issued by Entra ID
// (Azure AD) against the tenant's JWKS, then map its claims to an AuthUser
// via shared/auth-mappings.mjs (the server's copy of
// src/auth/entra-provider.ts's GROUP_ROLE_MAPPINGS — see this task's final
// report for why it's duplicated rather than imported).
// ---------------------------------------------------------------------------
import { createRemoteJWKSet, jwtVerify } from "jose";
import { mapClaimsToUser } from "../../../shared/auth-mappings.mjs";
import type { AuthUser } from "./types.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTenant: string | null = null;

function getJwks(tenantId: string) {
  if (!jwks || jwksTenant !== tenantId) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
    jwksTenant = tenantId;
  }
  return jwks;
}

export class EntraAuthError extends Error {}

export async function verifyEntraBearer(authorizationHeader: string | undefined, tenantId: string, audience: string): Promise<AuthUser> {
  if (!authorizationHeader?.startsWith("Bearer ")) throw new EntraAuthError("Missing Bearer token");
  const token = authorizationHeader.slice("Bearer ".length);
  const { payload } = await jwtVerify(token, getJwks(tenantId), {
    issuer: [`https://login.microsoftonline.com/${tenantId}/v2.0`, `https://sts.windows.net/${tenantId}/`],
    audience,
  });
  return mapClaimsToUser(payload as Record<string, unknown>);
}
