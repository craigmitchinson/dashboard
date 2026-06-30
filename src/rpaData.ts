// ---------------------------------------------------------------------------
// Blue Prism RPA dataset (semantic model)
// ---------------------------------------------------------------------------
// A single, deterministic dataset that stands in for the warehouse a Power BI
// report would import. Everything downstream — slicers, cards, charts, the
// matrix, the tables — reads from ROWS and the dimension tables below. Numbers
// are illustrative but plausible, and generated from a fixed seed so the report
// looks the same on every load (a prototype, not a live feed).
//
// Grain of the fact table (ROWS): one row per (date, process). Outcomes split
// into completed / business exception / system exception. Exception *types* are
// distributed from a per-process weight matrix so the Exceptions matrix and the
// detail table react to the same date and entity filters as everything else.

import type { ComponentType } from "react";
import {
  IconForm,
  IconLetter,
  IconPayment,
  IconShield,
  IconGlobe,
  IconRoute,
  IconInbox,
  IconCard,
  IconRefresh,
} from "./components/icons";

// --- deterministic PRNG (mulberry32) ---------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type OutcomeKey = "completed" | "business" | "system";

export const OUTCOMES: { key: OutcomeKey; label: string }[] = [
  { key: "completed", label: "Completed" },
  { key: "business", label: "Business exception" },
  { key: "system", label: "System exception" },
];

// --- dimensions -------------------------------------------------------------
export interface ProcessDim {
  id: string;
  name: string;
  proposition: string;
  queue: string;
  tags: string[];
  Icon: ComponentType<{ size?: number }>;
  vdiId: string;
  baseDaily: number; // mean completed cases per operating day
  ahtSavedMin: number; // colleague handling time saved per completed case (mins)
  avgRuntimeSec: number; // digital worker runtime per case (sec)
  busRate: number; // base business-exception rate
  sysRate: number; // base system-exception rate
  // weight vectors over exception types (unnormalised; resolved at build)
  sysW: number[];
  busW: number[];
}

export const PROPOSITIONS = [
  "Mortgages",
  "Current Accounts",
  "Savings",
  "Credit Cards",
  "Loans",
  "Insurance",
] as const;

export const SYSTEM_EXCEPTIONS = [
  "Application timeout",
  "Element not found",
  "Login failure",
  "Citrix session lost",
  "Unexpected pop-up",
  "Network error",
  "Read / write failure",
] as const;

export const BUSINESS_EXCEPTIONS = [
  "Validation failed",
  "Document missing",
  "Account not found",
  "Duplicate case",
  "Manual review required",
  "Data mismatch",
  "SLA breach",
] as const;

export interface ExceptionTypeDim {
  name: string;
  category: OutcomeKey; // "system" | "business"
}
export const EXCEPTION_TYPES: ExceptionTypeDim[] = [
  ...SYSTEM_EXCEPTIONS.map((name) => ({ name, category: "system" as const })),
  ...BUSINESS_EXCEPTIONS.map((name) => ({ name, category: "business" as const })),
];

// Short, collision-free column codes for the exception heatmap.
export const EX_CODE: Record<string, string> = {
  "Application timeout": "APT",
  "Element not found": "ENF",
  "Login failure": "LGN",
  "Citrix session lost": "CTX",
  "Unexpected pop-up": "POP",
  "Network error": "NET",
  "Read / write failure": "RWF",
  "Validation failed": "VAL",
  "Document missing": "DOC",
  "Account not found": "ACC",
  "Duplicate case": "DUP",
  "Manual review required": "MRR",
  "Data mismatch": "DMM",
  "SLA breach": "SLA",
};

// Build the process table. Weight vectors are seeded so each process has a
// distinctive exception fingerprint for the matrix.
const wseed = rng(99);
function weights(n: number, sparse: number) {
  return Array.from({ length: n }, () => (wseed() < sparse ? 0 : 0.15 + wseed() ** 1.6));
}

interface ProcSeed {
  id: string;
  name: string;
  proposition: string;
  queue: string;
  tags: string[];
  Icon: ComponentType<{ size?: number }>;
  vdiId: string;
  baseDaily: number;
  ahtSavedMin: number;
  avgRuntimeSec: number;
  busRate: number;
  sysRate: number;
}

