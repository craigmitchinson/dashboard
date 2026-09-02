// Ambient module declaration for the shared/*.mjs files this server imports
// at runtime. They are plain ESM JS with a hand-written *.d.ts of their own
// (shared/model-assembler.d.ts) that NodeNext resolution doesn't
// automatically pair with a *.mjs specifier (it looks for *.d.mts) — see
// assembler.ts's header comment. Each named export used anywhere in this
// server is declared here as `any`; assembler.ts casts assembleModel's
// return value to the server's own ModelJson type for real typing at that
// one call site.
declare module "*.mjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const assembleModel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const mapClaimsToUser: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const GROUP_ROLE_MAPPINGS: any;
}
