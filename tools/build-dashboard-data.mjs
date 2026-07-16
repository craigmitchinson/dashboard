// ---------------------------------------------------------------------------
// build-dashboard-data.mjs
// ---------------------------------------------------------------------------
// The web twin of the bp-sql-layer pipeline. Reads:
//   data/mock/BPAWorkQueueItem.csv   (or any CSV in the same schema — the swap point)
//   data/reference/reference.json    (team-owned config, twin of core.Ref* tables)
// and emits:
//   public/data/views/vw_*.json      1:1 ports of the report.vw_* SQL views.
//                                    These JSONs ARE the data contract: an API
//                                    over the real warehouse must return these
//                                    exact shapes, and the app won't know the
//                                    difference.
//   public/data/model.json           compact fact + dims the interactive app
//                                    aggregates client-side (slicers need finer
//                                    grain than the pre-aggregated views).
//
// Transform steps mirror the SQL exactly:
//   1. staging typing (05_proc_load_staging.sql): parse dates/numbers, trim,
//      LastUpdatedDate fallback.
//   2. merge derivation (06_proc_merge_fact.sql): Outcome, ExceptionType
//      (explicit prefix -> pattern fallback -> default Business), OutcomeDate.
//   3. HUB & SPOKE COST ENGINE (08_report_views.sql):
//        benefit  = SMV x the GRADE rate in force on the item's outcome date
//                   (date-effective rate card; a pay award never re-values history)
//        cost     = worktime x ( hub £/bot-second  +  spoke infra £/bot-second )
//          hub pool/day    = CoE team run-rate + hub-owned (unassigned) VDIs,
//                            apportioned by worktime across ALL spokes
//          spoke infra/day = the spoke's own live VDIs at class rates in force,
//                            apportioned by worktime WITHIN the spoke
//   4. the report views.
//
// Run: npm run data:build   (optionally: node tools/build-dashboard-data.mjs path/to/export.csv)
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, "data", "mock", "BPAWorkQueueItem.csv");
const REF_PATH = join(root, "data", "reference", "reference.json");
const OUT_DIR = join(root, "public", "data");

const ref = JSON.parse(readFileSync(REF_PATH, "utf8"));

// --- tiny RFC4180 CSV parser -------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- 1. load + staging typing -------------------------------------------------
const DAY = 86400000;
const parseDt = (s) => {
  if (!s || !s.trim()) return null;
  const t = Date.parse(s.trim().replace(" ", "T") + "Z");
  return Number.isNaN(t) ? null : t;
};
const parseIntOrNull = (s) => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
};
const dateOnly = (ts) => new Date(ts).toISOString().slice(0, 10);

const raw = parseCsv(readFileSync(CSV_PATH, "utf8"));
const header = raw[0];
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const need = ["ID", "KeyValue", "Priority", "Status", "Tags", "Resource", "Attempt", "LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate", "CompletedDate", "Worktime", "ExceptionDate", "ExceptionReason", "QueueName"];
for (const n of need) if (!(n in col)) throw new Error(`CSV missing required column: ${n} (schema must match raw.WorkQueueItem)`);

const items = [];
for (let i = 1; i < raw.length; i++) {
  const r = raw[i];
  const g = (name) => (r[col[name]] ?? "").trim();
  const id = g("ID");
  if (!id) continue; // staging drops blank-ID junk rows
  const it = {
    id,
    keyValue: g("KeyValue") || null,
    priority: parseIntOrNull(g("Priority")),
    status: g("Status") || null,
    tags: g("Tags") || null,
    resource: g("Resource") || null,
    attempt: parseIntOrNull(g("Attempt")),
    loaded: parseDt(g("LoadedDate")),
    lastUpdated: parseDt(g("LastUpdatedDate")),
    deferred: parseDt(g("DeferredDate")),
    locked: parseDt(g("LockedDate")),
    completed: parseDt(g("CompletedDate")),
    worktime: parseIntOrNull(g("Worktime")) ?? 0,
    exceptionDate: parseDt(g("ExceptionDate")),
    exceptionReason: g("ExceptionReason") || null,
    queueName: g("QueueName") || null,
  };
  // staging fallback: a row with no LastUpdatedDate takes the most recent
  // meaningful timestamp so change detection still works
  it.lastUpdated = it.lastUpdated ?? it.completed ?? it.exceptionDate ?? it.locked ?? it.loaded;
  items.push(it);
}

