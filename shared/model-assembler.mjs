// ---------------------------------------------------------------------------
// shared/model-assembler.mjs
// ---------------------------------------------------------------------------
// ONE source of truth for turning "rowsets" (plain-object arrays shaped like
// SQL view output, or their JSON-fixture twins) into the exact ModelJson
// shape the SPA consumes (see src/rpaData.ts's ModelJson interface).
//
// Used by BOTH:
//   - tools/build-dashboard-data.mjs   (CSV + reference.json -> model.json)
//   - server/src/data/*.ts             (SQL Server, or the fixture JSON
//                                        ports under public/data/views/, ->
//                                        the same ModelJson over HTTP)
// so the static build and the live API can never quietly diverge — a bug
// fixed here is fixed in both places at once.
//
// CONTRACT (see server/README.md and the parent task's final report for the
// full rationale). `rowsets` is a plain object of arrays (or, for `meta`, a
// single row object) shaped as follows. Where a NEW SQL view exists
// (bp-sql-layer/scripts/13_api_model_views.sql) its output columns ARE the
// row shape verbatim; where no new view was warranted (spokes/propositions/
// processes/resources/estateRateByDate — these are dimension/rate-table
// echoes, not new fact aggregations) the shape mirrors the EXISTING view
// JSON ports under public/data/views/ (vw_DimSpoke.json etc.), extended
// with a small number of additional columns those existing views don't
// expose (documented per-key below) which the caller must attach itself
// (from core.RefProcess / core.RefResource directly, or from reference.*
// in fixture/build mode).
//
//   reference             the FULL ReferenceJson (JSON-only sections come
//                         from core.RefAppSettings in DB mode, or
//                         data/reference/reference.json directly in fixture
//                         mode) — becomes model.reference verbatim, and is
//                         also the source this module reads grade rates /
//                         grade names / exceptionDisplayCodes /
//                         vdiOperatingHoursPerDay / targets from.
//
//   spokes[]              vw_DimSpoke shape: SpokeId, SpokeName, ShortName,
//                         ColorHexLight, ColorHexDark.
//
//   propositions[]        PropositionId, PropositionName, SpokeId, SpokeName.
//
//   processes[]           vw_DimProcess shape (ProcessId, ProcessName,
//                         ProcessAcronym, ProcessDescription, PropositionName,
//                         SpokeId, SpokeName, SMVMinutes, Grade) PLUS three
//                         columns vw_DimProcess does not carry: Icon (string),
//                         Tags (string[]), Queues ({queue,stage,order}[]) —
//                         attach these from core.RefProcess/core.RefQueueMap
//                         (DB mode) or reference.processes/queueMap (fixture/
//                         build mode). GradeName/currentHourly are DERIVED
//                         here (from reference.gradeRates/grades, resolved at
//                         meta.DateMax) — any GradeName/CurrentHourlyRateGBP
//                         column on the input row is ignored, so a caller
//                         reusing vw_DimProcess's TODAY-dated
//                         CurrentHourlyRateGBP verbatim still gets the
//                         correct AS-OF-DATASET value.
//
//   resources[]            vw_DimResource shape (ResourceName, BotName,
//                         BotAcronym, VDIName, CostClass, SpokeId, SpokeName,
//                         ActiveFrom, ActiveTo, Notes) PLUS four columns
//                         vw_DimResource does not carry: RenewalDate,
//                         AnnualCostGBP, LicenseExpiryDate, Status — attach
//                         from core.RefResource directly (DB mode) or
//                         reference.resources (fixture/build mode).
//
//   exceptionReasons[]     vw_ModelExceptionReasons shape: Reason,
//                         ExceptionType. `code` is DERIVED here from
//                         reference.exceptionDisplayCodes, falling back to
//                         an auto-generated 3-letter initialism — never pass
//                         a pre-computed code, it will be ignored.
//
//   estateRateByDate[]     vw_EstateRateByDate shape: Date (or DateKey),
//                         EstateCostPerDayGBP (UNROUNDED — this module
//                         rounds to 4dp itself, matching the historical
//                         build script), WorkingDaysPerYear,
//                         ProductiveHoursPerDay.
//
//   dayRows[]              vw_ModelDayRows shape: d, p, c, b, s, n, w, cw,
//                         gb, ec — already the exact final row shape;
//                         passed through (re-sorted defensively by d).
//   excRows[]              vw_ModelExcRows shape: d, p, r, t, n, w.
//   resRows[]              vw_ModelResRows shape: d, r, p, n, e, w, ec.
//
//   dayWorktimeTotals[]     vw_ModelDayWorktimeTotals shape: d, w. Folded
//                         into a Record<date, seconds>.
//   spokeDayWorktimeTotals[]  vw_ModelSpokeDayWorktimeTotals shape:
//                         SpokeName, d, w. Folded into a
//                         Record<"SpokeName|date", seconds>.
//
//   resourceActivity[]      vw_ModelResourceActivity shape: ResourceName,
//                         FirstSeen, LastSeen, Items, SpokesServed (a
//                         ';'-delimited string, e.g. from
//                         STRING_AGG(SpokeName, ';') WITHIN GROUP (ORDER BY
//                         SpokeName) — ';' because spoke display names may
//                         contain commas). Folded into
//                         Record<name, {firstSeen,lastSeen,items,spokesServed[]}>.
//
//   meta                    vw_ModelMeta shape (a SINGLE row object, not an
//                         array): SourceRows, DateMin, DateMax.
//   unmappedQueues[]        vw_ModelUnmappedQueues shape: QueueName (or a
//                         plain string array — both accepted).
//
// `opts` = { generatedAt, source } — these two meta fields are NOT
// SQL-backed (generatedAt is "now"/pipeline-finish-time, source is the CSV
// path or a "sql:<db>" label) so the caller supplies them directly.
// ---------------------------------------------------------------------------

