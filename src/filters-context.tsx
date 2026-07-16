import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ROWS,
  EXC_ROWS,
  RES_ROWS,
  ESTATE_RATE,
  PROCESSES,
  PROCESS_BY_ID,
  VDIS,
  VDI_OPERATING_HOURS,
  EXCEPTION_TYPES,
  DATE_MAX,
  DATE_MIN,
  DATA_MIN_ISO,
  DATA_MAX_ISO,
  DAY_WORKTIME_TOTALS,
  SPOKE_DAY_WORKTIME_TOTALS,
} from "./rpaData";
import type { DayRow, OutcomeKey } from "./rpaData";
import { ReferenceProvider, useReference } from "./reference/reference-context";
import { availableDaysInWindow, benefitForRow, buildRateTables, costForRow, costForResRow } from "./reference/economics";
import type { RateTables } from "./reference/economics";
import type { ReferenceJson } from "./reference/reference-store";

const DAY = 86400000;

// --- filter (slicer) state --------------------------------------------------
export type RangePreset = 7 | 30 | 90 | "ytd" | "all" | "custom";

export interface Filters {
  spoke: string; // "All" (hub view) | spoke name — each spoke selects itself here
  proposition: string; // "All" | proposition
  processId: string; // "All" | process id
  queue: string; // "All" | queue code
  tags: string[]; // empty => all tags
  range: RangePreset;
  from?: string; // ISO, used when range === "custom"
  to?: string; // ISO, used when range === "custom"
}

export const DEFAULT_FILTERS: Filters = { spoke: "All", proposition: "All", processId: "All", queue: "All", tags: [], range: 90 };

export { DATA_MIN_ISO, DATA_MAX_ISO } from "./rpaData";
// 0 = "value benefit at each process's own grade rate" (the honest default);
// any other value is a what-if override applied as a flat £/h across the board.
export const RATE_AUTO = 0;

// --- saved views --------------------------------------------------------------
export interface SavedView {
  name: string;
  filters: Filters;
  peopleRate: number;
  pageId?: string;
  savedAt: string;
}

// --- derived model ----------------------------------------------------------
export interface ProcessAgg {
  id: string;
  name: string;
  spoke: string;
  proposition: string;
  queue: string;
  completed: number;
  business: number;
  system: number;
  exceptions: number;
  attempts: number;
  completionPct: number;
  avgCycleSec: number; // bot runtime per completed item, from the data
  timeSavedHours: number;
  runtimeCost: number; // apportioned estate cost (hub pool + spoke infra), time-correct
}

export interface ExceptionAgg {
  name: string;
  category: OutcomeKey;
  volume: number;
  pct: number;
  lastSeenTs: number;
  avgTimeToFailSec: number;
}

export interface VdiAgg {
  id: string;
  name: string;
  pool: string;
  spoke: string;
  processes: number;
  cases: number;
  activeHours: number;
  availableHours: number;
  idleHours: number;
  idlePct: number;
  utilPct: number;
  cost: number; // this worker's share of the apportioned estate cost
}

export interface SeriesPoint {
  key: string; // label
  ts: number;
  completed: number;
  business: number;
  system: number;
  cost: number; // apportioned estate cost (time-correct)
  benefit: number; // gross benefit at the active rate basis
}

export interface Model {
  rows: DayRow[];
  rangeDays: number;
  cutoffTs: number;
  // headline measures
  completed: number;
  business: number;
  system: number;
  exceptions: number;
  attempts: number;
  completionPct: number;
  timeSavedHours: number;
  fte: number;
  peopleRate: number; // EFFECTIVE blended £/h in force (override, or derived from grade rates)
  grossBenefit: number;
  automationCost: number;
  netBenefit: number;
  costPerCase: number;
  // D4: cost of the hub + spoke pools on days with zero worktime across the
  // whole estate in the active window — a pure transparency figure, NOT
  // folded into automationCost/netBenefit/costPerCase (those keep meaning
  // "cost attributable to work that ran"). automationCost + unattributedCostGBP
  // = total estate spend, for P&L reconciliation.
  unattributedCostGBP: number;
  // breakdowns
  daily: SeriesPoint[];
  monthly: SeriesPoint[];
  byProcess: ProcessAgg[];
  byException: ExceptionAgg[];
  matrix: { processes: ProcessAgg[]; types: { name: string; category: "system" | "business" }[]; cell: number[][]; max: number };
  vdis: VdiAgg[];
  // period-over-period (vs the immediately preceding window of equal length)
  prev: { completed: number; exceptions: number; costPerCase: number; completionPct: number; timeSavedHours: number };
}