// --- 2. merge derivation --------------------------------------------------------
const procById = new Map(ref.processes.map((p) => [p.processId, p]));
const propById = new Map(ref.propositions.map((p) => [p.propositionId, p]));
const spokeById = new Map(ref.spokes.map((s) => [s.spokeId, s]));
const queueMap = new Map(ref.queueMap.map((q) => [q.queueName, q]));
const spokeOfProc = (processId) => {
  const p = procById.get(processId);
  return p ? propById.get(p.propositionId).spokeId : null;
};

// date-effective lookups (the row in force on a date)
const inForce = (history, date) => {
  let best = null;
  for (const h of history) if (h.effectiveFrom <= date && (!best || h.effectiveFrom > best.effectiveFrom)) best = h;
  return best;
};
const gradeRate = (grade, date) => inForce(ref.gradeRates.filter((g) => g.grade === grade), date)?.hourlyCostGBP ?? 0;
const gradeName = (grade) => ref.gradeRates.find((g) => g.grade === grade)?.gradeName ?? grade;

// pattern fallback, ordered exactly as the SQL: Priority DESC, LEN(pattern) DESC
const patterns = [...ref.exceptionPatterns]
  .map((p) => ({ ...p, needle: p.matchPattern.replace(/%/g, "").toLowerCase() }))
  .sort((a, b) => b.priority - a.priority || b.matchPattern.length - a.matchPattern.length);

function classify(reason) {
  if (!reason) return "Business";
  if (/^business exception/i.test(reason)) return "Business"; // 1. explicit prefix
  if (/^system exception/i.test(reason)) return "System";
  const low = reason.toLowerCase();
  for (const p of patterns) if (low.includes(p.needle)) return p.exceptionType; // 2. pattern fallback
  return "Business"; // 3. default
}
const displayReason = (reason) => (reason ?? "").replace(/^(business|system) exception:?\s*/i, "") || "(no reason recorded)";

const unmappedQueues = new Set();
for (const it of items) {
  const qm = queueMap.get(it.queueName);
  if (!qm) unmappedQueues.add(it.queueName);
  it.processId = qm?.processId ?? null;
  it.spokeId = it.processId ? spokeOfProc(it.processId) : null;
  it.stageName = qm?.stageName ?? null;
  it.outcome = it.completed != null ? "Completed" : it.exceptionDate != null ? "Exception" : "Pending";
  it.exceptionType = it.outcome === "Exception" ? classify(it.exceptionReason) : null;
  it.outcomeTs = it.completed ?? it.exceptionDate ?? it.loaded;
  it.outcomeDate = dateOnly(it.outcomeTs);
}
if (unmappedQueues.size) console.warn(`WARNING: unmapped queues (add to reference.json queueMap): ${[...unmappedQueues].join(", ")}`);

// --- 3. hub & spoke cost engine ---------------------------------------------------
let tsMin = Infinity, tsMax = -Infinity;
for (const i of items) {
  const t = Date.parse(i.outcomeDate);
  if (t < tsMin) tsMin = t;
  if (t > tsMax) tsMax = t;
}

const monthLabel = (date) => {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) + "-" + String(d.getUTCFullYear()).slice(2);
};
const monthSortKey = (date) => Number(date.slice(0, 4)) * 100 + Number(date.slice(5, 7));

// per-day worktime totals: whole estate, and per spoke
const dayWt = new Map(); // date -> total bot-seconds
const spokeDayWt = new Map(); // `${spokeId}|${date}` -> bot-seconds
for (const it of items) {
  dayWt.set(it.outcomeDate, (dayWt.get(it.outcomeDate) ?? 0) + it.worktime);
  if (it.spokeId != null) {
    const k = `${it.spokeId}|${it.outcomeDate}`;
    spokeDayWt.set(k, (spokeDayWt.get(k) ?? 0) + it.worktime);
  }
}

// per-day rates: hub pool (team + hub-owned VDIs) and per-spoke infra
const vdiRate = (costClass, date) => inForce(ref.vdiCostHistory.filter((v) => v.costClass === costClass), date)?.annualCostPerVDIGBP ?? 0;
// peopleCostOn: the SOLE source of truth for the hub's people run-rate — see
// D2 in the reference-data schema. estateCostHistory's teamAnnualCostGBP is
// retained for schema parity with bp-sql-layer's core.RefEstateCostHistory
// but is NOT read here; estateCostHistory only supplies
// workingDaysPerYear/productiveHoursPerDay/effectiveFrom/note below.
const peopleCostOn = (ownerId, date) => inForce(ref.peopleCostHistory.filter((p) => p.ownerId === ownerId), date)?.annualCostGBP ?? 0;

