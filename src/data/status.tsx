// ---------------------------------------------------------------------------
// data/status.tsx
// ---------------------------------------------------------------------------
// useSystemStatus(): a small hook that polls GET /api/health every 60s in
// api mode and exposes the result for header/status UI (App.tsx's data pill)
// — see src/data/client.ts for DATA_MODE/fetchHealth. In local mode there is
// no health endpoint at all, so this just reports a fixed "fine, nothing to
// be unreachable" status and never polls — a consumer wired to `apiOk` never
// shows an "API unreachable" state for a local build.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { DATA_MODE, fetchHealth } from "./client";
import type { PipelineRunHealth } from "./client";

export interface SystemStatus {
  /** Whether the freshness dot (App.tsx's header pill) should show its
   *  normal colour. Always true in local mode. In api mode this is
   *  `reachable && !stale` — App.tsx's dot/tooltip logic keys off THIS
   *  field alone (it cannot be edited to read `stale` separately), so
   *  "amber when stale" is folded in here rather than left for a
   *  consumer to combine itself. NOTE: App.tsx's own tooltip text for the
   *  false case ("API unreachable — showing last loaded data") is written
   *  for the reachability failure, not staleness — it will show even when
   *  the real cause is `stale`, not `reachable`. See `reachable`/`stale`
   *  below for the fields a future App.tsx tooltip should branch on
   *  instead once it can be edited to do so. */
  apiOk: boolean;
  /** Whether the last health check itself succeeded (pure network/HTTP
   *  reachability — the OLD meaning of `apiOk` before staleness was folded
   *  into it above). Always true in local mode. */
  reachable: boolean;
  /** health's own `stale` flag: the underlying data hasn't moved in far
   *  longer than the normal pull cadence explains (see server/src/routes/
   *  health.ts). Always false in local mode (no live pipeline to be stale
   *  against). */
  stale: boolean;
  /** The latest pipeline run's full detail (health's `lastRun`), for the
   *  admin Data health block (src/pages/admin/DataSyncSection.tsx) — null
   *  before the first successful check, on a failed poll, or in local
   *  mode. */
  lastRun: PipelineRunHealth | null;
  /** Latest outcome date the API's cached model covers (health's
   *  `dataThrough`), or null before the first successful check / in local
   *  mode (local mode's own data freshness is already shown from META
   *  elsewhere — see rpaData.ts / App.tsx's existing "Data to ..." pill). */
  dataThrough: string | null;
  /** Latest successful warehouse pull timestamp, or null (see HealthStatus
   *  in src/data/client.ts). Local mode: always null. */
  lastPullAt: string | null;
  /** The API server's own version string, or null (local mode / before the
   *  first successful check). */
  version: string | null;
  /** True only for the brief window between mount and the FIRST health
   *  response in api mode — lets a consumer avoid flashing an "unreachable"
   *  state before the first check has even had a chance to complete. */
  checking: boolean;
}

const POLL_MS = 60_000;

const LOCAL_STATUS: SystemStatus = {
  apiOk: true, reachable: true, stale: false, lastRun: null,
  dataThrough: null, lastPullAt: null, version: null, checking: false,
};

function initialApiStatus(): SystemStatus {
  return {
    apiOk: true, reachable: true, stale: false, lastRun: null,
    dataThrough: null, lastPullAt: null, version: null, checking: true,
  };
}

export function useSystemStatus(): SystemStatus {
  const [status, setStatus] = useState<SystemStatus>(() => (DATA_MODE === "api" ? initialApiStatus() : LOCAL_STATUS));
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (DATA_MODE !== "api") return;
    cancelledRef.current = false;

    const poll = async () => {
      try {
        const h = await fetchHealth();
        if (cancelledRef.current) return;
        setStatus({
          apiOk: h.ok && !h.stale,
          reachable: h.ok,
          stale: h.stale,
          lastRun: h.lastRun,
          dataThrough: h.dataThrough,
          lastPullAt: h.lastPullAt,
          version: h.version,
          checking: false,
        });
      } catch {
        // A failed poll just means "can't currently confirm the API is up" —
        // keep the last-known dataThrough/lastPullAt/version/lastRun (still
        // useful context in a tooltip) and flip apiOk/reachable false; the
        // next 60s poll may recover it without any user action. `stale`
        // keeps its last-known value rather than resetting — an unreachable
        // API says nothing about whether the last-known data was stale.
        if (cancelledRef.current) return;
        setStatus((prev) => ({ ...prev, apiOk: false, reachable: false, checking: false }));
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
