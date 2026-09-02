// ---------------------------------------------------------------------------
// shared/auth-mappings.mjs
// ---------------------------------------------------------------------------
// Entra ID group -> Role/spoke mapping, copied verbatim (logic and data) from
// src/auth/entra-provider.ts's GROUP_ROLE_MAPPINGS + mapClaimsToUser(). That
// file lives under src/**, which this task does not own/modify, so the
// mapping is duplicated here as the server's copy — see this task's final
// report: the SPA should be updated to IMPORT this file instead of keeping
// its own copy, so the two can never drift apart again. Until that happens,
// a change to one MUST be mirrored in the other by hand.
// ---------------------------------------------------------------------------

/**
 * Entra AD group name -> the Role it grants. `spokeFromGroup: true` means the
 * spoke identifier is embedded in the group name itself (see
 * mapClaimsToUser), rather than the group being spoke-agnostic.
 */
export const GROUP_ROLE_MAPPINGS = {
  "SG-RPA-Admins": { role: "admin" },
  "SG-RPA-IPI-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-RSK-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-COM-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-CLD-Lead": { role: "hub_lead", spokeFromGroup: true },
  "SG-RPA-HubMembers": { role: "hub_member" },
  "SG-RPA-BusinessUsers": { role: "business_user" },
};

// Short group-name code -> the full spoke identifier used everywhere else
// (SPOKE_INFO / filters.spoke keys / reference.spokes[].spokeName).
const GROUP_SPOKE_CODE_TO_NAME = {
  IPI: "Insurance, Pensions & Investments",
  RSK: "Risk",
  COM: "Commercial",
  CLD: "Consumer Lending",
};

/**
 * Pure function: Entra ID token claims -> { id, name, email, roles, spokeIds }.
 * Identical logic to entra-provider.ts's mapClaimsToUser.
 *
 * Expected claims: oid (string), name (string), preferred_username (string),
 * groups (string[] — group names, requires the app registration to emit
 * group-name claims).
 */
export function mapClaimsToUser(claims) {
  const groups = Array.isArray(claims.groups) ? claims.groups.filter((g) => typeof g === "string") : [];

  const roles = new Set();
  const spokeIds = new Set();

  for (const group of groups) {
    const mapping = GROUP_ROLE_MAPPINGS[group];
    if (!mapping) continue;
    roles.add(mapping.role);
    if (mapping.spokeFromGroup) {
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