// --- D3: VDI renewal / coverage-window algorithm --------------------------------
// Must stay byte-for-byte identical to this algorithm's TS twin in
// src/reference/economics.ts (and its Node-script twin in
// tools/verify-economics.mjs) — duplicated here because a plain Node script
// can't import a .ts module without a build step.
function cycleStart(renewalDateISO, dateISO) {
  const renewalTs = Date.parse(renewalDateISO + "T00:00:00Z");
  const dateTs = Date.parse(dateISO + "T00:00:00Z");
  const cycleIndex = Math.floor((dateTs - renewalTs) / (365 * DAY));
  return renewalTs + cycleIndex * 365 * DAY;
}
function coverageWindow(vdi, cycleStartTs) {
  // half-open [start, end) in ms
  let end = cycleStartTs + 365 * DAY;
  if (vdi.licenseExpiryDate) end = Math.min(end, Date.parse(vdi.licenseExpiryDate + "T00:00:00Z") + DAY); // expiry date is the last covered day
  if (vdi.status === "retired" && vdi.activeTo) end = Math.min(end, Date.parse(vdi.activeTo + "T00:00:00Z") + DAY);
  const start = Math.max(cycleStartTs, Date.parse(vdi.activeFrom + "T00:00:00Z"));
  return { start, end };
}
function vdiDailyCost(vdi, dateISO) {
  const dateTs = Date.parse(dateISO + "T00:00:00Z");
  const cs = cycleStart(vdi.renewalDate, dateISO);
  const { start, end } = coverageWindow(vdi, cs);
  if (dateTs < start || dateTs >= end) return 0; // zero cost AND zero capacity that day
  const windowDays = Math.round((end - start) / DAY);
  const annual = vdi.annualCostGBP ?? vdiRate(vdi.costClass, dateOnly(cs));
  return windowDays > 0 ? annual / windowDays : 0;
}

const rateByDate = new Map(); // date -> { team, hubInfra(annualized), hubPerDay, hubCPS, wd, ph, spokes: Map<spokeId, {infraAnnual, perDay, cps}> }
for (let ts = tsMin; ts <= tsMax; ts += DAY) {
  const date = dateOnly(ts);
  const teamAnnual = peopleCostOn("HUB", date);
  const est = inForce(ref.estateCostHistory, date); // workingDaysPerYear / productiveHoursPerDay only
  let hubInfraPerDay = 0;
  const spokes = new Map();
  for (const s of ref.spokes) spokes.set(s.spokeId, { infraAnnual: 0, perDay: 0, cps: 0 });
  for (const r of ref.resources) {
    const cost = vdiDailyCost(r, date); // hubInfraPerDay/spokeInfraPerDay = Σ vdiDailyCost over the relevant resources
    if (r.spokeId == null) hubInfraPerDay += cost;
    else spokes.get(r.spokeId).perDay += cost;
  }
  const hubPerDay = teamAnnual / 365.25 + hubInfraPerDay;
  const totalWt = dayWt.get(date) ?? 0;
  for (const [sid, s] of spokes) {
    s.infraAnnual = s.perDay * 365.25; // annualized estimate, for reporting only
    const swt = spokeDayWt.get(`${sid}|${date}`) ?? 0;
    s.cps = swt ? s.perDay / swt : 0;
  }
  rateByDate.set(date, {
    team: teamAnnual,
    hubInfra: hubInfraPerDay * 365.25, // annualized estimate, for reporting only
    hubPerDay,
    hubCPS: totalWt ? hubPerDay / totalWt : 0,
    wd: est.workingDaysPerYear,
    ph: est.productiveHoursPerDay,
    spokes,
  });
}

