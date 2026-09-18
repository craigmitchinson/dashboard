// ---------------------------------------------------------------------------
// data-source.ts — wires up the right ModelJson rowset source + ReferenceStore
// for config.dataSource ("sql" | "fixtures"), so routes/* never branch on it
// themselves.
// ---------------------------------------------------------------------------
import { join } from "node:path";
import type { Config } from "./config.js";
import { Db } from "./db.js";
import type { Logger } from "./logger.js";
import { FixtureModelSource, InMemoryReferenceStore, loadFixtureReference, fixtureLastRun } from "./data/fixtures.js";
import { SqlModelSource, getLastPullAt, getLastRun } from "./data/sql-model.js";
import { SqlReferenceStore } from "./data/sql-reference.js";
import type { ReferenceStore } from "./data/reference-store.js";
import type { PipelineHealth } from "./model-types.js";

export interface ModelSource {
  computeCacheKey(): Promise<string>;
  buildRowsets(): Promise<import("./model-types.js").ModelRowsets>;
}

export interface DataSourceBundle {
  modelSource: ModelSource;
  referenceStore: ReferenceStore;
  sourceLabel: string;
  isDbOk: () => boolean;
  getLastPullAt: () => Promise<string | null>;
  /** GET /api/health's `lastRun` -- see model-types.ts's PipelineHealth. */
  getLastRun: () => Promise<PipelineHealth | null>;
  db: Db | null;
}

export async function createDataSource(config: Config, log: Logger): Promise<DataSourceBundle> {
  if (config.dataSource === "fixtures") {
    const fixturesDir = config.fixturesDir!;
    // reference.json lives three levels above public/data/views by default
    // (repo-root/data/reference/reference.json); override with
    // FIXTURES_REFERENCE_PATH if your layout differs. See README.md.
    const referencePath = process.env.FIXTURES_REFERENCE_PATH ?? join(fixturesDir, "..", "..", "..", "data", "reference", "reference.json");
    const initialReference = await loadFixtureReference(referencePath);
    const referenceStore = new InMemoryReferenceStore(initialReference);
    const modelSource = new FixtureModelSource(fixturesDir, referenceStore);
    return {
      modelSource,
      referenceStore,
      sourceLabel: `fixtures:${fixturesDir}`,
      isDbOk: () => true, // no DB in fixture mode; "true" = the fixture data source itself is fine
      getLastPullAt: async () => null,
      getLastRun: async () => fixtureLastRun(),
      db: null,
    };
  }

  const db = new Db(config, log);
  db.connectWithRetry().catch((err) => log.error({ err }, "SQL connectWithRetry unexpectedly rejected")); // never blocks startup
  return {
    modelSource: new SqlModelSource(db),
    referenceStore: new SqlReferenceStore(db),
    sourceLabel: `sql:${config.sql.database}`,
    isDbOk: () => db.isConnected(),
    getLastPullAt: () => getLastPullAt(db),
    getLastRun: () => getLastRun(db),
    db,
  };
}
