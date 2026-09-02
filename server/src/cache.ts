// ---------------------------------------------------------------------------
// cache.ts — in-memory ModelJson cache keyed on a cheap-to-compute "cache
// key" (see data/sql.ts's computeCacheKey / data/fixtures.ts's fixed key).
// Serves 304 via ETag/If-None-Match, and — critically — keeps serving the
// LAST GOOD model (with X-Data-Stale: true) if the DB goes down after a
// successful build. See routes/model.ts.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";

export interface CachedModel {
  key: string;
  etag: string;
  json: string; // pre-serialized JSON.stringify(model) — computed once per build
  builtAt: string;
  dateThrough: string | null; // model.meta.dateMax, surfaced by GET /api/health
}

export class ModelCache {
  private current: CachedModel | null = null;

  get(): CachedModel | null {
    return this.current;
  }

  /** Replaces the cached model iff `key` differs from the currently cached
   *  key (or nothing is cached yet). Returns the (possibly unchanged) cache
   *  entry. `buildJson` is only invoked when a rebuild is actually needed. */
  async getOrBuild(key: string, buildJson: () => Promise<{ json: string; dateThrough: string | null }>): Promise<CachedModel> {
    if (this.current && this.current.key === key) return this.current;
    const { json, dateThrough } = await buildJson();
    const etag = `"${createHash("sha256").update(json).digest("hex").slice(0, 32)}"`;
    this.current = { key, etag, json, builtAt: new Date().toISOString(), dateThrough };
    return this.current;
  }

  invalidate(): void {
    this.current = null;
  }
}