// per-item benefit (grade rate in force on outcome date) and apportioned cost
for (const it of items) {
  const p = it.processId ? procById.get(it.processId) : null;
  const rd = rateByDate.get(it.outcomeDate);
  it.hourlyRate = p ? gradeRate(p.grade, it.outcomeDate) : 0;
  it.benefitGBP = p && it.outcome === "Completed" ? (p.smvMinutes * it.hourlyRate) / 60 : 0;
  it.reworkGBP = p && it.outcome === "Exception" ? (p.smvMinutes * it.hourlyRate) / 60 : 0;
  const spokeCPS = it.spokeId != null ? rd.spokes.get(it.spokeId)?.cps ?? 0 : 0;
  it.estateCostGBP = it.worktime * (rd.hubCPS + spokeCPS);
  it.fte = p && it.outcome === "Completed" ? p.smvMinutes / (rd.wd * rd.ph * 60) : 0;
}

// --- 4. the report views ------------------------------------------------------------
const round = (n, dp = 2) => (n == null ? null : Number(n.toFixed(dp)));
const groupBy = (arr, keyFn) => {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    let g = m.get(k);
    if (!g) m.set(k, (g = []));
    g.push(x);
  }
  return m;
};
const procName = (id) => procById.get(id)?.processName ?? null;
const propNameOf = (id) => {
  const p = procById.get(id);
  return p ? propById.get(p.propositionId).propositionName : null;
};
const spokeNameOf = (id) => {
  const sid = id != null ? spokeOfProc(id) : null;
  return sid != null ? spokeById.get(sid).spokeName : null;
};

const views = {};

views.vw_DimSpoke = ref.spokes.map((s) => ({ SpokeId: s.spokeId, SpokeName: s.spokeName, ShortName: s.shortName, ColorHexLight: s.colorLight, ColorHexDark: s.colorDark }));

views.vw_DimGradeRate = ref.gradeRates.map((g) => ({
  Grade: g.grade,
  GradeName: g.gradeName,
  EffectiveFrom: g.effectiveFrom,
  HourlyCostGBP: g.hourlyCostGBP,
}));

views.vw_DimProcess = ref.processes.map((p) => {
  const prop = propById.get(p.propositionId);
  const spoke = spokeById.get(prop.spokeId);
  return {
    ProcessId: p.processId,
    ProcessName: p.processName,
    ProcessAcronym: p.processAcronym,
    ProcessDescription: p.processDescription,
    IsActive: p.isActive ? 1 : 0,
    PropositionId: p.propositionId,
    PropositionName: prop.propositionName,
    SpokeId: prop.spokeId,
    SpokeName: spoke.spokeName,
    SMVMinutes: p.smvMinutes,
    Grade: p.grade,
    GradeName: gradeName(p.grade),
    CurrentHourlyRateGBP: gradeRate(p.grade, dateOnly(tsMax)),
  };
});

views.vw_DimResource = ref.resources.map((r) => ({
  ResourceName: r.resourceName,
  BotName: r.botName,
  BotAcronym: r.botAcronym,
  VDIName: r.vdiName,
  CostClass: r.costClass,
  SpokeId: r.spokeId,
  SpokeName: r.spokeId != null ? spokeById.get(r.spokeId).spokeName : "Hub",
  ActiveFrom: r.activeFrom,
  ActiveTo: r.activeTo,
  Notes: r.notes,
  IsActive: r.isActive ? 1 : 0,
}));

views.vw_EstateRateByDate = [...rateByDate.entries()].map(([date, r]) => {
  let spokeInfra = 0;
  for (const s of r.spokes.values()) spokeInfra += s.infraAnnual;
  return {
    DateKey: Number(date.replaceAll("-", "")),
    Date: date,
    TeamAnnualCostGBP: r.team,
    HubInfraAnnualGBP: r.hubInfra,
    SpokeInfraAnnualGBP: spokeInfra,
    WorkingDaysPerYear: r.wd,
    ProductiveHoursPerDay: r.ph,
    EstateCostPerDayGBP: round((r.team + r.hubInfra + spokeInfra) / 365.25, 4),
  };
});

views.vw_SpokeRateByDate = [...rateByDate.entries()].flatMap(([date, r]) =>
  [...r.spokes.entries()].map(([sid, s]) => ({
    DateKey: Number(date.replaceAll("-", "")),
    Date: date,
    SpokeId: sid,
    SpokeName: spokeById.get(sid).spokeName,
    InfraAnnualGBP: s.infraAnnual,
    InfraCostPerDayGBP: round(s.perDay, 4),
  })),
);

