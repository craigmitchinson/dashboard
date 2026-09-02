// ---------------------------------------------------------------------------
// dev.ts — AUTH_MODE=dev: trust an X-Dev-User header verbatim. Local dev /
// fixture-mode CI only — config.ts refuses to even start with AUTH_MODE=dev
// when NODE_ENV=production, so this file's trust decision can never reach a
// real deployment.
// ---------------------------------------------------------------------------
import type { AuthUser, Role } from "./types.js";

const VALID_ROLES: Role[] = ["admin", "hub_lead", "hub_member", "business_user"];

export function parseDevUserHeader(headerValue: string | undefined): AuthUser | null {
  if (!headerValue) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(headerValue);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const roles = Array.isArray(p.roles) ? p.roles.filter((r): r is Role => VALID_ROLES.includes(r as Role)) : [];
  return {
    id: typeof p.id === "string" ? p.id : "dev-user",
    name: typeof p.name === "string" ? p.name : "Dev User",
    email: typeof p.email === "string" ? p.email : "dev@example.com",
    roles: roles.length ? roles : ["business_user"],
    spokeIds: Array.isArray(p.spokeIds) ? p.spokeIds.filter((s): s is string => typeof s === "string") : [],
  };
}