const PROC_SEEDS: ProcSeed[] = [
  { id: "mtg-offer", name: "Mortgage Offer Production", proposition: "Mortgages", queue: "MTG-OFFER", tags: ["Customer-facing", "Letters"], Icon: IconLetter, vdiId: "BP-RT-01", baseDaily: 210, ahtSavedMin: 18, avgRuntimeSec: 95, busRate: 0.07, sysRate: 0.05 },
  { id: "mtg-val", name: "Valuation Booking", proposition: "Mortgages", queue: "MTG-VAL", tags: ["Scheduling"], Icon: IconRoute, vdiId: "BP-RT-01", baseDaily: 160, ahtSavedMin: 11, avgRuntimeSec: 70, busRate: 0.05, sysRate: 0.04 },
  { id: "ca-open", name: "Account Opening", proposition: "Current Accounts", queue: "CA-OPEN", tags: ["Onboarding", "KYC"], Icon: IconForm, vdiId: "BP-RT-02", baseDaily: 540, ahtSavedMin: 14, avgRuntimeSec: 110, busRate: 0.06, sysRate: 0.045 },
  { id: "ca-addr", name: "Address Change", proposition: "Current Accounts", queue: "CA-ADDR", tags: ["Maintenance"], Icon: IconForm, vdiId: "BP-RT-02", baseDaily: 480, ahtSavedMin: 7, avgRuntimeSec: 45, busRate: 0.03, sysRate: 0.03 },
  { id: "ca-so", name: "Standing Order Amendment", proposition: "Current Accounts", queue: "CA-SO", tags: ["Payments", "Maintenance"], Icon: IconPayment, vdiId: "BP-RT-03", baseDaily: 300, ahtSavedMin: 6, avgRuntimeSec: 40, busRate: 0.04, sysRate: 0.05 },
  { id: "ca-kyc", name: "KYC Periodic Refresh", proposition: "Current Accounts", queue: "CA-KYC", tags: ["KYC", "Compliance"], Icon: IconShield, vdiId: "BP-RT-03", baseDaily: 220, ahtSavedMin: 22, avgRuntimeSec: 130, busRate: 0.09, sysRate: 0.06 },
  { id: "sav-rate", name: "Savings Rate Switch", proposition: "Savings", queue: "SAV-RATE", tags: ["Maintenance", "Batch"], Icon: IconRefresh, vdiId: "BP-RT-04", baseDaily: 260, ahtSavedMin: 5, avgRuntimeSec: 35, busRate: 0.03, sysRate: 0.035 },
  { id: "cc-repl", name: "Card Replacement", proposition: "Credit Cards", queue: "CC-REPL", tags: ["Customer-facing"], Icon: IconCard, vdiId: "BP-RT-04", baseDaily: 380, ahtSavedMin: 8, avgRuntimeSec: 55, busRate: 0.04, sysRate: 0.04 },
  { id: "cc-disp", name: "Payment Dispute Logging", proposition: "Credit Cards", queue: "CC-DISP", tags: ["Disputes", "Customer-facing"], Icon: IconInbox, vdiId: "BP-RT-05", baseDaily: 175, ahtSavedMin: 16, avgRuntimeSec: 100, busRate: 0.10, sysRate: 0.07 },
  { id: "ln-arrs", name: "Arrears Letter Run", proposition: "Loans", queue: "LN-ARRS", tags: ["Letters", "Batch"], Icon: IconLetter, vdiId: "BP-RT-05", baseDaily: 320, ahtSavedMin: 9, avgRuntimeSec: 30, busRate: 0.05, sysRate: 0.08 },
  { id: "ins-ren", name: "Policy Renewal", proposition: "Insurance", queue: "INS-REN", tags: ["Renewals", "Batch"], Icon: IconRefresh, vdiId: "BP-RT-06", baseDaily: 290, ahtSavedMin: 12, avgRuntimeSec: 80, busRate: 0.06, sysRate: 0.05 },
  { id: "ln-pay", name: "Loan Payout Release", proposition: "Loans", queue: "LN-PAY", tags: ["Payments", "Customer-facing"], Icon: IconGlobe, vdiId: "BP-RT-06", baseDaily: 140, ahtSavedMin: 20, avgRuntimeSec: 120, busRate: 0.08, sysRate: 0.06 },
];