views.vw_DailyOutcomes = [...groupBy(items, (i) => `${i.outcomeDate}|${i.processId}|${i.outcome}|${i.exceptionType ?? ""}`).values()].map((g) => ({
  OutcomeDateKey: Number(g[0].outcomeDate.replaceAll("-", "")),
  Date: g[0].outcomeDate,
  MonthLabel: monthLabel(g[0].outcomeDate),
  MonthSortKey: monthSortKey(g[0].outcomeDate),
  SpokeName: spokeNameOf(g[0].processId),
  ProcessName: procName(g[0].processId),
  PropositionName: propNameOf(g[0].processId),
  Outcome: g[0].outcome,
  ExceptionType: g[0].exceptionType,
  ItemCount: g.length,
  TotalWorktimeSec: g.reduce((s, i) => s + i.worktime, 0),
  AvgWorktimeSec: round(g.reduce((s, i) => s + i.worktime, 0) / g.length, 1),
})).sort((a, b) => a.OutcomeDateKey - b.OutcomeDateKey);

views.vw_MonthlyOutcomes = [...groupBy(items, (i) => `${monthSortKey(i.outcomeDate)}|${i.processId}`).values()].map((g) => {
  const completed = g.filter((i) => i.outcome === "Completed").length;
  const exceptions = g.filter((i) => i.outcome === "Exception").length;
  return {
    MonthLabel: monthLabel(g[0].outcomeDate),
    MonthSortKey: monthSortKey(g[0].outcomeDate),
    SpokeName: spokeNameOf(g[0].processId),
    ProcessName: procName(g[0].processId),
    PropositionName: propNameOf(g[0].processId),
    Completed: completed,
    Exceptions: exceptions,
    BusinessExc: g.filter((i) => i.exceptionType === "Business").length,
    SystemExc: g.filter((i) => i.exceptionType === "System").length,
    TotalItems: g.length,
    CompletionPct: round((100 * completed) / g.length, 1),
    ExceptionPct: round((100 * exceptions) / g.length, 1),
  };
}).sort((a, b) => a.MonthSortKey - b.MonthSortKey);

const excItems = items.filter((i) => i.outcome === "Exception");
{
  const totalExc = excItems.length || 1;
  views.vw_ExceptionDetail = [...groupBy(excItems, (i) => `${i.processId}|${i.exceptionType}|${i.exceptionReason}`).values()].map((g) => ({
    SpokeName: spokeNameOf(g[0].processId),
    PropositionName: propNameOf(g[0].processId),
    ProcessName: procName(g[0].processId),
    ExceptionType: g[0].exceptionType,
    ExceptionReason: g[0].exceptionReason,
    Volume: g.length,
    AvgTimeToFailSec: round(g.reduce((s, i) => s + i.worktime, 0) / g.length, 1),
    TotalTimeToFailSec: g.reduce((s, i) => s + i.worktime, 0),
    PctOfAllExceptions: round((100 * g.length) / totalExc, 2),
  })).sort((a, b) => b.Volume - a.Volume);
}

views.vw_ExceptionCost = [...groupBy(excItems.filter((i) => i.processId), (i) => `${i.processId}|${i.exceptionType}`).values()].map((g) => {
  const wasted = g.reduce((s, i) => s + i.worktime, 0);
  return {
    SpokeName: spokeNameOf(g[0].processId),
    PropositionName: propNameOf(g[0].processId),
    ProcessName: procName(g[0].processId),
    ExceptionType: g[0].exceptionType,
    ExceptionCount: g.length,
    WastedBotSeconds: wasted,
    WastedBotHours: round(wasted / 3600, 2),
    ReworkCostGBP: round(g.reduce((s, i) => s + i.reworkGBP, 0), 2),
  };
}).sort((a, b) => b.ReworkCostGBP - a.ReworkCostGBP);

views.vw_ResourceUtil = [...groupBy(items.filter((i) => i.resource), (i) => i.resource).values()].map((g) => {
  const r = ref.resources.find((x) => x.resourceName === g[0].resource);
  const exc = g.filter((i) => i.outcome === "Exception").length;
  return {
    ResourceName: g[0].resource,
    BotName: r?.botName ?? null,
    VDIName: r?.vdiName ?? null,
    SpokeName: r?.spokeId != null ? spokeById.get(r.spokeId).spokeName : "Hub",
    ItemsProcessed: g.length,
    ProductiveSeconds: g.reduce((s, i) => s + i.worktime, 0),
    Exceptions: exc,
    ExceptionRatePct: round((100 * exc) / g.length, 1),
  };
}).sort((a, b) => b.ItemsProcessed - a.ItemsProcessed);