interface Ctx {
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  reset: () => void;
  peopleRate: number; // raw slicer state; RATE_AUTO (0) = per-grade rates
  setPeopleRate: (n: number) => void;
  applyView: (v: SavedView) => void;
  // process options narrowed by the active spoke/proposition
  processOptions: { id: string; name: string }[];
  propositionOptions: string[];
  model: Model;
}

const FiltersContext = createContext<Ctx | null>(null);

// Resolve the active filter into an inclusive [lo, hi] window in ms.
function windowOf(f: Filters): { lo: number; hi: number } {
  if (f.range === "all") return { lo: DATE_MIN, hi: DATE_MAX };
  if (f.range === "ytd") {
    const y = new Date(DATE_MAX).getUTCFullYear();
    return { lo: Math.max(DATE_MIN, Date.UTC(y, 0, 1)), hi: DATE_MAX };
  }
  if (f.range === "custom") {
    const lo = f.from ? Date.parse(f.from + "T00:00:00Z") : DATE_MAX - 89 * DAY;
    const hi = f.to ? Date.parse(f.to + "T00:00:00Z") : DATE_MAX;
    return { lo: Math.max(DATE_MIN, Math.min(lo, hi)), hi: Math.min(DATE_MAX, Math.max(lo, hi)) };
  }
  return { lo: DATE_MAX - (f.range - 1) * DAY, hi: DATE_MAX };
}

function matchProcess(processId: string, f: Filters) {
  const p = PROCESS_BY_ID.get(processId);
  if (!p) return false;
  if (f.spoke !== "All" && p.spoke !== f.spoke) return false;
  if (f.proposition !== "All" && p.proposition !== f.proposition) return false;
  if (f.processId !== "All" && p.id !== f.processId) return false;
  if (f.queue !== "All" && !p.queues.some((q) => q.queue === f.queue)) return false;
  if (f.tags.length && !p.tags.some((t) => f.tags.includes(t))) return false;
  return true;
}

