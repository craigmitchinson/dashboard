// Ambient type declaration for shared/auth-mappings.mjs (a plain ESM module
// with no TS types of its own, owned by the server-side build, imported
// by src/auth/entra-provider.ts).
//
// NOTE on the module specifier below: TypeScript's ambient module
// declarations are not permitted to use a relative name (a string starting
// with "./" or "../") — `declare module "../../shared/auth-mappings.mjs"`
// is a compile error ("Ambient module declaration cannot specify relative
// module name", TS2436), so it can't be declared against the exact relative
// specifier used at the import site as originally described. Instead this
// uses TypeScript's supported wildcard form (a single `*` standing in for
// any path prefix), matched against the specifier's trailing path segments —
// this still resolves for entra-provider.ts's
// `from "../../shared/auth-mappings.mjs"` import (and for any other relative
// depth that happens to import the same file) without violating the
// relative-name restriction.
declare module "*/shared/auth-mappings.mjs" {
  import type { Role, User } from "./types";
  export const GROUP_ROLE_MAPPINGS: Record<string, { role: Role; spokeFromGroup?: boolean }>;
  export function mapClaimsToUser(claims: Record<string, unknown>): User;
}
