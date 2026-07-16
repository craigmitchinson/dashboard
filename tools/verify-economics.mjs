// ---------------------------------------------------------------------------
// verify-economics.mjs
// ---------------------------------------------------------------------------
// Loads public/data/model.json and re-implements the SAME per-day pool-
// composition + per-row benefit/cost math as the client economics engine
// (src/reference/economics.ts), run against the UNEDITED model.reference
// embedded in model.json. Proves the client engine's math reproduces the
// pipeline's baked totals when reference is untouched.
//
// This is a duplicate, plain-JS re-implementation (same reasoning as
// build-dashboard-data.mjs: importing a .ts module from a plain Node script
// isn't worth the build-step complexity here) — the D3 VDI coverage-window
// algorithm below must stay byte-for-byte identical to its twins in
// src/reference/economics.ts and tools/build-dashboard-data.mjs.
//
// Run: npm run data:verify
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_PATH = join(root, "public", "data", "model.json");

const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
const ref = model.reference;
if (!ref) {
  console.error("model.json has no embedded `reference` field — run `npm run data:build` first.");
  process.exit(1);
}

const DAY = 86400000;
const dateOnly = (ts) => new Date(ts).toISOString().slice(0, 10);

// date-effective lookup (latest effectiveFrom <= date wins) — same semantics
// as build-dashboard-data.mjs's inForce / economics.ts's inForce.
const inForce = (history, date) => {
  let best = null;
  for (const h of history) if (h.effectiveFrom <= date && (!best || h.effectiveFrom > best.effectiveFrom)) best = h;
  return best;
};
const gradeRate = (grade, date) => inForce(ref.gradeRates.filter((g) => g.grade === grade), date)?.hourlyCostGBP ?? 0;
const vdiRate = (costClass, date) => inForce(ref.vdiCostHistory.filter((v) => v.costClass === costClass), date)?.annualCostPerVDIGBP ?? 0;
const peopleCostOn = (ownerId, date) => inForce(ref.peopleCostHistory.filter((p) => p.ownerId === ownerId), date)?.annualCostGBP ?? 0;

// --- D3: VDI renewal / coverage-window algorithm (byte-for-byte identical to
// the TS/mjs twins) ---
function cycleStart(renewalDateISO, dateISO) {
  const renewalTs = Date.parse(renewalDateISO + "T00:00:00Z");
  const dateTs = Date.parse(dateISO + "T00:00:00Z");
  const cycleIndex = Math.floor((dateTs - renewalTs) / (365 * DAY));
  return renewalTs + cycleIndex * 365 * DAY;
}
function coverageWindow(vdi, cycleStartTs) {
  let end = cycleStartTs + 365 * DAY;
  if (vdi.licenseExpiryDate) end = Math.min(end, Date.parse(vdi.licenseExpiryDate + "T00:00:00Z") + DAY);
  if (vdi.status === "retired" && vdi.activeTo) end = Math.min(end, Date.parse(vdi.activeTo + "T00:00:00Z") + DAY);
  const start = Math.max(cycleStartTs, Date.parse(vdi.activeFrom + "T00:00:00Z"));
  return { start, end };
}
function vdiDailyCost(vdi, dateISO) {
  const dateTs = Date.parse(dateISO + "T00:00:00Z");
  const cs = cycleStart(vdi.renewalDate, dateISO);
  const { start, end } = coverageWindow(vdi, cs);
  if (dateTs < start || dateTs >= end) return 0;
  const windowDays = Math.round((end - start) / DAY);
  const annual = vdi.annualCostGBP ?? vdiRate(vdi.costClass, dateOnly(cs));
  return windowDays > 0 ? annual / windowDays : 0;
}

// --- per-day worktime totals (whole estate, and per spoke). Prefer the true
// totals baked into model.json (dayWorktimeTotals/spokeDayWorktimeTotals,
// built from ALL items including unmapped queues) so this check exercises
// the SAME totals src/reference/economics.ts's buildRateTables now reads —
// not a recomputation from dayRows alone, which would silently under-count
// when unmapped queues carry worktime and make this check self-referential
// (comparing two wrong numbers that happen to agree) instead of a real
// parity check. Falls back to the old dayRows-based recompute only for an
// older model.json that predates these fields. ---
const procMeta = new Map(model.processes.map((p) => [String(p.id), { grade: p.grade, smvMinutes: p.smvMinutes, spoke: p.spoke }]));
const spokeIdByName = new Map(ref.spokes.map((s) => [s.spokeName, s.spokeId]));