// Aggregate a filtered window into the full model (measures + breakdowns).
// Benefit and estate cost are resolved live from the reference-data-driven
// rate tables (src/reference/economics.ts) so editing reference data changes
// every number instantly — no rebuild needed.
function aggregate(
  f: Filters,
  lo: number,
  hi: number,
  rangeDays: number,
  rateOverride: number,
  reference: ReferenceJson,
  tables: RateTables,
) {
  const rows = ROWS.filter((r) => r.ts >= lo && r.ts <= hi && matchProcess(r.processId, f));
  const excRows = EXC_ROWS.filter((r) => r.ts >= lo && r.ts <= hi && matchProcess(r.processId, f));
  const resRows = RES_ROWS.filter((r) => r.ts >= lo && r.ts <= hi && matchProcess(r.processId, f));

  let completed = 0,
    business = 0,
    system = 0,
    timeSavedHours = 0,
    grossBenefit = 0,
    estateCost = 0;

  const procMap = new Map<string, ProcessAgg & { completedWt: number }>();
  const dayMap = new Map<string, SeriesPoint>();
  const monthMap = new Map<string, SeriesPoint>();

  for (const r of rows) {
    const p = PROCESS_BY_ID.get(r.processId)!;
    const exc = r.business + r.system;
    const attempts = r.completed + exc;
    const hours = (r.completed * p.smvMinutes) / 60;
    // benefit: grade-rate-correct (date-effective), unless a flat what-if rate
    // override is active (then: hours saved x override) — rateOverride NEVER
    // touches estate cost.
    const benefit = benefitForRow(r, p, tables, rateOverride);
    const cost = costForRow(r, p, tables);
    completed += r.completed;
    business += r.business;
    system += r.system;
    timeSavedHours += hours;
    grossBenefit += benefit;
    estateCost += cost;

    // per process
    let pa = procMap.get(p.id);
    if (!pa) {
      pa = { id: p.id, name: p.name, spoke: p.spoke, proposition: p.proposition, queue: p.queue, completed: 0, business: 0, system: 0, exceptions: 0, attempts: 0, completionPct: 0, avgCycleSec: 0, timeSavedHours: 0, runtimeCost: 0, completedWt: 0 };
      procMap.set(p.id, pa);
    }
    pa.completed += r.completed;
    pa.business += r.business;
    pa.system += r.system;
    pa.exceptions += exc;
    pa.attempts += attempts;
    pa.timeSavedHours += hours;
    pa.runtimeCost += cost;
    pa.completedWt += r.completedWorktimeSec;

    // daily series
    let dp = dayMap.get(r.date);
    if (!dp) {
      dp = { key: r.date, ts: r.ts, completed: 0, business: 0, system: 0, cost: 0, benefit: 0 };
      dayMap.set(r.date, dp);
    }
    dp.completed += r.completed;
    dp.business += r.business;
    dp.system += r.system;
    dp.cost += cost;
    dp.benefit += benefit;

    // monthly series
    const mk = new Date(r.ts).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    let mp = monthMap.get(mk);
    if (!mp) {
      mp = { key: mk, ts: r.ts, completed: 0, business: 0, system: 0, cost: 0, benefit: 0 };
      monthMap.set(mk, mp);
    }
    mp.completed += r.completed;
    mp.business += r.business;
    mp.system += r.system;
    mp.cost += cost;
    mp.benefit += benefit;
    mp.ts = Math.min(mp.ts, r.ts);
  }

  const exceptions = business + system;
  const attempts = completed + exceptions;
  const completionPct = attempts ? completed / attempts : 0;

  const byProcess = [...procMap.values()].map(({ completedWt, ...p }) => ({
    ...p,
    completionPct: p.attempts ? p.completed / p.attempts : 0,
    avgCycleSec: p.completed ? completedWt / p.completed : 0,
  }));
  byProcess.sort((a, b) => b.attempts - a.attempts);

  const daily = [...dayMap.values()].sort((a, b) => a.ts - b.ts);
  const monthly = [...monthMap.values()].sort((a, b) => a.ts - b.ts);

  // exception types: REAL reasons from the work queue data
  const typeAgg = new Map<string, { volume: number; wt: number; last: number }>();
  for (const e of excRows) {
    let ta = typeAgg.get(e.reason);
    if (!ta) typeAgg.set(e.reason, (ta = { volume: 0, wt: 0, last: 0 }));
    ta.volume += e.count;
    ta.wt += e.worktimeSec;
    ta.last = Math.max(ta.last, e.ts);
  }
  const totalExc = exceptions || 1;
  const byException: ExceptionAgg[] = EXCEPTION_TYPES.filter((ty) => typeAgg.has(ty.name)).map((ty) => {
    const ta = typeAgg.get(ty.name)!;
    return {
      name: ty.name,
      category: ty.category,
      volume: ta.volume,
      pct: ta.volume / totalExc,
      lastSeenTs: ta.last,
      avgTimeToFailSec: ta.volume ? ta.wt / ta.volume : 0,
    };
  }).sort((a, b) => b.volume - a.volume);

  // matrix: processes (rows) x exception reasons (cols), real counts
  const types = EXCEPTION_TYPES.map((t) => ({ name: t.name, category: t.category as "system" | "business" }));
  const typeIdx = new Map(types.map((t, i) => [t.name, i]));
  const procIdx = new Map(byProcess.map((p, i) => [p.id, i]));
  const cell: number[][] = byProcess.map(() => types.map(() => 0));
  let max = 0;
  for (const e of excRows) {
    const ri = procIdx.get(e.processId);
    const ci = typeIdx.get(e.reason);
    if (ri == null || ci == null) continue;
    cell[ri][ci] += e.count;
    max = Math.max(max, cell[ri][ci]);
  }

  // resource (VDI) utilisation from the per-resource fact rows
  const vdiById = new Map(VDIS.map((v) => [v.id, v]));
  const resAgg = new Map<string, { wt: number; cases: number; cost: number; procs: Set<string> }>();
  for (const r of resRows) {
    let e = resAgg.get(r.resource);
    if (!e) resAgg.set(r.resource, (e = { wt: 0, cases: 0, cost: 0, procs: new Set() }));
    const v = vdiById.get(r.resource);
    const rp = PROCESS_BY_ID.get(r.processId);
    e.wt += r.worktimeSec;
    e.cases += r.items;
    if (v && rp) e.cost += costForResRow(r, v, rp, tables);
    e.procs.add(r.processId);
  }
  const vdis: VdiAgg[] = VDIS.filter((v) => f.spoke === "All" || v.spoke === f.spoke || resAgg.has(v.id)).map((v) => {
    const e = resAgg.get(v.id);
    const activeHours = (e?.wt ?? 0) / 3600;
    const availableHours = availableDaysInWindow(v, reference, lo, hi) * VDI_OPERATING_HOURS;
    const idleHours = Math.max(0, availableHours - activeHours);
    return {
      id: v.id,
      name: v.name,
      pool: v.pool,
      spoke: v.spoke,
      processes: e?.procs.size ?? 0,
      cases: e?.cases ?? 0,
      activeHours,
      availableHours,
      idleHours,
      idlePct: availableHours ? idleHours / availableHours : 0,
      utilPct: availableHours ? Math.min(1, activeHours / availableHours) : 0,
      cost: e?.cost ?? 0,
    };
  })
    .filter((v) => v.availableHours > 0 || v.cases > 0)
    .sort((a, b) => b.utilPct - a.utilPct);

  // FTE released: hours saved vs a colleague's productive hours in the window,
  // using the working assumptions in force (from the estate cost history)
  const assumptions = ESTATE_RATE.get(new Date(hi).toISOString().slice(0, 10)) ?? { workingDays: 252, prodHours: 7.5, costPerDay: 0 };
  const windowWorkingHours = rangeDays * (assumptions.workingDays / 365.25) * assumptions.prodHours;
  const fte = windowWorkingHours ? timeSavedHours / windowWorkingHours : 0;

  // D4: pool cost the pipeline would otherwise silently drop on zero-worktime
  // days — summed only for transparency, see the Model.unattributedCostGBP doc.
  let unattributedCostGBP = 0;
  for (const [date, poolCost] of tables.zeroWorktimePoolCostByDate) {
    const ts = Date.parse(date + "T00:00:00Z");
    if (ts >= lo && ts <= hi) unattributedCostGBP += poolCost;
  }

  return {
    rows,
    completed,
    business,
    system,
    exceptions,
    attempts,
    completionPct,
    timeSavedHours,
    fte,
    peopleRate: rateOverride || (timeSavedHours ? grossBenefit / timeSavedHours : 0),
    grossBenefit,
    automationCost: estateCost,
    netBenefit: grossBenefit - estateCost,
    costPerCase: completed ? estateCost / completed : 0,
    unattributedCostGBP,
    daily,
    monthly,
    byProcess,
    byException,
    matrix: { processes: byProcess, types, cell, max },
    vdis,
  };
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  return (
    <ReferenceProvider>
      <FiltersProviderInner>{children}</FiltersProviderInner>
    </ReferenceProvider>
  );
}

