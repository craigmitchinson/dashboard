import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ROWS,
  PROCESSES,
  PROCESS_BY_ID,
  VDIS,
  VDI_OPERATING_HOURS,
  SYSTEM_EXCEPTIONS,
  BUSINESS_EXCEPTIONS,
  DATE_MAX,
  DATE_MIN,
} from "./rpaData";
import type { DayRow, OutcomeKey } from "./rpaData";

const DAY = 86400000;

// --- filter (slicer) state --------------------------------------------------
export type RangePreset = 7 | 30 | 90 | "ytd" | "all" | "custom";

export interface Filters {
  proposition: string; // "All" | proposition
  processId: string; // "All" | process id
  queue: string; // "All" | queue code
  tags: string[]; // empty => all tags
  range: RangePreset;
  from?: string; // ISO, used when range === "custom"
  to?: string; // ISO, used when range === "custom"
}

const DEFAULTS: Filters = { proposition: "All", processId: "All", queue: "All", tags: [], range: 90 };

export const DATA_MIN_ISO = new Date(DATE_MIN).toISOString().slice(0, 10);
export const DATA_MAX_ISO = new Date(DATE_MAX).toISOString().slice(0, 10);
const DEFAULT_RATE = 28; // £ / colleague hour

// --- derived model ----------------------------------------------------------
export interface ProcessAgg {
  id: string;
  name: string;
  proposition: string;
  queue: string;
  completed: number;
  business: number;
  system: number;
  exceptions: number;
  attempts: number;
  completionPct: number;
  avgCycleSec: number;
  timeSavedHours: number;
  runtimeCost: number;
}

export interface ExceptionAgg {
  name: string;
  category: OutcomeKey;
  volume: number;
  pct: number;
  lastSeenTs: number;
}

export interface VdiAgg {
  id: string;
  name: string;
  pool: string;
  processes: number;
  cases: number;
  activeHours: number;
  availableHours: number;
  idleHours: number;
  idlePct: number;
  utilPct: number;
  cost: number;
}