function commercialRow(g) {
  const completed = g.filter((i) => i.outcome === "Completed");
  const cases = new Set(completed.map((i) => i.keyValue)).size;
  let gross = 0, fte = 0, cost = 0;
  for (const i of g) { gross += i.benefitGBP; fte += i.fte; cost += i.estateCostGBP; }
  return { tasks: completed.length, cases, gross, fte, cost };
}

views.vw_Commercial = [...groupBy(items.filter((i) => i.processId), (i) => i.processId).values()].map((g) => {
  const c = commercialRow(g);
  return {
    SpokeName: spokeNameOf(g[0].processId),
    PropositionName: propNameOf(g[0].processId),
    ProcessName: procName(g[0].processId),
    CompletedTasks: c.tasks,
    CompletedCases: c.cases,
    GrossBenefitGBP: round(c.gross),
    FTEEquivalentSaved: round(c.fte),
    ApportionedEstateCostGBP: round(c.cost),
    CostPerCompletedTaskGBP: c.tasks ? round(c.cost / c.tasks) : null,
    CostPerCompletedCaseGBP: c.cases ? round(c.cost / c.cases) : null,
    NetBenefitGBP: round(c.gross - c.cost),
  };
}).sort((a, b) => b.GrossBenefitGBP - a.GrossBenefitGBP);

views.vw_CommercialBySpoke = [...groupBy(items.filter((i) => i.spokeId != null), (i) => i.spokeId).values()].map((g) => {
  const c = commercialRow(g);
  return {
    SpokeId: g[0].spokeId,
    SpokeName: spokeById.get(g[0].spokeId).spokeName,
    CompletedTasks: c.tasks,
    CompletedCases: c.cases,
    GrossBenefitGBP: round(c.gross),
    FTEEquivalentSaved: round(c.fte),
    ApportionedEstateCostGBP: round(c.cost),
    CostPerCompletedTaskGBP: c.tasks ? round(c.cost / c.tasks) : null,
    NetBenefitGBP: round(c.gross - c.cost),
  };
}).sort((a, b) => b.GrossBenefitGBP - a.GrossBenefitGBP);

{
  const monthly = [...groupBy(items.filter((i) => i.processId), (i) => monthSortKey(i.outcomeDate)).entries()]
    .map(([k, g]) => ({ k, label: monthLabel(g[0].outcomeDate), year: Number(String(k).slice(0, 4)), ...commercialRow(g) }))
    .sort((a, b) => a.k - b.k);
  let ytdG = 0, ytdN = 0, ytdT = 0, allG = 0, allN = 0, allT = 0, curYear = null;
  views.vw_CommercialMonthly = monthly.map((m) => {
    if (m.year !== curYear) { curYear = m.year; ytdG = ytdN = ytdT = 0; }
    ytdG += m.gross; ytdN += m.gross - m.cost; ytdT += m.tasks;
    allG += m.gross; allN += m.gross - m.cost; allT += m.tasks;
    return {
      Year: m.year,
      MonthLabel: m.label,
      MonthSortKey: m.k,
      CompletedTasks: m.tasks,
      CompletedCases: m.cases,
      GrossBenefitGBP: round(m.gross),
      EstateCostGBP: round(m.cost),
      NetBenefitGBP: round(m.gross - m.cost),
      YTDGrossBenefitGBP: round(ytdG),
      YTDNetBenefitGBP: round(ytdN),
      YTDCompletedTasks: ytdT,
      AllTimeGrossBenefitGBP: round(allG),
      AllTimeNetBenefitGBP: round(allN),
      AllTimeCompletedTasks: allT,
    };
  });
}

{
  const c = commercialRow(items.filter((i) => i.processId));
  views.vw_CommercialOverall = [{
    TotalCompletedTasks: c.tasks,
    TotalCompletedCases: c.cases,
    OverallGrossBenefitGBP: round(c.gross),
    OverallEstateCostGBP: round(c.cost),
    OverallNetBenefitGBP: round(c.gross - c.cost),
    BlendedCostPerTaskGBP: round(c.cost / c.tasks),
    BlendedCostPerCaseGBP: round(c.cost / c.cases),
  }];
}