const round = (n, dp = 2) => (n == null ? null : Number(Number(n).toFixed(dp)));

const dateOnly = (v) => {
  if (v == null) return v;
  if (typeof v === "string") return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
};

// date-effective lookup: the row in force on `date` (latest effectiveFrom <= date).
// Byte-for-byte identical to tools/build-dashboard-data.mjs's inForce /
// src/reference/economics.ts's twin.
function inForce(history, date) {
  let best = null;
  for (const h of history) if (h.effectiveFrom <= date && (!best || h.effectiveFrom > best.effectiveFrom)) best = h;
  return best;
}

// spoke-first grade-rate resolution — see GradeRateRef's comment in
// src/reference/reference-store.ts. Identical to build-dashboard-data.mjs's
// gradeRate() and 08_report_views.sql's grade-rate CROSS APPLYs.
function gradeRate(reference, grade, spokeId, date) {
  const rows = reference.gradeRates.filter((g) => g.grade === grade);
  const sid = spokeId != null ? String(spokeId) : null;
  const spokeRows = sid != null ? rows.filter((g) => g.spokeId === sid) : [];
  const viaSpoke = inForce(spokeRows, date);
  if (viaSpoke) return viaSpoke.hourlyCostGBP;
  return inForce(rows.filter((g) => g.spokeId == null), date)?.hourlyCostGBP ?? 0;
}

// Canonical grade display name — identical resolution order to
// src/reference/reference-store.ts's gradeNameOf().
function gradeNameOf(reference, grade) {
  return (
    (reference.grades ?? []).find((g) => g.grade === grade)?.gradeName ??
    reference.gradeRates.find((g) => g.grade === grade)?.gradeName ??
    grade
  );
}

// Auto-generated fallback exception code: first letter of each word,
// uppercased, capped at 3 — identical to build-dashboard-data.mjs's inline
// fallback expression.
function defaultExceptionCode(reason) {
  return reason
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

const byDateAsc = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);

/**
 * @param {object} rowsets — see the module-level contract comment above.
 * @param {{generatedAt: string, source: string}} opts
 * @returns ModelJson (see src/rpaData.ts)
 */