function FiltersProviderInner({ children }: { children: ReactNode }) {
  const { reference } = useReference();
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [peopleRate, setPeopleRate] = useState(RATE_AUTO);

  const setFilters = (f: Partial<Filters>) => setFiltersState((prev) => ({ ...prev, ...f }));
  const reset = () => {
    setFiltersState(DEFAULT_FILTERS);
    setPeopleRate(RATE_AUTO);
  };
  const applyView = (v: SavedView) => {
    setFiltersState({ ...DEFAULT_FILTERS, ...v.filters });
    setPeopleRate(v.peopleRate ?? RATE_AUTO);
  };

  const propositionOptions = useMemo(() => {
    const ps = filters.spoke === "All" ? PROCESSES : PROCESSES.filter((p) => p.spoke === filters.spoke);
    return Array.from(new Set(ps.map((p) => p.proposition)));
  }, [filters.spoke]);

  const processOptions = useMemo(() => {
    const ps = PROCESSES.filter(
      (p) => (filters.spoke === "All" || p.spoke === filters.spoke) && (filters.proposition === "All" || p.proposition === filters.proposition),
    );
    return ps.map((p) => ({ id: p.id, name: p.name }));
  }, [filters.spoke, filters.proposition]);

  // Reference-data-driven rate tables: rebuilt only when reference changes
  // (edits in the browser), not on every filter/rate change.
  const tables = useMemo(
    () => buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS),
    [reference],
  );

  const model = useMemo<Model>(() => {
    const { lo, hi } = windowOf(filters);
    const rangeDays = Math.round((hi - lo) / DAY) + 1;
    const agg = aggregate(filters, lo, hi, rangeDays, peopleRate, reference, tables);

    // previous equal-length window for deltas (entity filters held constant)
    const prevHi = lo - DAY;
    const prevLo = prevHi - (rangeDays - 1) * DAY;
    const prevAgg = aggregate(filters, prevLo, prevHi, rangeDays, peopleRate, reference, tables);

    return {
      rangeDays,
      cutoffTs: lo,
      ...agg,
      prev: {
        completed: prevAgg.completed,
        exceptions: prevAgg.exceptions,
        costPerCase: prevAgg.costPerCase,
        completionPct: prevAgg.completionPct,
        timeSavedHours: prevAgg.timeSavedHours,
      },
    };
  }, [filters, peopleRate, reference, tables]);

  return (
    <FiltersContext.Provider value={{ filters, setFilters, reset, peopleRate, setPeopleRate, applyView, processOptions, propositionOptions, model }}>
      {children}
    </FiltersContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}