let dayWt, spokeDayWt;
if (model.dayWorktimeTotals && model.spokeDayWorktimeTotals) {
  dayWt = new Map(Object.entries(model.dayWorktimeTotals));
  spokeDayWt = new Map(Object.entries(model.spokeDayWorktimeTotals));
} else {
  dayWt = new Map();
  spokeDayWt = new Map();
  for (const r of model.dayRows) {
    dayWt.set(r.d, (dayWt.get(r.d) ?? 0) + r.w);
    const meta = procMeta.get(String(r.p));
    if (meta) {
      const k = `${meta.spoke}|${r.d}`;
      spokeDayWt.set(k, (spokeDayWt.get(k) ?? 0) + r.w);
    }
  }
}

// --- per-day rates: hub pool + per-spoke infra, D3-based ---
const tsMin = Date.parse(model.meta.dateMin + "T00:00:00Z");
const tsMax = Date.parse(model.meta.dateMax + "T00:00:00Z");
const rateByDate = new Map();
for (let ts = tsMin; ts <= tsMax; ts += DAY) {
  const date = dateOnly(ts);
  const teamAnnual = peopleCostOn("HUB", date);
  let hubInfraPerDay = 0;
  const spokes = new Map();
  for (const s of ref.spokes) spokes.set(s.spokeId, { perDay: 0, cps: 0 });
  for (const r of ref.resources) {
    const cost = vdiDailyCost(r, date);
    if (r.spokeId == null) hubInfraPerDay += cost;
    else spokes.get(r.spokeId).perDay += cost;
  }
  const hubPerDay = teamAnnual / 365.25 + hubInfraPerDay;
  const totalWt = dayWt.get(date) ?? 0;
  for (const [sid, s] of spokes) {
    const spokeName = ref.spokes.find((sp) => sp.spokeId === sid)?.spokeName;
    const swt = spokeName ? spokeDayWt.get(`${spokeName}|${date}`) ?? 0 : 0;
    s.cps = swt ? s.perDay / swt : 0;
  }
  rateByDate.set(date, {
    hubPerDay,
    hubCPS: totalWt ? hubPerDay / totalWt : 0,
    spokes,
  });
}

// --- recompute benefit/cost per dayRow, sum, compare to baked gb/ec ---
let recomputedBenefit = 0;
let recomputedCost = 0;
let bakedBenefit = 0;
let bakedCost = 0;

for (const r of model.dayRows) {
  const meta = procMeta.get(String(r.p));
  if (!meta) continue;
  const rd = rateByDate.get(r.d);
  const hours = (r.c * meta.smvMinutes) / 60;
  const benefit = hours * gradeRate(meta.grade, r.d);
  const spokeId = spokeIdByName.get(meta.spoke);
  const spokeCPS = spokeId != null ? rd.spokes.get(spokeId)?.cps ?? 0 : 0;
  const cost = r.w * (rd.hubCPS + spokeCPS);
  recomputedBenefit += benefit;
  recomputedCost += cost;
  bakedBenefit += r.gb;
  bakedCost += r.ec;
}

// D4: the zero-worktime unattributed pool cost is intentionally EXCLUDED from
// this comparison — the baked model.json's dayRows/gb/ec never included it
// either (items only exist where there's activity), so this is the correct
// apples-to-apples check.

function pctDiff(a, b) {
  const denom = Math.abs(b) || 1;
  return (Math.abs(a - b) / denom) * 100;
}

const benefitDiffPct = pctDiff(recomputedBenefit, bakedBenefit);
const costDiffPct = pctDiff(recomputedCost, bakedCost);
const THRESHOLD_PCT = 0.5;

const ok = benefitDiffPct <= THRESHOLD_PCT && costDiffPct <= THRESHOLD_PCT;

function fmt(n) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

if (!ok) {
  console.error("PARITY FAILED — client economics engine does not reproduce the pipeline-baked totals within 0.5%.\n");
  console.error("metric          | baked          | recomputed     | abs diff       | % diff");
  console.error("----------------|----------------|----------------|----------------|--------");
  console.error(`benefit (gb)    | ${fmt(bakedBenefit).padEnd(14)} | ${fmt(recomputedBenefit).padEnd(14)} | ${fmt(Math.abs(recomputedBenefit - bakedBenefit)).padEnd(14)} | ${benefitDiffPct.toFixed(3)}%`);
  console.error(`estate cost (ec)| ${fmt(bakedCost).padEnd(14)} | ${fmt(recomputedCost).padEnd(14)} | ${fmt(Math.abs(recomputedCost - bakedCost)).padEnd(14)} | ${costDiffPct.toFixed(3)}%`);
  process.exit(1);
}

console.log(`benefit:     baked £${fmt(bakedBenefit)} vs recomputed £${fmt(recomputedBenefit)} (${benefitDiffPct.toFixed(4)}% diff)`);
console.log(`estate cost: baked £${fmt(bakedCost)} vs recomputed £${fmt(recomputedCost)} (${costDiffPct.toFixed(4)}% diff)`);
console.log("PARITY OK");
process.exit(0);
