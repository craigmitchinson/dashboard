// Hand-written types for the plain-ESM feature catalogue module
// (docs/feature-catalogue.data.mjs is data, not TypeScript — see that file's
// own header comment for its shape). Used by catalogue-data.ts to type-assert
// the raw import once, in one place, rather than every consumer working with
// `any`.
export interface CatalogueTable {
  headers: string[];
  rows: (string | number)[][];
}

export interface CatalogueItem {
  id: string;
  title: string;
  body?: string;
  table?: CatalogueTable;
}

export interface CatalogueSection {
  id: string;
  title: string;
  intro?: string;
  items: CatalogueItem[];
}

export interface CatalogueMeta {
  title: string;
  subtitle: string;
  version: string;
  dated: string;
  audience: string;
  purpose: string;
  howToReview: string[];
  hubs: { key: string; label: string }[];
}