{
  const mapped = items.filter((i) => i.processId);
  const completed = mapped.filter((i) => i.outcome === "Completed");
  const c = commercialRow(mapped);
  views.vw_KPIHeadline = [{
    TotalCompleted: completed.length,
    TotalExceptions: mapped.filter((i) => i.outcome === "Exception").length,
    BusinessExceptions: mapped.filter((i) => i.exceptionType === "Business").length,
    SystemExceptions: mapped.filter((i) => i.exceptionType === "System").length,
    CompletionPct: round((100 * completed.length) / mapped.length, 1),
    ColleagueHoursSaved: round(completed.reduce((s, i) => s + procById.get(i.processId).smvMinutes, 0) / 60, 1),
    GrossBenefitGBP: round(c.gross),
    FTEEquivalentSaved: round(c.fte, 1),
    EstateCostGBP: round(c.cost),
    NetBenefitGBP: round(c.gross - c.cost),
  }];
}

// --- 5. compact model for the interactive app ---------------------------------------
// gb / ec are precomputed per group so the client never needs the rate tables:
// summing them over any slice gives the same answer the SQL views produce.
const dayRows = [...groupBy(items.filter((i) => i.processId), (i) => `${i.outcomeDate}|${i.processId}`).values()].map((g) => {
  const completed = g.filter((i) => i.outcome === "Completed");
  return {
    d: g[0].outcomeDate,
    p: g[0].processId,
    c: completed.length,
    b: g.filter((i) => i.exceptionType === "Business").length,
    s: g.filter((i) => i.exceptionType === "System").length,
    n: g.filter((i) => i.outcome === "Pending").length,
    w: g.reduce((s, i) => s + i.worktime, 0),
    cw: completed.reduce((s, i) => s + i.worktime, 0),
    gb: round(g.reduce((s, i) => s + i.benefitGBP, 0), 4),
    ec: round(g.reduce((s, i) => s + i.estateCostGBP, 0), 4),
  };
}).sort((a, b) => (a.d < b.d ? -1 : 1));

const excRows = [...groupBy(excItems.filter((i) => i.processId), (i) => `${i.outcomeDate}|${i.processId}|${i.exceptionReason}`).values()].map((g) => ({
  d: g[0].outcomeDate,
  p: g[0].processId,
  r: displayReason(g[0].exceptionReason),
  t: g[0].exceptionType,
  n: g.length,
  w: g.reduce((s, i) => s + i.worktime, 0),
})).sort((a, b) => (a.d < b.d ? -1 : 1));

const resRows = [...groupBy(items.filter((i) => i.resource && i.processId), (i) => `${i.outcomeDate}|${i.resource}|${i.processId}`).values()].map((g) => ({
  d: g[0].outcomeDate,
  r: g[0].resource,
  p: g[0].processId,
  n: g.length,
  e: g.filter((i) => i.outcome === "Exception").length,
  w: g.reduce((s, i) => s + i.worktime, 0),
  ec: round(g.reduce((s, i) => s + i.estateCostGBP, 0), 4),
})).sort((a, b) => (a.d < b.d ? -1 : 1));

const reasonSet = new Map();
for (const e of excItems) {
  const r = displayReason(e.exceptionReason);
  if (!reasonSet.has(r)) reasonSet.set(r, { reason: r, type: e.exceptionType, code: ref.exceptionDisplayCodes[r] ?? r.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase() });
}

// True per-day worktime totals across ALL items (including unmapped-queue
// items, which model.dayRows excludes) — the client economics engine's hub
// share denominator must match this, not a recomputation from dayRows alone,
// or unmapped-queue worktime silently inflates every mapped item's cost.
// See src/reference/economics.ts buildRateTables and tools/verify-economics.mjs.
const dayWorktimeTotals = Object.fromEntries(dayWt);
const spokeDayWorktimeTotals = Object.fromEntries(
  [...spokeDayWt.entries()].map(([k, w]) => {
    const [sid, date] = k.split("|");
    return [`${spokeById.get(Number(sid)).spokeName}|${date}`, w];
  }),
);

