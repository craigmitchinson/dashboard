// ---------------------------------------------------------------------------
// fixtures.ts — DATA_SOURCE=fixtures: serves ModelJson from the JSON view
// ports under FIXTURES_DIR (public/data/views/vw_Model*.json etc.) through
// the SAME shared/model-assembler.mjs the real SQL path uses, plus an
// in-memory ReferenceStore seeded from data/reference/reference.json. This
// is how the SPA worker and CI run the API with no database — see
// README.md's "Fixture mode" section.
//
// LIMITATION (documented, not a bug): the FACT-based rowsets (dayRows,
// excRows, resRows, estateRateByDate, dayWorktimeTotals,
// spokeDayWorktimeTotals, resourceActivity, meta, unmappedQueues,
// exceptionReasons) are FROZEN SNAPSHOTS taken at the last `npm run
// data:build` — fixture mode has no live CSV/warehouse to recompute them
// against a PUT /api/reference edit (e.g. a changed grade rate does NOT
// retroactively re-value dayRows.gb in fixture mode). The DIMENSION
// rowsets (spokes/propositions/processes/resources) and the `reference`
// object itself DO reflect live PUT edits immediately, because they are
// derived straight from the in-memory ReferenceStore on every request,
// exactly like the real SQL path derives them from core.Ref*.
// ---------------------------------------------------------------------------
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRowsets } from "../model-types.js";
import {
  processesRowsetFromReference,
  propositionsRowsetFromReference,
  resourcesRowsetFromReference,
  spokesRowsetFromReference,
} from "./reference-mapping.js";
import type { PutReferenceInput, ReferenceSnapshot, ReferenceStore } from "./reference-store.js";
import { VersionConflictError } from "./reference-store.js";
import { validateReference } from "../validate/reference-schema.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export class InMemoryReferenceStore implements ReferenceStore {
  private snapshot: ReferenceSnapshot;
  private changelog: { ts: string; section: string; actor?: string }[] = [];

  constructor(initialReference: Record<string, unknown>) {
    this.snapshot = { reference: initialReference, version: 1, updatedAt: new Date().toISOString(), updatedBy: null };
  }

  async get(): Promise<ReferenceSnapshot> {
    return this.snapshot;
  }

  async put(input: PutReferenceInput): Promise<ReferenceSnapshot> {
    if (input.expectedVersion !== this.snapshot.version) throw new VersionConflictError(this.snapshot);
    const check = validateReference(input.reference);
    if (!check.ok) throw Object.assign(new Error(`Invalid reference payload: ${check.errors.join("; ")}`), { status: 400 });
    this.changelog.push({ ts: new Date().toISOString(), section: input.section, actor: input.actor });
    this.snapshot = {
      reference: input.reference,
      version: this.snapshot.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actor,
    };
    return this.snapshot;
  }
}

export async function loadFixtureReference(referenceJsonPath: string): Promise<Record<string, unknown>> {
  return (await readJson(referenceJsonPath)) as Record<string, unknown>;
}

export class FixtureModelSource {
  private staticRowsets: Promise<Record<string, unknown>> | null = null;

  constructor(
    private fixturesDir: string,
    private referenceStore: ReferenceStore,
  ) {}

  private async loadStatic(): Promise<Record<string, unknown>> {
    if (!this.staticRowsets) {
      this.staticRowsets = (async () => {
        const v = (name: string) => readJson(join(this.fixturesDir, `${name}.json`));
        const [dayRows, excRows, resRows, dayWorktimeTotals, spokeDayWorktimeTotals, resourceActivity, meta, unmappedQueues, exceptionReasons, estateRateByDate] =
          await Promise.all([
            v("vw_ModelDayRows"),
            v("vw_ModelExcRows"),
            v("vw_ModelResRows"),
            v("vw_ModelDayWorktimeTotals"),
            v("vw_ModelSpokeDayWorktimeTotals"),
            v("vw_ModelResourceActivity"),
            v("vw_ModelMeta"),
            v("vw_ModelUnmappedQueues"),
            v("vw_ModelExceptionReasons"),
            v("vw_EstateRateByDate"),
          ]);
        return { dayRows, excRows, resRows, dayWorktimeTotals, spokeDayWorktimeTotals, resourceActivity, meta, unmappedQueues, exceptionReasons, estateRateByDate };
      })();
    }
    return this.staticRowsets;
  }

  /** A cheap key that changes whenever the in-memory reference's version
   *  bumps (fixture mode never mutates the static fact fixtures). */
  async computeCacheKey(): Promise<string> {
    const { version } = await this.referenceStore.get();
    return `fixtures:v${version}`;
  }

  async buildRowsets(): Promise<ModelRowsets> {
    const [staticRowsets, { reference }] = await Promise.all([this.loadStatic(), this.referenceStore.get()]);
    const metaRows = staticRowsets.meta as Record<string, unknown>[];
    return {
      reference,
      spokes: spokesRowsetFromReference(reference),
      propositions: propositionsRowsetFromReference(reference),
      processes: processesRowsetFromReference(reference),
      resources: resourcesRowsetFromReference(reference),
      exceptionReasons: staticRowsets.exceptionReasons as Record<string, unknown>[],
      estateRateByDate: staticRowsets.estateRateByDate as Record<string, unknown>[],
      dayRows: staticRowsets.dayRows as Record<string, unknown>[],
      excRows: staticRowsets.excRows as Record<string, unknown>[],
      resRows: staticRowsets.resRows as Record<string, unknown>[],
      dayWorktimeTotals: staticRowsets.dayWorktimeTotals as Record<string, unknown>[],
      spokeDayWorktimeTotals: staticRowsets.spokeDayWorktimeTotals as Record<string, unknown>[],
      resourceActivity: staticRowsets.resourceActivity as Record<string, unknown>[],
      meta: metaRows[0] ?? {},
      unmappedQueues: staticRowsets.unmappedQueues as Record<string, unknown>[],
    };
  }
}
