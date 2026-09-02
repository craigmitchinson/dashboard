// Server-local copy of the SPA's Role/User shape (src/auth/types.ts under
// src/**, which this task does not own/modify). Kept in step by hand — see
// this task's final report re: shared/auth-mappings.mjs.
export type Role = "admin" | "hub_lead" | "hub_member" | "business_user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  spokeIds: string[]; // spoke NAMEs (see shared/auth-mappings.mjs) for a hub_lead
}

// Attached to the Fastify request once authenticated.
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