export interface SeriesPoint {
  key: string; // label
  ts: number;
  completed: number;
  business: number;
  system: number;
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
  peopleRate: number;
  grossBenefit: number;
  automationCost: number;
  netBenefit: number;
  costPerCase: number;
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
  peopleRate: number;
  setPeopleRate: (n: number) => void;
  // process options narrowed by the active proposition
  processOptions: { id: string; name: string }[];
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

function matchEntities(r: DayRow, f: Filters) {
  const p = PROCESS_BY_ID.get(r.processId)!;
  if (f.proposition !== "All" && p.proposition !== f.proposition) return false;
  if (f.processId !== "All" && p.id !== f.processId) return false;
  if (f.queue !== "All" && p.queue !== f.queue) return false;
  if (f.tags.length && !p.tags.some((t) => f.tags.includes(t))) return false;
  return true;
}

// Aggregate a set of rows into the full model (measures + breakdowns).
function aggregate(rows: DayRow[], rangeDays: number, peopleRate: number) {
  let completed = 0,
    business = 0,
    system = 0,
    timeSavedHours = 0,
    runtimeCost = 0;

  const procMap = new Map<string, ProcessAgg>();
  const dayMap = new Map<string, SeriesPoint>();
  const monthMap = new Map<string, SeriesPoint>();

  // exception-type accumulators
  const typeVol = new Map<string, number>();
  const typeLast = new Map<string, number>();

  for (const r of rows) {
    const p = PROCESS_BY_ID.get(r.processId)!;
    const exc = r.business + r.system;
    const attempts = r.completed + exc;
    completed += r.completed;
    business += r.business;
    system += r.system;
    timeSavedHours += (r.completed * p.ahtSavedMin) / 60;
    const vdiRate = VDIS.find((v) => v.id === p.vdiId)!.ratePerHour;
    runtimeCost += ((attempts * p.avgRuntimeSec) / 3600) * vdiRate;

    // per process
    let pa = procMap.get(p.id);
    if (!pa) {
      pa = { id: p.id, name: p.name, proposition: p.proposition, queue: p.queue, completed: 0, business: 0, system: 0, exceptions: 0, attempts: 0, completionPct: 0, avgCycleSec: p.avgRuntimeSec, timeSavedHours: 0, runtimeCost: 0 };
      procMap.set(p.id, pa);
    }
    pa.completed += r.completed;
    pa.business += r.business;
    pa.system += r.system;
    pa.exceptions += exc;
    pa.attempts += attempts;
    pa.timeSavedHours += (r.completed * p.ahtSavedMin) / 60;
    pa.runtimeCost += ((attempts * p.avgRuntimeSec) / 3600) * vdiRate;

    // daily series
    let dp = dayMap.get(r.date);
    if (!dp) {
      dp = { key: r.date, ts: r.ts, completed: 0, business: 0, system: 0 };
      dayMap.set(r.date, dp);
    }
    dp.completed += r.completed;
    dp.business += r.business;
    dp.system += r.system;

    // monthly series
    const mk = new Date(r.ts).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    let mp = monthMap.get(mk);
    if (!mp) {
      mp = { key: mk, ts: r.ts, completed: 0, business: 0, system: 0 };
      monthMap.set(mk, mp);
    }
    mp.completed += r.completed;
    mp.business += r.business;
    mp.system += r.system;
    mp.ts = Math.min(mp.ts, r.ts);

    // exception types via the per-process weight fingerprint
    const sysSum = p.sysW.reduce((a, b) => a + b, 0) || 1;
    const busSum = p.busW.reduce((a, b) => a + b, 0) || 1;
    SYSTEM_EXCEPTIONS.forEach((name, i) => {
      const v = r.system * (p.sysW[i] / sysSum);
      if (v <= 0) return;
      typeVol.set(name, (typeVol.get(name) ?? 0) + v);
      if (r.system > 0) typeLast.set(name, Math.max(typeLast.get(name) ?? 0, r.ts));
    });
    BUSINESS_EXCEPTIONS.forEach((name, i) => {
      const v = r.business * (p.busW[i] / busSum);
      if (v <= 0) return;
      typeVol.set(name, (typeVol.get(name) ?? 0) + v);
      if (r.business > 0) typeLast.set(name, Math.max(typeLast.get(name) ?? 0, r.ts));
    });
  }

  const exceptions = business + system;
  const attempts = completed + exceptions;
  const completionPct = attempts ? completed / attempts : 0;

  const byProcess = [...procMap.values()].map((p) => ({ ...p, completionPct: p.attempts ? p.completed / p.attempts : 0 }));
  byProcess.sort((a, b) => b.attempts - a.attempts);

  const daily = [...dayMap.values()].sort((a, b) => a.ts - b.ts);
  const monthly = [...monthMap.values()].sort((a, b) => a.ts - b.ts);

  const totalExc = exceptions || 1;
  const byException: ExceptionAgg[] = [...typeVol.entries()]
    .map(([name, volume]) => ({
      name,
      category: (SYSTEM_EXCEPTIONS as readonly string[]).includes(name) ? ("system" as const) : ("business" as const),
      volume: Math.round(volume),
      pct: volume / totalExc,
      lastSeenTs: typeLast.get(name) ?? 0,
    }))
    .sort((a, b) => b.volume - a.volume);

  // matrix: processes (rows) x exception types (cols)
  const types = [
    ...SYSTEM_EXCEPTIONS.map((name) => ({ name, category: "system" as const })),
    ...BUSINESS_EXCEPTIONS.map((name) => ({ name, category: "business" as const })),
  ];
  const cell: number[][] = [];
  let max = 0;
  for (const pa of byProcess) {
    const p = PROCESS_BY_ID.get(pa.id)!;
    const sysSum = p.sysW.reduce((a, b) => a + b, 0) || 1;
    const busSum = p.busW.reduce((a, b) => a + b, 0) || 1;
    const row = types.map((t) => {
      let v = 0;
      const si = (SYSTEM_EXCEPTIONS as readonly string[]).indexOf(t.name);
      if (si >= 0) v = pa.system * (p.sysW[si] / sysSum);
      else {
        const bi = (BUSINESS_EXCEPTIONS as readonly string[]).indexOf(t.name);
        v = pa.business * (p.busW[bi] / busSum);
      }
      v = Math.round(v);
      max = Math.max(max, v);
      return v;
    });
    cell.push(row);
  }

  // VDI utilisation
  const calendarDays = rangeDays;
  const vdiActive = new Map<string, { hours: number; cases: number; procs: Set<string> }>();
  for (const pa of byProcess) {
    const p = PROCESS_BY_ID.get(pa.id)!;
    let e = vdiActive.get(p.vdiId);
    if (!e) {
      e = { hours: 0, cases: 0, procs: new Set() };
      vdiActive.set(p.vdiId, e);
    }
    e.hours += (pa.attempts * p.avgRuntimeSec) / 3600;
    e.cases += pa.attempts;
    e.procs.add(p.id);
  }
  const availableHours = calendarDays * VDI_OPERATING_HOURS;
  const vdis: VdiAgg[] = VDIS.map((v) => {
    const e = vdiActive.get(v.id);
    const activeHours = e?.hours ?? 0;
    const idleHours = Math.max(0, availableHours - activeHours);
    return {
      id: v.id,
      name: v.name,
      pool: v.pool,
      processes: e?.procs.size ?? 0,
      cases: e?.cases ?? 0,
      activeHours,
      availableHours,
      idleHours,
      idlePct: availableHours ? idleHours / availableHours : 0,
      utilPct: availableHours ? Math.min(1, activeHours / availableHours) : 0,
      cost: availableHours * v.ratePerHour,
    };
  }).sort((a, b) => b.utilPct - a.utilPct);

  const grossBenefit = timeSavedHours * peopleRate;
  // FTE equivalent: hours saved against a colleague's productive hours in the window
  const fte = timeSavedHours / (calendarDays * (5 / 7) * 7.4);

  return {
    completed,
    business,
    system,
    exceptions,
    attempts,
    completionPct,
    timeSavedHours,
    fte,
    grossBenefit,
    automationCost: runtimeCost,
    netBenefit: grossBenefit - runtimeCost,
    costPerCase: completed ? runtimeCost / completed : 0,
    daily,
    monthly,
    byProcess,
    byException,
    matrix: { processes: byProcess, types, cell, max },
    vdis,
  };
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<Filters>(DEFAULTS);
  const [peopleRate, setPeopleRate] = useState(DEFAULT_RATE);

  const setFilters = (f: Partial<Filters>) => setFiltersState((prev) => ({ ...prev, ...f }));
  const reset = () => {
    setFiltersState(DEFAULTS);
    setPeopleRate(DEFAULT_RATE);
  };

  const processOptions = useMemo(() => {
    const ps = filters.proposition === "All" ? PROCESSES : PROCESSES.filter((p) => p.proposition === filters.proposition);
    return ps.map((p) => ({ id: p.id, name: p.name }));
  }, [filters.proposition]);

  const model = useMemo<Model>(() => {
    const { lo, hi } = windowOf(filters);
    const rangeDays = Math.round((hi - lo) / DAY) + 1;
    const rows = ROWS.filter((r) => r.ts >= lo && r.ts <= hi && matchEntities(r, filters));
    const agg = aggregate(rows, rangeDays, peopleRate);

    // previous equal-length window for deltas (entity filters held constant)
    const prevHi = lo - DAY;
    const prevLo = prevHi - (rangeDays - 1) * DAY;
    const prevRows = ROWS.filter((r) => r.ts >= prevLo && r.ts <= prevHi && matchEntities(r, filters));
    const prevAgg = aggregate(prevRows, rangeDays, peopleRate);

    return {
      rows,
      rangeDays,
      cutoffTs: lo,
      peopleRate,
      ...agg,
      prev: {
        completed: prevAgg.completed,
        exceptions: prevAgg.exceptions,
        costPerCase: prevAgg.costPerCase,
        completionPct: prevAgg.completionPct,
        timeSavedHours: prevAgg.timeSavedHours,
      },
    };
  }, [filters, peopleRate]);

  return (
    <FiltersContext.Provider value={{ filters, setFilters, reset, peopleRate, setPeopleRate, processOptions, model }}>
      {children}
    </FiltersContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}