const model = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: relative(root, CSV_PATH).replaceAll("\\", "/"),
    sourceRows: items.length,
    dateMin: dateOnly(tsMin),
    dateMax: dateOnly(tsMax),
    unmappedQueues: [...unmappedQueues],
  },
  targets: ref.targets,
  vdiOperatingHoursPerDay: ref.vdiOperatingHoursPerDay,
  spokes: ref.spokes.map((s) => ({ id: s.spokeId, name: s.spokeName, short: s.shortName, colorLight: s.colorLight, colorDark: s.colorDark })),
  propositions: ref.propositions.map((p) => ({ name: p.propositionName, spoke: spokeById.get(p.spokeId).spokeName })),
  processes: ref.processes.map((p) => {
    const prop = propById.get(p.propositionId);
    const spoke = spokeById.get(prop.spokeId);
    return {
      id: p.processId,
      name: p.processName,
      acronym: p.processAcronym,
      description: p.processDescription,
      proposition: prop.propositionName,
      spoke: spoke.spokeName,
      queues: ref.queueMap.filter((q) => q.processId === p.processId).map((q) => ({ queue: q.queueName, stage: q.stageName, order: q.stageOrder })),
      smvMinutes: p.smvMinutes,
      grade: p.grade,
      gradeName: gradeName(p.grade),
      currentHourly: gradeRate(p.grade, dateOnly(tsMax)),
      icon: p.icon,
      tags: p.tags,
    };
  }),
  resources: ref.resources.map((r) => ({
    name: r.resourceName,
    bot: r.botName,
    acronym: r.botAcronym,
    vdi: r.vdiName,
    class: r.costClass,
    spoke: r.spokeId != null ? spokeById.get(r.spokeId).spokeName : "Hub",
    activeFrom: r.activeFrom,
    activeTo: r.activeTo,
    notes: r.notes,
    renewalDate: r.renewalDate,
    annualCostGBP: r.annualCostGBP ?? null,
    licenseExpiryDate: r.licenseExpiryDate ?? null,
    status: r.status,
  })),
  exceptionReasons: [...reasonSet.values()].sort((a, b) => (a.type === b.type ? a.reason.localeCompare(b.reason) : a.type === "System" ? -1 : 1)),
  estateRateByDate: [...rateByDate.entries()].map(([date, r]) => {
    let spokeInfra = 0;
    for (const s of r.spokes.values()) spokeInfra += s.infraAnnual;
    return { d: date, cost: round((r.team + r.hubInfra + spokeInfra) / 365.25, 4), wd: r.wd, ph: r.ph };
  }),
  dayRows,
  excRows,
  resRows,
  dayWorktimeTotals,
  spokeDayWorktimeTotals,
  // Full base reference object (unmodified data/reference/reference.json) so
  // the client can overlay browser-side edits onto it — see src/reference/.
  reference: ref,
};

// --- write ---------------------------------------------------------------------------
mkdirSync(join(OUT_DIR, "views"), { recursive: true });
for (const [name, data] of Object.entries(views)) {
  writeFileSync(join(OUT_DIR, "views", `${name}.json`), JSON.stringify(data), "utf8");
}
writeFileSync(join(OUT_DIR, "model.json"), JSON.stringify(model), "utf8");
writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify({
  generatedAt: model.meta.generatedAt,
  source: model.meta.source,
  sourceRows: model.meta.sourceRows,
  window: [model.meta.dateMin, model.meta.dateMax],
  views: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.length])),
}, null, 2), "utf8");

const kpi = views.vw_KPIHeadline[0];
console.log(`source: ${model.meta.source} (${items.length} items, ${model.meta.dateMin} .. ${model.meta.dateMax})`);
console.log(`views written to public/data/views/ | model.json ${(statSync(join(OUT_DIR, "model.json")).size / 1024 / 1024).toFixed(1)}MB`);
console.log(`KPI check — completed: ${kpi.TotalCompleted}, exceptions: ${kpi.TotalExceptions} (B ${kpi.BusinessExceptions} / S ${kpi.SystemExceptions}), completion ${kpi.CompletionPct}%`);
console.log(`           gross £${kpi.GrossBenefitGBP.toLocaleString()}, estate £${kpi.EstateCostGBP.toLocaleString()}, net £${kpi.NetBenefitGBP.toLocaleString()}, FTE ${kpi.FTEEquivalentSaved}`);
for (const s of views.vw_CommercialBySpoke) {
  console.log(`           ${s.SpokeName}: gross £${s.GrossBenefitGBP.toLocaleString()}, cost £${s.ApportionedEstateCostGBP.toLocaleString()}, net £${s.NetBenefitGBP.toLocaleString()}`);
}
if (model.meta.unmappedQueues.length) console.warn(`UNMAPPED QUEUES: ${model.meta.unmappedQueues.join(", ")}`);
console.log(`run 'npm run data:verify' to confirm the client economics engine reproduces this model's baked benefit/cost totals`);
