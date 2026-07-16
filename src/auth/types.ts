// ---------------------------------------------------------------------------
// Auth domain types — shared by every provider (dev, entra) and by the
// React context that wraps whichever provider is active.
// ---------------------------------------------------------------------------

// Role hierarchy (highest → lowest privilege) used across the permission
// matrix in auth-context.tsx: admin > hub_lead > hub_member > business_user.
export type Role = "admin" | "hub_lead" | "hub_member" | "business_user";

export interface User {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  /**
   * Spokes this user leads or belongs to. Values are the same string
   * identifier the rest of the app already uses to key a spoke — i.e. the
   * full spoke name as it appears in `SPOKES` / `SPOKE_INFO` (rpaData.ts)
   * and in `filters.spoke` (filters-context.tsx), e.g.
   * "Insurance, Pensions & Investments", "Risk", "Commercial",
   * "Consumer Lending" — NOT the short code ("IP&I"/"RSK"/"COM"/"CLD"),
   * so a user's spokeIds line up directly with filters.spoke without any
   * translation layer. [] = no spoke affiliation (e.g. admin, or a
   * business_user/hub_member with CoE-wide rather than spoke-scoped access).
   */
  spokeIds: string[];
}

export interface Session {
  user: User;
  issuedAt: string;
  provider: "dev" | "entra";
}

// Shared display helpers — used by both the Login user picker and the
// header user chip, so the two stay in step.
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  hub_lead: "Hub lead",
  hub_member: "Hub member",
  business_user: "Business user",
};

// Priority order (highest privilege first) for picking a single "headline"
// role to display when a user has more than one.
export const ROLE_PRIORITY: Role[] = ["admin", "hub_lead", "hub_member", "business_user"];

export function highestRoleLabel(roles: Role[]): string {
  const top = ROLE_PRIORITY.find((r) => roles.includes(r));
  return top ? ROLE_LABEL[top] : "";
}
