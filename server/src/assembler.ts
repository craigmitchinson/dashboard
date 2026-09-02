// ---------------------------------------------------------------------------
// assembler.ts — typed wrapper around shared/model-assembler.mjs's plain-JS
// assembleModel(). See model-types.ts for why this isn't a `.d.ts`-specifier
// import: NodeNext module resolution expects a `.d.mts` sibling for a
// `.mjs` file, and shared/model-assembler.d.ts is deliberately a plain
// `.d.ts` (per the task spec) — importing it by path is fragile, so this
// file is the one place that bridges the untyped JS import to a typed call.
// ---------------------------------------------------------------------------
// Typed via ambient.d.ts's `declare module "*.mjs"` — the return value is
// cast to the server's own ModelJson type below.
import { assembleModel as assembleModelJs } from "../../shared/model-assembler.mjs";
import type { ModelJson, ModelRowsets } from "./model-types.js";

export function assembleModel(rowsets: ModelRowsets, opts: { generatedAt: string; source: string }): ModelJson {
  return assembleModelJs(rowsets, opts) as ModelJson;
}
