// Local structural type for the rowsets object passed to
// shared/model-assembler.mjs's assembleModel(). Kept here (rather than
// importing shared/model-assembler.d.ts by specifier) so the server's
// module resolution never depends on TS's cross-extension (.mjs/.d.ts)
// declaration-file matching, which is fragile under NodeNext resolution.
// See shared/model-assembler.mjs's header comment for the authoritative
// contract this type mirrors.
export type Row = Record<string, unknown>;

export interface ModelRowsets {
  reference: Record<string, unknown>;
  spokes: Row[];
  propositions: Row[];
  processes: Row[];
  resources: Row[];
  exceptionReasons: Row[];
  estateRateByDate: Row[];
  dayRows: Row[];
  excRows: Row[];
  resRows: Row[];
  dayWorktimeTotals: Row[];
  spokeDayWorktimeTotals: Row[];
  resourceActivity: Row[];
  meta: Row;
  unmappedQueues: (string | Row)[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelJson = Record<string, any>;
