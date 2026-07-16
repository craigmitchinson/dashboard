import type { AuthProvider } from "./provider";
import type { Role, Session, User } from "./types";

// ---------------------------------------------------------------------------
// Entra ID (Azure AD) provider — NON-FUNCTIONAL STUB.
//
// This file exists so the shape of "real" SSO is visible in the codebase
// today, and so swapping it in later (see auth-context.tsx) is a one-line
// change. Nothing here calls out to Microsoft — every method throws.
//
// ---- Background, for anyone reading this who isn't an engineer -----------
//
// "Entra ID" is Microsoft's current name for what used to be called
// "Azure Active Directory" (Azure AD) — it's Microsoft's cloud identity
// service. It's the thing that already knows every employee's corporate
// login, their manager, and — most usefully for us — which security groups
// they belong to.
//
// To let our dashboard use that login, Microsoft requires us to register
// the dashboard as an "app registration" in Entra ID: a one-time admin
// step in the Azure portal that gives the dashboard a client ID (an
// identifier for "this app") and a list of allowed redirect URLs (where
// Microsoft is allowed to send the user back to after they sign in).
//
// "MSAL" (Microsoft Authentication Library) is the official JavaScript
// library that does the actual sign-in handshake in the browser. We do NOT
// import it here — no new npm dependencies in this prototype — but this is
// the library a real integration would add (`@azure/msal-browser` /
// `@azure/msal-react`).
//
// The handshake MSAL performs is called "auth code + PKCE" (Proof Key for
// Code Exchange), and at a high level it goes:
//   1. Our app redirects the browser to a Microsoft login page.
//   2. The user signs in with their normal corporate credentials (and MFA,
//      if the organisation requires it) — WE NEVER SEE THEIR PASSWORD.
//   3. Microsoft redirects the browser back to our app with a short-lived
//      "authorization code" in the URL.
//   4. Our app (via MSAL) exchanges that code for tokens — an "ID token"
//      (who the user is) and an "access token" (what the user is allowed
//      to call, not needed here since we don't call Microsoft Graph).
//   5. The ID token is a signed JSON blob of "claims" — user's name,
//      email, unique object id (oid), and — if the app registration is
//      configured to include them — the security groups they belong to.
//
// ---- Mapping Entra groups to our Role / spokeIds --------------------------
//
// Rather than manage roles inside the dashboard, we'd reuse groups the IT
// team already maintains in Entra ID: one group per role, plus one group
// per spoke-lead. GROUP_ROLE_MAPPINGS below is the translation table a real
// integration would use to turn "this user's ID token lists these group
// names" into "this user gets this Role (and, for spoke leads, this
// spokeId)". mapClaimsToUser() below is a real, working function that does
// that translation — only the network/redirect plumbing around it is
// stubbed.
// ---------------------------------------------------------------------------

/**
 * Entra AD group name → the Role it grants. `spokeFromGroup: true` means the
 * spoke identifier is embedded in the group name itself (see
 * mapClaimsToUser), rather than the group being spoke-agnostic.
 *
 * Group names use the four real spoke short codes: IPI (Insurance, Pensions
 * & Investments), RSK (Risk), COM (Commercial), CLD (Consumer Lending).
 */
export const GROUP_ROLE_MAPPINGS: Record<string, { role: Role; spokeFromGroup?: boolean }> = {
  "SG-RPA-Admins": { role: "admin" },
  "SG-RPA-IPI-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-RSK-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-COM-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-CLD-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-HubMembers": { role: "hub_member" },
  "SG-RPA-BusinessUsers": { role: "business_user" },
};

// Short group-name code → the full spoke identifier used everywhere else in
// the app (SPOKE_INFO / filters.spoke keys — see types.ts's spokeIds comment).
const GROUP_SPOKE_CODE_TO_NAME: Record<string, string> = {
  IPI: "Insurance, Pensions & Investments",
  RSK: "Risk",
  COM: "Commercial",
  CLD: "Consumer Lending",
};

/**
 * Pure function: Entra ID token claims → our User shape. Real and testable
 * even though the surrounding provider is a stub — once someone wires up
 * MSAL, the redirect/token plumbing calls this with the decoded ID token
 * claims and gets a ready-to-use User back.
 *
 * Expected claims of interest (standard Entra ID token claims):
 *   - claims.oid: string — the user's unique, stable object id in the tenant.
 *   - claims.name: string — display name.
 *   - claims.preferred_username: string — usually the user's email/UPN.
 *   - claims.groups: string[] — group object-ids or names the token carries
 *     (requires the app registration to be configured to emit group claims,
 *     and typically groups-by-name rather than by GUID for this to be
 *     directly useful without a separate Graph lookup).
 */
export function mapClaimsToUser(claims: Record<string, unknown>): User {
  const groups = Array.isArray(claims.groups) ? (claims.groups as unknown[]).filter((g): g is string => typeof g === "string") : [];

  const roles = new Set<Role>();
  const spokeIds = new Set<string>();

  for (const group of groups) {
    const mapping = GROUP_ROLE_MAPPINGS[group];
    if (!mapping) continue;
    roles.add(mapping.role);
    if (mapping.spokeFromGroup) {
      // Pull the spoke code out of names like "SG-RPA-IPI-Lead" -> "IPI".
      const match = group.match(/^SG-RPA-([A-Z]+)-Lead$/);
      const code = match?.[1];
      const spokeName = code ? GROUP_SPOKE_CODE_TO_NAME[code] : undefined;
      if (spokeName) spokeIds.add(spokeName);
    }
  }

  return {
    id: typeof claims.oid === "string" ? claims.oid : "",
    name: typeof claims.name === "string" ? claims.name : "",
    email: typeof claims.preferred_username === "string" ? claims.preferred_username : "",
    roles: roles.size ? Array.from(roles) : ["business_user"],
    spokeIds: Array.from(spokeIds),
  };
}

const NOT_CONFIGURED = "Entra ID provider not configured — see PLAYBOOK for app registration + MSAL setup steps.";

export class EntraAuthProvider implements AuthProvider {
  async signIn(): Promise<Session> {
    throw new Error(NOT_CONFIGURED);
  }

  signOut(): void {
    throw new Error(NOT_CONFIGURED);
  }

  getSession(): Session | null {
    throw new Error(NOT_CONFIGURED);
  }
}
