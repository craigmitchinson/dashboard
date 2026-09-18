#!/usr/bin/env python3
"""
run_pipeline.py
----------------
The single entrypoint the ingest Cloud Run Job runs (see ingest/Dockerfile's
ENTRYPOINT). Orchestrates one full pull:

    adapter pull (elastic_to_csv.py, or bp_api_to_csv.py when BP_ADAPTER=api)
        -> writes a CSV
    load_to_sql.py's load_and_merge()
        -> loads that CSV into raw.WorkQueueItem in batches
        -> EXEC core.usp_RunPull (staging.usp_LoadStaging -> core.usp_MergeFact)
        -> verifies row counts (fact.WorkItem before/after, staging count,
           MAX(LastUpdatedDate)) and writes the core.PipelineRun row
           (see "WHY PipelineRun IS WRITTEN INSIDE load_to_sql.py, NOT HERE"
           below for why that bookkeeping lives there and not in this file)

DIVISION OF LABOUR NOTE ("loads into staging.BPAWorkQueueItem" vs raw):
the task brief describing load_to_sql.py says it "loads into
staging.BPAWorkQueueItem". This pipeline's actual schema does not have a
table by that exact name -- there is core's landing table raw.WorkQueueItem
(all-NVARCHAR, untyped) and staging.WorkQueueItem (typed, produced FROM raw
by the stored procedure staging.usp_LoadStaging -- see
05_proc_load_staging.sql). load_to_sql.py deliberately loads into
raw.WorkQueueItem, NOT staging.WorkQueueItem directly, for the same reason
10_bulk_load_csv.sql's own BULK INSERT already targets raw and not staging:
staging.usp_LoadStaging is "the ONE place dates and numbers get parsed, so
nothing downstream re-parses" (02_raw_and_staging.sql's own comment) --
TRY_CONVERT-based date/number parsing, LTRIM/RTRIM trimming, and dropping
junk/blank-ID rows all live there in SQL. Re-implementing that parsing in
Python to load typed rows straight into staging would duplicate business
logic that must stay in exactly one place (the SQL/Node "transform rules
identical in SQL and the Node pipeline" contract ARCHITECTURE.md describes)
and would drift the moment either copy changed. Loading into raw and then
calling core.usp_RunPull (which runs staging.usp_LoadStaging for you)
achieves the identical end state with zero duplicated logic.

WHY PipelineRun IS WRITTEN INSIDE load_to_sql.py, NOT HERE: load_to_sql.py
already holds the one open SQL connection needed to capture
core.FactWorkItem's row count immediately before/after the merge and
staging's row count/MAX(LastUpdatedDate) immediately after -- consolidating
the core.PipelineRun INSERT/UPDATE into that same connection/call means the
run ledger's numbers can never disagree with what actually happened, and a
crash inside load_and_merge() still leaves an accurate Status='failed' row
(see load_to_sql.py's try/except). Splitting that bookkeeping into this
file would mean either a second SQL connection re-deriving the same counts
(wasteful and racy -- another pull could land between the two connections)
or load_to_sql.py handing back numbers this file blindly trusts to insert
-- strictly worse than owning it in one place. This file's own job is
strictly the layer above that: which adapter to run, the overlap/in-flight
guard, and process exit-code plumbing.

CONCURRENCY / OVERLAP GUARD: Cloud Run Jobs should be deployed with
--max-retries and task concurrency such that only one execution runs at a
time (see deploy/cloudsql.md), and Cloud Scheduler is configured with a
schedule that leaves headroom between runs -- but neither of those is a
hard guarantee (a manual `gcloud run jobs execute` while a scheduled run is
still going, or a Scheduler retry racing a slow-to-fail HTTP trigger, both
bypass them). This script's own guard, on top of those: before doing
anything else, if SQL is configured, call core.usp_GetInFlightRun (see
11_pipeline_ops.sql) and exit 0 immediately (a deliberate no-op, not a
failure -- there is nothing wrong, another run is just already handling
this pull) if a run is currently Status='running' and started less than
IN_FLIGHT_STALE_MINUTES ago. An older 'running' row is presumed crashed
(never reached its final UPDATE) and does NOT block a new run.

CONFIG (env vars):
  BP_ADAPTER              'elastic' (default) or 'api' -- which adapter to
                           run. Everything else needed by the chosen
                           adapter (ELASTIC_URL/ELASTIC_INDEX/... or
                           BP_AUTH_URL/BP_CLIENT_ID/...) is that adapter's
                           own env var contract -- see ingest/README.md.
  CSV_PATH                 Where the adapter writes its CSV and load_to_sql.py
                           reads it from (default ./workqueueitems.csv).
                           This script sets the adapter's own OUT_CSV /
                           BP_OUTPUT_CSV env var to this value so both
                           adapters and the loader agree on one path
                           without duplicating it in three places.
  IN_FLIGHT_STALE_MINUTES  See "CONCURRENCY / OVERLAP GUARD" above (default 30).
  LOAD_BATCH_SIZE          Passed through to load_to_sql.py (default 5000).
  MAX_REJECT_PCT           If this run's RowsRejected (see
                           raw.WorkQueueItemRejected / 05_proc_load_staging.sql)
                           exceed this percentage of RowsStaged, the run is
                           treated as a pipeline failure (exit 4) even
                           though load_to_sql.py itself completed and
                           recorded Status='success' -- the LOAD didn't
                           fail, but the DATA QUALITY of what it loaded
                           did. Default 2 (i.e. 2%).
  (plus every SQL_* var from sqlconn.py, needed unless --dry-run)

EXIT CODES:
  0  success, OR a deliberate skip (another run already in flight)
  1  configuration error
  2  adapter subprocess failed (non-zero exit) -- its stderr is in the logs
  3  CSV validation or SQL execution error (from load_to_sql.py)
  4  the load succeeded, but this run's reject rate (RowsRejected /
     RowsStaged + RowsRejected) exceeded MAX_REJECT_PCT -- see "reject_rate_check" in the
     logs either way (checked and logged on every successful load, pass
     or fail, not only when it fails).
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import load_to_sql
import sqlconn

ADAPTER_SCRIPTS = {
    "elastic": "elastic_to_csv.py",
    "api": "bp_api_to_csv.py",
}
INGEST_DIR = os.path.dirname(os.path.abspath(__file__))


def log_event(event, **fields):
    record = {"event": event, "ts": datetime.now(timezone.utc).isoformat()}
    record.update(fields)
    print(json.dumps(record, default=str), flush=True)


def env(name, default=None):
    return os.environ.get(name, default)


def check_in_flight_guard(stale_after_minutes):
    """Returns True (caller should exit 0, skip this run) if another run
    is currently in flight. Returns False if SQL isn't configured (a
    --dry-run, or a non-Cloud-SQL manual invocation) or no run is in
    flight -- either way, safe to proceed."""
    if not sqlconn.is_configured():
        log_event("in_flight_guard_skipped", reason="SQL not configured")
        return False
    conn = sqlconn.connect()
    try:
        cur = conn.cursor()
        cur.execute("EXEC core.usp_GetInFlightRun @StaleAfterMinutes = ?;", (stale_after_minutes,))
        row = cur.fetchone()
    finally:
        conn.close()
    if row:
        log_event(
            "run_skipped_in_flight",
            in_flight_run_id=row[0], in_flight_started_at=row[1], in_flight_adapter=row[2],
            stale_after_minutes=stale_after_minutes,
        )
        return True
    return False


def run_adapter(adapter, csv_path, dry_run):
    """Run the chosen adapter as a subprocess, writing csv_path. Adapter
    scripts read their own env var contract (ELASTIC_*/BP_*); this
    function only injects the shared CSV output path so run_pipeline.py,
    the adapter and load_to_sql.py all agree on one file without CSV_PATH
    having to be duplicated into each adapter's own OUT_CSV/BP_OUTPUT_CSV
    var by the caller."""
    script = os.path.join(INGEST_DIR, ADAPTER_SCRIPTS[adapter])
    child_env = dict(os.environ)
    args = [sys.executable, script]
    if adapter == "elastic":
        child_env["OUT_CSV"] = csv_path
    else:
        child_env["BP_OUTPUT_CSV"] = csv_path
    if dry_run:
        args.append("--dry-run")
        # elastic_to_csv.py has no --dry-run flag of its own (it always
        # pulls); only bp_api_to_csv.py supports one. For a pipeline
        # --dry-run against the elastic adapter, skip running it at all --
        # there is nothing meaningful to validate in the adapter itself
        # beyond "the required env vars are set", which we check here
        # instead of invoking the network call.
        if adapter == "elastic":
            missing = [v for v in ("ELASTIC_URL", "ELASTIC_INDEX") if not child_env.get(v)]
            log_event(
                "dry_run_adapter_skipped", adapter=adapter,
                missing_required_env=missing or None,
                note="elastic_to_csv.py has no --dry-run mode; not invoked. "
                     "Required env presence checked instead.",
            )
            return 0

    log_event("adapter_start", adapter=adapter, script=script, csv_path=csv_path)
    t0 = time.time()
    result = subprocess.run(args, env=child_env)
    log_event(
        "adapter_done", adapter=adapter, exit_code=result.returncode,
        duration_ms=int((time.time() - t0) * 1000),
    )
    return result.returncode


def main():
    adapter = env("BP_ADAPTER", "elastic").strip().lower()
    if adapter not in ADAPTER_SCRIPTS:
        log_event("config_error", error=f"BP_ADAPTER must be 'elastic' or 'api', got {adapter!r}")
        return 1

    csv_path = env("CSV_PATH", "./workqueueitems.csv")
    stale_after_minutes = int(env("IN_FLIGHT_STALE_MINUTES", "30"))
    batch_size = int(env("LOAD_BATCH_SIZE", str(load_to_sql.DEFAULT_BATCH_SIZE)))
    dry_run = "--dry-run" in sys.argv

    log_event("pipeline_start", adapter=adapter, csv_path=csv_path, dry_run=dry_run)

    if not dry_run and check_in_flight_guard(stale_after_minutes):
        return 0

    adapter_exit = run_adapter(adapter, csv_path, dry_run)
    if adapter_exit != 0:
        log_event("pipeline_failed", stage="adapter", exit_code=adapter_exit)
        return 2

    if dry_run:
        # Still exercise load_to_sql.py's own --dry-run path (config
        # validation + CSV-shape check if the adapter actually wrote one;
        # for the elastic adapter's skipped dry-run above, csv_path may
        # not exist yet, which load_to_sql's validate_csv() will report
        # plainly rather than this script guessing).
        try:
            load_to_sql.load_and_merge(csv_path, adapter, batch_size=batch_size, dry_run=True)
        except ValueError as exc:
            log_event("dry_run_csv_not_ready", note=str(exc))
        log_event("pipeline_dry_run_complete")
        return 0

    try:
        summary = load_to_sql.load_and_merge(csv_path, adapter, batch_size=batch_size, dry_run=False)
    except Exception as exc:
        log_event("pipeline_failed", stage="load_to_sql", error=str(exc))
        return 3

    log_event("pipeline_success", **summary)

    max_reject_pct = float(env("MAX_REJECT_PCT", "2"))
    rows_staged = summary.get("rows_staged") or 0
    rows_rejected = summary.get("rows_rejected") or 0
    # Share of all rows processed this pull that were rejected. A pull where
    # every row was rejected (nothing staged) is 100%, never 0%.
    rows_processed = rows_staged + rows_rejected
    reject_pct = (rows_rejected / rows_processed * 100) if rows_processed else 0.0
    exceeded = reject_pct > max_reject_pct
    # Logged unconditionally (pass or fail) -- this is the one line an
    # operator or alert (see deploy/scripts/11_alerting.sh) needs to answer
    # "did this run's data quality hold up", independent of whether the
    # load itself succeeded.
    log_event(
        "reject_rate_check",
        rows_staged=rows_staged, rows_rejected=rows_rejected,
        reject_pct=round(reject_pct, 4), max_reject_pct=max_reject_pct, exceeded=exceeded,
    )
    if exceeded:
        log_event(
            "pipeline_failed", stage="reject_rate",
            error=(
                f"{rows_rejected} of {rows_staged} staged rows rejected "
                f"({reject_pct:.2f}%), exceeding MAX_REJECT_PCT={max_reject_pct}%"
            ),
        )
        return 4

    return 0


if __name__ == "__main__":
    sys.exit(main())
