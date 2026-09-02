// Type declarations for model-assembler.mjs. See that file's header comment
// for the full rowset contract; ModelJson mirrors src/rpaData.ts exactly
// (duplicated here, not imported, because this package has no dependency on
// the SPA's src/ tree — keep the two in step by hand if ModelJson changes).

export interface ModelJson {
  meta: { generatedAt: string; source: string; sourceRows: number; dateMin: string; dateMax: string; unmappedQueues: string[] };
  targets: { completionPct: number; exceptionRate: number; systemRate: number; costPerCase: number; utilMin: number; utilMax: number; vdiStaleDays: number };
  vdiOperatingHoursPerDay: number;
  spokes: { id: number; name: string; short: string; colorLight: string; colorDark: string }[];
  propositions: { name: string; spoke: string }[];
  processes: {
    id: number; name: string; acronym: string; description: string;
    proposition: string; spoke: string;
    queues: { queue: string; stage: string | null; order: number | null }[];
    smvMinutes: number; grade: string; gradeName: string; currentHourly: number;
    icon: string; tags: string[];
  }[];
  resources: {
    name: string; bot: string; acronym: string; vdi: string; class: string; spoke: string;
    spokeId: number | null;
    activeFrom: string; activeTo: string | null; notes: string | null;
    renewalDate: string; annualCostGBP: number | null; licenseExpiryDate: string | null; status: "active" | "retired";
  }[];
  exceptionReasons: { reason: string; type: "System" | "Business"; code: string }[];
  estateRateByDate: { d: string; cost: number; wd: number; ph: number }[];
  dayRows: { d: string; p: number; c: number; b: number; s: number; n: number; w: number; cw: number; gb: number; ec: number }[];
  excRows: { d: string; p: number; r: string; t: "System" | "Business"; n: number; w: number }[];
  resRows: { d: string; r: string; p: number; n: number; e: number; w: number; ec: number }[];
  dayWorktimeTotals: Record<string, number>;
  spokeDayWorktimeTotals: Record<string, number>;
  resourceActivity: Record<string, { firstSeen: string; lastSeen: string; items: number; spokesServed: string[] }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reference: any; // ReferenceJson — see src/reference/reference-store.ts
}

export interface AssembleModelRowsets {
  reference: unknown;
  spokes: Record<string, unknown>[];
  propositions: Record<string, unknown>[];
  processes: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  exceptionReasons: Record<string, unknown>[];
  estateRateByDate: Record<string, unknown>[];
  dayRows: Record<string, unknown>[];
  excRows: Record<string, unknown>[];
  resRows: Record<string, unknown>[];
  dayWorktimeTotals: Record<string, unknown>[];
  spokeDayWorktimeTotals: Record<string, unknown>[];
  resourceActivity: Record<string, unknown>[];
  meta: Record<string, unknown>;
  unmappedQueues?: (string | Record<string, unknown>)[];
}

export interface AssembleModelOptions {
  generatedAt: string;
  source: string;
}

export function assembleModel(rowsets: AssembleModelRowsets, opts: AssembleModelOptions): ModelJson;

export const _internal: {
  inForce: (history: { effectiveFrom: string }[], date: string) => unknown;
  gradeRate: (reference: any, grade: string, spokeId: unknown, date: string) => number;
  gradeNameOf: (reference: any, grade: string) => string;
  defaultExceptionCode: (reason: string) => string;
  round: (n: number | null | undefined, dp?: number) => number | null;
  dateOnly: (v: unknown) => string;
};