export function assembleModel(rowsets, opts) {
  const { generatedAt, source } = opts;
  const reference = rowsets.reference;

  const metaRow = rowsets.meta;
  const dateMin = dateOnly(metaRow.DateMin ?? metaRow.dateMin);
  const dateMax = dateOnly(metaRow.DateMax ?? metaRow.dateMax);
  const sourceRows = metaRow.SourceRows ?? metaRow.sourceRows;

  const unmappedQueues = (rowsets.unmappedQueues ?? []).map((q) =>
    typeof q === "string" ? q : q.QueueName ?? q.queueName,
  );

  const spokes = rowsets.spokes.map((s) => ({
    id: s.SpokeId,
    name: s.SpokeName,
    short: s.ShortName,
    colorLight: s.ColorHexLight,
    colorDark: s.ColorHexDark,
  }));

  const propositions = rowsets.propositions.map((p) => ({
    name: p.PropositionName,
    spoke: p.SpokeName,
  }));

  const processes = rowsets.processes.map((p) => {
    const grade = p.Grade ?? p.GradeCode;
    return {
      id: p.ProcessId,
      name: p.ProcessName,
      acronym: p.ProcessAcronym,
      description: p.ProcessDescription,
      proposition: p.PropositionName,
      spoke: p.SpokeName,
      queues: p.Queues ?? [],
      smvMinutes: p.SMVMinutes,
      grade,
      gradeName: gradeNameOf(reference, grade),
      currentHourly: gradeRate(reference, grade, p.SpokeId, dateMax),
      icon: p.Icon,
      tags: p.Tags ?? [],
    };
  });

  const resources = rowsets.resources.map((r) => ({
    name: r.ResourceName,
    bot: r.BotName,
    acronym: r.BotAcronym,
    vdi: r.VDIName,
    class: r.CostClass,
    spoke: r.SpokeName,
    spokeId: r.SpokeId ?? null,
    activeFrom: r.ActiveFrom,
    activeTo: r.ActiveTo ?? null,
    notes: r.Notes ?? null,
    renewalDate: r.RenewalDate,
    annualCostGBP: r.AnnualCostGBP ?? null,
    licenseExpiryDate: r.LicenseExpiryDate ?? null,
    status: r.Status,
  }));

  const exceptionReasons = rowsets.exceptionReasons
    .map((e) => {
      const reason = e.Reason ?? e.reason;
      const type = e.ExceptionType ?? e.type;
      return {
        reason,
        type,
        code: reference.exceptionDisplayCodes?.[reason] ?? defaultExceptionCode(reason),
      };
    })
    .sort((a, b) => (a.type === b.type ? a.reason.localeCompare(b.reason) : a.type === "System" ? -1 : 1));

  const estateRateByDate = rowsets.estateRateByDate
    .map((r) => ({
      d: dateOnly(r.Date ?? r.d),
      cost: round(r.EstateCostPerDayGBP ?? r.cost, 4),
      wd: r.WorkingDaysPerYear ?? r.wd,
      ph: r.ProductiveHoursPerDay ?? r.ph,
    }))
    .sort(byDateAsc);

  const dayRows = [...rowsets.dayRows].sort(byDateAsc);
  const excRows = [...rowsets.excRows].sort(byDateAsc);
  const resRows = [...rowsets.resRows].sort(byDateAsc);

  const dayWorktimeTotals = Object.fromEntries(rowsets.dayWorktimeTotals.map((r) => [r.d, r.w]));
  const spokeDayWorktimeTotals = Object.fromEntries(
    rowsets.spokeDayWorktimeTotals.map((r) => [`${r.SpokeName}|${r.d}`, r.w]),
  );

  const resourceActivity = Object.fromEntries(
    rowsets.resourceActivity.map((r) => [
      r.ResourceName,
      {
        firstSeen: dateOnly(r.FirstSeen),
        lastSeen: dateOnly(r.LastSeen),
        items: r.Items,
        spokesServed: (r.SpokesServed ? String(r.SpokesServed).split(";").filter(Boolean) : []).sort(),
      },
    ]),
  );

  return {
    meta: { generatedAt, source, sourceRows, dateMin, dateMax, unmappedQueues },
    targets: { vdiStaleDays: 14, ...reference.targets },
    vdiOperatingHoursPerDay: reference.vdiOperatingHoursPerDay,
    spokes,
    propositions,
    processes,
    resources,
    exceptionReasons,
    estateRateByDate,
    dayRows,
    excRows,
    resRows,
    dayWorktimeTotals,
    spokeDayWorktimeTotals,
    resourceActivity,
    reference,
  };
}

export const _internal = { inForce, gradeRate, gradeNameOf, defaultExceptionCode, round, dateOnly };