export const PROCESSES: ProcessDim[] = PROC_SEEDS.map((p) => ({
  ...p,
  sysW: weights(SYSTEM_EXCEPTIONS.length, 0.3),
  busW: weights(BUSINESS_EXCEPTIONS.length, 0.3),
}));

export const PROCESS_BY_ID = new Map(PROCESSES.map((p) => [p.id, p]));

export const QUEUES = PROCESSES.map((p) => p.queue);
export const TAGS = Array.from(new Set(PROCESSES.flatMap((p) => p.tags))).sort();

// --- digital workers (VDIs / runtime resources) -----------------------------
export interface VdiDim {
  id: string;
  name: string;
  pool: string;
  ratePerHour: number; // licence + infra cost charged per operating hour
}
export const VDIS: VdiDim[] = [
  { id: "BP-RT-01", name: "BP-RT-01", pool: "Lending pool", ratePerHour: 4.2 },
  { id: "BP-RT-02", name: "BP-RT-02", pool: "Onboarding pool", ratePerHour: 4.2 },
  { id: "BP-RT-03", name: "BP-RT-03", pool: "Servicing pool", ratePerHour: 3.8 },
  { id: "BP-RT-04", name: "BP-RT-04", pool: "Servicing pool", ratePerHour: 3.8 },
  { id: "BP-RT-05", name: "BP-RT-05", pool: "Disputes pool", ratePerHour: 4.5 },
  { id: "BP-RT-06", name: "BP-RT-06", pool: "Lending pool", ratePerHour: 4.2 },
];
export const VDI_OPERATING_HOURS = 20; // hours/day a runtime resource is licensed and available

// --- the fact table ---------------------------------------------------------
export interface DayRow {
  date: string; // ISO yyyy-mm-dd
  ts: number; // ms, for range maths
  processId: string;
  completed: number;
  business: number;
  system: number;
}

// 120 days of history ending the day before "today" (2026-06-30 fixed clock).
const TODAY = Date.UTC(2026, 5, 30);
const DAY = 86400000;
// Enough history that the default 90-day window has a full prior 90-day window
// to compare against, so period-over-period deltas stay realistic.
const HISTORY = 220;

function iso(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

const gen = rng(20260630);
function noise(spread: number) {
  return 1 + (gen() - 0.5) * spread;
}

export const ROWS: DayRow[] = (() => {
  const out: DayRow[] = [];
  for (let d = HISTORY; d >= 1; d--) {
    const ts = TODAY - d * DAY;
    const dow = new Date(ts).getUTCDay();
    const weekday = dow === 0 || dow === 6 ? 0.18 : 1; // automation runs light at weekends
    // a gentle upward trend across the window: volumes grow slowly over time
    const trend = 0.9 + (1 - d / HISTORY) * 0.18;
    for (const p of PROCESSES) {
      const vol = Math.round(p.baseDaily * weekday * trend * noise(0.35));
      if (vol <= 0) {
        out.push({ date: iso(ts), ts, processId: p.id, completed: 0, business: 0, system: 0 });
        continue;
      }
      let sysRate = p.sysRate;
      let busRate = p.busRate;
      // a few seeded incidents to make the trends and alerts feel real
      if (p.id === "ln-arrs" && d <= 9 && d >= 3) sysRate *= 3.4; // template-service outage
      if (p.id === "cc-disp" && d <= 26 && d >= 18) busRate *= 2.2; // upstream data quality dip
      if (p.id === "ca-open" && d <= 5) sysRate *= 2.1; // recent login/MFA change
      const system = Math.round(vol * sysRate * noise(0.5));
      const business = Math.round(vol * busRate * noise(0.45));
      const completed = Math.max(0, vol - system - business);
      out.push({ date: iso(ts), ts, processId: p.id, completed, business, system });
    }
  }
  return out;
})();

export const DATE_MIN = ROWS[0].ts;
export const DATE_MAX = ROWS[ROWS.length - 1].ts;

export const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
export const fmtDateFull = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const monthKey = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
