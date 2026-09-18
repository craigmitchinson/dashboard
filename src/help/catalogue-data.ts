// ---------------------------------------------------------------------------
// help/catalogue-data.ts
// ---------------------------------------------------------------------------
// Single typed entry point onto docs/feature-catalogue.data.mjs — a plain,
// type-less ESM module (relative-specifier imports resolve straight to the
// real file on disk, which has no sibling .d.mts, so TS reports an implicit
// any at the import itself; see catalogue-types.ts for the shape we assert
// below). Isolating the one `@ts-expect-error` to this file keeps every
// other consumer (HelpDrawer.tsx) working with real types.
// ---------------------------------------------------------------------------
// @ts-expect-error — docs/feature-catalogue.data.mjs has no type declarations of its own.
import { SECTIONS as RAW_SECTIONS, CATALOGUE_META as RAW_META } from "../../docs/feature-catalogue.data.mjs";
import type { CatalogueSection, CatalogueMeta } from "./catalogue-types";

export const SECTIONS = RAW_SECTIONS as CatalogueSection[];
export const CATALOGUE_META = RAW_META as CatalogueMeta;
