#!/usr/bin/env python3
"""
load_to_sql.py
---------------
The Cloud SQL for SQL Server-ROBUST replacement for
scripts/10_bulk_load_csv.sql's BULK INSERT (see that script's own header
comment for exactly why BULK INSERT ... FROM '<server-local path>' is not
viable against Cloud SQL: the SQL Server engine process itself has no
filesystem to read a local/UNC path from on Cloud SQL).

Instead of asking the SQL engine to read the file, THIS SCRIPT reads the
16-column BPAWorkQueueItem CSV itself and pushes rows to
raw.WorkQueueItem via the ODBC driver's own batched, parameterized insert
path (pyodbc's cursor.fast_executemany), then runs the exact same
downstream sequence 10_bulk_load_csv.sql already does: stamp provenance,
EXEC core.usp_RunPull (staging.usp_LoadStaging -> core.usp_MergeFact).

DRIVER CHOICE: pyodbc + Microsoft ODBC Driver 18 for SQL Server, not
pymssql. Both were considered (see the task brief); pyodbc was chosen for
three verified reasons:
  1. Batch-loading throughput. cursor.fast_executemany = True (pyodbc's
     own feature, added specifically because ODBC's SQLBulkOperations/
     array-parameter-binding lets many rows go to the server in far fewer
     network round-trips than one exec-per-row) is the realistic path to
     "5-10k rows per batch" performing acceptably at 50-100M total rows.
     pymssql (a thin ctypes wrapper over FreeTDS, not the Microsoft ODBC
     stack) has no equivalent documented feature -- its executemany is
     materially slower for large batches per published benchmarks.
  2. Long-term support confidence. pymssql's own maintainers have
     publicly discussed discontinuing the project in favour of pyodbc
     (github.com/pymssql/pymssql, issue #477, "Proposal to discontinue
     pymssql in favor of pyodbc") -- a risk not worth taking for a
     production ingest job's core dependency.
  3. Microsoft's own Linux driver installation docs (learn.microsoft.com,
     "Install the Microsoft ODBC driver for SQL Server (Linux)") give an
     exact, current, officially supported apt-based install path for
     Debian (which python:3.12-slim is built on) -- see ingest/Dockerfile
     for the precise commands, lifted from that page.
  The trade-off accepted: the container image is larger (msodbcsql18 plus
  its apt dependencies, roughly 100+MB) and the Dockerfile must run
  Microsoft's EULA-accepting install steps. That cost is paid once, at
  image build time, not per pipeline run -- worth it for the throughput
  and maintenance-confidence gains above. See ingest/Dockerfile's own
  comments for the exact citations.

WHY raw.WorkQueueItem, NOT "staging.BPAWorkQueueItem" (a table name that
doesn't exist in this schema): loads land in raw.WorkQueueItem (all-text,
untyped -- exactly what 10_bulk_load_csv.sql's own BULK INSERT targets),
never directly in staging.WorkQueueItem. staging.usp_LoadStaging is "the
ONE place dates and numbers get parsed, so nothing downstream re-parses"
(02_raw_and_staging.sql's own words) -- TRY_CONVERT date/number parsing,
trimming, and junk/blank-ID row dropping all live there in SQL, and
core.usp_RunPull already calls it for you. Loading CSV strings straight
into the TYPED staging table from Python would mean either duplicating
that parsing logic here (drifting the moment either copy changed -- the
exact failure mode ARCHITECTURE.md's "transform rules identical in SQL and
the Node pipeline" contract exists to prevent) or pre-casting every value
in Python and hoping it matches SQL's TRY_CONVERT semantics exactly. Load
raw, call usp_RunPull, get the identical end state with zero duplicated
business logic.

CLOUD SQL FOR SQL SERVER CONNECTIVITY (verified -- see sqlconn.py's
docstring for the full citations): no Unix-socket proxy for SQL Server;
this job needs Direct VPC egress onto the same VPC as the instance's
PRIVATE IP and connects over plain TCP:1433. No IAM database
authentication for SQL Server either -- SQL_USER/SQL_PASSWORD (from
Secret Manager in production) is the only login path.

CONFIG (env vars; see sqlconn.py for the SQL_* connection vars this
script shares with the adapters and run_pipeline.py):
  CSV_PATH       Path to the 16-column BPAWorkQueueItem CSV to load.
                 (Positional --csv on the CLI overrides this.)
  LOAD_BATCH_SIZE
                 Rows per INSERT batch / per transaction (default 5000;
                 task guidance is "~5-10k rows per batch" -- 5000 is the
                 conservative end, tune upward once you've confirmed
                 Cloud SQL instance tier/log throughput headroom).
  PIPELINE_ADAPTER
                 'elastic' or 'api' -- which adapter produced CSV_PATH,
                 recorded on core.PipelineRun.Adapter for observability.
                 (run_pipeline.py always sets this; a standalone run
                 defaults to 'api' -- see build_config() below -- purely
                 so ad hoc/manual runs still satisfy
                 core.PipelineRun.Adapter's CHECK constraint without the
                 caller having to know the exact allowed values; correct
                 it explicitly via PIPELINE_ADAPTER when it matters.)

RESUMABILITY / IDEMPOTENCY -- explicit, per the task's own framing:
raw.WorkQueueItem is a SCRATCH/LANDING table (02_raw_and_staging.sql:
"raw accepts them exactly as they are"; 10_bulk_load_csv.sql already
TRUNCATEs it every pull). This script preserves that exact contract: it
TRUNCATEs raw.WorkQueueItem ONCE at the start of a run, then loads the
whole CSV in batches, each batch its own transaction (commit per batch,
so a 50-100M-row file doesn't sit in one multi-hour transaction/log
growth). If the process crashes at any point after the TRUNCATE and
before the final commit, raw.WorkQueueItem is left holding only however
many batches committed before the crash -- NOT a torn/duplicated state,
just a partial one. The fix on restart is exactly what
10_bulk_load_csv.sql already does today: run this script again from the
top. It TRUNCATEs first, so a restart can never duplicate rows; it always
means "start this file over from row 1", which is the same one-off-per-
pull granularity 10_bulk_load_csv.sql's own BULK INSERT already has (that
statement isn't resumable mid-file either -- a failed BULK INSERT is
simply re-run). core.PipelineRun (see 11_pipeline_ops.sql) records this
run's Status='failed' with the exception before re-raising, so a crash is
visible in the run ledger even though raw/staging themselves don't carry
a "how far did I get" marker beyond "was this run's row entirely
committed".

core.usp_RunPull is called with NO PARAMETERS (verified against
bp-sql-layer/scripts/09_proc_run_pull.sql: `CREATE OR ALTER PROCEDURE
core.usp_RunPull AS BEGIN ... END`, no parameter list) -- it operates
entirely on whatever is currently in raw.WorkQueueItem, exactly as this
script (and 10_bulk_load_csv.sql) leave it.

EXIT CODES:
  0  success
  1  configuration error (missing/invalid env var, bad CSV path)
  2  CSV validation error (header doesn't match the 16-column contract,
     or the file is otherwise unreadable as the expected shape) -- for a
     real (non-dry-run) invocation this is now ALSO recorded as a
     Status='failed' core.PipelineRun row (see validate_csv_header(),
     called after the run row is opened) so a header mismatch is visible
     to GET /api/health, not just this process's exit code.
  3  SQL execution error (connection failure, load failure, usp_RunPull
     failure) -- core.PipelineRun is updated to Status='failed' before
     this is raised, where a RunId had already been opened.

  (run_pipeline.py additionally exits 4 when this run's own row-level
  rejects -- see raw.WorkQueueItemRejected / 05_proc_load_staging.sql --
  exceed MAX_REJECT_PCT of rows staged; that check runs one layer up,
  after this module already recorded a Status='success' run, since the
  load itself genuinely succeeded -- see run_pipeline.py.)

LOGGING: structured JSON, one object per line, to stdout -- see
log_event() below. Pipe through `jq` or a log-ingestion sidecar in
production; every event carries at least {"event", "ts"} plus
event-specific fields, and phase-boundary events carry
{"phase", "duration_ms"}.
"""

import argparse
import csv
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

import sqlconn

# The CSV columns, in the exact raw.WorkQueueItem order. FIXED CONTRACT --
# identical to elastic_to_csv.py's and bp_api_to_csv.py's COLUMNS.
COLUMNS = [
    "ID", "KeyValue", "Priority", "Status", "Tags", "Resource", "Attempt",
    "LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate",
    "CompletedDate", "Worktime", "ExceptionDate", "ExceptionReason", "QueueName",
]

DEFAULT_BATCH_SIZE = 5000


def log_event(event, **fields):
    record = {"event": event, "ts": datetime.now(timezone.utc).isoformat()}
    record.update(fields)
    print(json.dumps(record, default=str), flush=True)


def env(name, default=None):
    return os.environ.get(name, default)


def build_config(args):
    return {
        "csv_path": args.csv or env("CSV_PATH"),
        "batch_size": int(env("LOAD_BATCH_SIZE", str(DEFAULT_BATCH_SIZE))),
        "adapter": args.adapter or env("PIPELINE_ADAPTER", "api"),
    }


def validate_csv_exists(path):
    """Confirm the CSV path is set and points at a real file. Deliberately
    separate from validate_csv_header() below: this check runs BEFORE a
    core.PipelineRun row is opened (a missing/misconfigured path is a
    configuration problem, not a run worth recording in the ledger --
    nothing was attempted), whereas a header mismatch runs AFTER, so it
    can be recorded as a failed run -- see load_and_merge()."""
    if not path:
        raise ValueError("no CSV path given (set CSV_PATH or pass --csv)")
    if not os.path.isfile(path):
        raise ValueError(f"CSV path does not exist or is not a file: {path}")


def validate_csv_header(path):
    """Confirm the header matches the 16-column BPAWorkQueueItem contract
    EXACTLY -- same 16 names, same order. Fails fast and specifically,
    naming exactly what's missing/extra, rather than letting a
    schema-drifted export (a renamed/reordered/added/dropped column)
    surface many rows in as a confusing SQL error. Returns nothing;
    raises ValueError on any mismatch."""
    with open(path, "r", newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError(f"CSV is empty (no header row): {path}")
    if header != COLUMNS:
        missing = [c for c in COLUMNS if c not in header]
        extra = [c for c in header if c not in COLUMNS]
        detail = []
        if missing:
            detail.append(f"missing columns: {missing}")
        if extra:
            detail.append(f"extra/unexpected columns: {extra}")
        if not detail:
            detail.append("column order differs from the expected 16-column contract")
        raise ValueError(
            "CSV header does not match the 16-column BPAWorkQueueItem contract "
            f"({'; '.join(detail)}).\n"
            f"  expected: {COLUMNS}\n"
            f"  actual:   {header}\n"
            "See ARCHITECTURE.md's '16-column contract' section."
        )


def validate_csv(path):
    """Full pre-flight check: path exists, header matches exactly. Used by
    the dry-run path (build_config()'s --dry-run), which never opens a SQL
    connection/PipelineRun row at all, so both checks happen together,
    up front, with no ledger entry either way."""
    validate_csv_exists(path)
    validate_csv_header(path)


def iter_batches(path, batch_size):
    """Yield lists of row-tuples (16 CSV columns, in order), batch_size
    at a time, from the CSV at path (header already validated/skipped)."""
    with open(path, "r", newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        next(reader)  # header, already validated by validate_csv()
        batch = []
        for row in reader:
            if len(row) != len(COLUMNS):
                raise ValueError(
                    f"row has {len(row)} fields, expected {len(COLUMNS)}: {row!r}"
                )
            # blank string -> NULL for every column (raw.WorkQueueItem
            # columns are all NULLable text; staging.usp_LoadStaging is
            # where real typing/NULLing happens, same division of labour
            # 10_bulk_load_csv.sql's BULK INSERT already relies on).
            batch.append(tuple(v if v != "" else None for v in row))
            if len(batch) >= batch_size:
                yield batch
                batch = []
        if batch:
            yield batch


def truncate_raw(conn):
    cur = conn.cursor()
    cur.execute("TRUNCATE TABLE raw.WorkQueueItem;")
    conn.commit()


def load_batches(conn, path, batch_size, source_file, load_batch_id):
    """Load every row from path into raw.WorkQueueItem, batch_size rows
    per INSERT / per transaction. Returns total row count loaded."""
    cur = conn.cursor()
    cur.fast_executemany = True  # the whole point -- see module docstring
    insert_sql = (
        "INSERT INTO raw.WorkQueueItem ("
        "ID, KeyValue, Priority, Status, Tags, Resource, Attempt, "
        "LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, "
        "CompletedDate, Worktime, ExceptionDate, ExceptionReason, QueueName, "
        "SourceFile, LoadBatchId"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    total = 0
    for batch_num, batch in enumerate(iter_batches(path, batch_size), start=1):
        params = [row + (source_file, load_batch_id) for row in batch]
        cur.executemany(insert_sql, params)
        conn.commit()
        total += len(batch)
        log_event("batch_loaded", batch_number=batch_num, batch_rows=len(batch), rows_so_far=total)
    return total


def run_usp_run_pull(conn):
    """Call core.usp_RunPull (no params -- verified against
    09_proc_run_pull.sql) and drain its PRINT/result-set output so pyodbc
    doesn't choke on multiple result sets; return nothing, the caller
    re-queries row counts itself for a value it can act on programmatically
    rather than parsing PRINT text."""
    cur = conn.cursor()
    cur.execute("EXEC core.usp_RunPull;")
    # usp_RunPull may emit a result set (the unmapped-queues SELECT) in
    # addition to PRINT messages; drain any/all result sets so the
    # connection is left clean for the next query.
    while True:
        try:
            cur.fetchall()
        except Exception:
            pass
        if not cur.nextset():
            break
    conn.commit()


def scalar(conn, sql):
    cur = conn.cursor()
    cur.execute(sql)
    row = cur.fetchone()
    return row[0] if row else None


def open_pipeline_run(conn, adapter):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO core.PipelineRun (StartedAt, Adapter, Status) "
        "OUTPUT INSERTED.RunId VALUES (SYSUTCDATETIME(), ?, 'running');",
        (adapter,),
    )
    run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def finish_pipeline_run(conn, run_id, status, rows_staged=None, rows_merged=None,
                         max_last_updated=None, error=None, rows_rejected=None,
                         unmapped_queues_json=None, watermark_age_minutes=None):
    cur = conn.cursor()
    cur.execute(
        "UPDATE core.PipelineRun SET FinishedAt = SYSUTCDATETIME(), Status = ?, "
        "RowsStaged = ?, RowsMerged = ?, MaxLastUpdated = ?, Error = ?, "
        "RowsRejected = ?, UnmappedQueues = ?, WatermarkAgeMinutes = ? "
        "WHERE RunId = ?;",
        (status, rows_staged, rows_merged, max_last_updated, error,
         rows_rejected, unmapped_queues_json, watermark_age_minutes, run_id),
    )
    conn.commit()


def count_rejected_rows(conn, load_batch_id):
    """Rows from THIS pull's raw.WorkQueueItem that staging.usp_LoadStaging
    quarantined to raw.WorkQueueItemRejected (see 11_pipeline_ops.sql /
    05_proc_load_staging.sql). Scoped by LoadBatchId, not RunId -- the
    stored procedure has no RunId parameter (see that table's own header
    comment for why), so LoadBatchId (already stamped on every raw row
    this pull by load_batches() below) is the join key available here.
    scalar() isn't reused here because it takes a plain (unparameterised)
    SQL string -- this needs a bound parameter."""
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM raw.WorkQueueItemRejected WHERE LoadBatchId = ?", (load_batch_id,))
    row = cur.fetchone()
    return row[0] if row else 0


def backfill_rejected_run_id(conn, run_id, load_batch_id):
    """Stamp this pull's RunId onto the rejected rows staging.usp_LoadStaging
    just wrote for it (identified by LoadBatchId, see count_rejected_rows).
    Only touches rows still NULL so a manual re-run of core.usp_RunPull by
    an operator (RunId-less, outside load_to_sql.py) never has its rows
    silently reattributed to a later pipeline run."""
    cur = conn.cursor()
    cur.execute(
        "UPDATE raw.WorkQueueItemRejected SET RunId = ? WHERE LoadBatchId = ? AND RunId IS NULL;",
        (run_id, load_batch_id),
    )
    conn.commit()


def unmapped_queues_this_pull(conn):
    """JSON-ready list of {"queue","rows"} for every QueueName staged this
    pull (staging.WorkQueueItem, rebuilt fresh every pull) with no
    core.RefQueueMap row -- this pull's own early-warning copy of what
    report.vw_ModelUnmappedQueues/core.usp_RunPull's PRINT already surface
    cumulatively, scoped instead to what just landed."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT s.QueueName, COUNT(*) AS Rows
        FROM staging.WorkQueueItem s
        LEFT JOIN core.RefQueueMap qm ON qm.QueueName = s.QueueName
        WHERE qm.QueueName IS NULL AND s.QueueName IS NOT NULL AND s.QueueName <> ''
        GROUP BY s.QueueName
        ORDER BY COUNT(*) DESC;
        """
    )
    return [{"queue": row[0], "rows": row[1]} for row in cur.fetchall()]


def watermark_age_minutes(conn):
    """DATEDIFF computed SERVER-SIDE (not python's utcnow() vs a fetched
    datetime) so a clock difference between this container and the SQL
    Server instance can never skew the figure -- "now" and "MAX(LastUpdatedDate)"
    are compared in the same place they're both already stored."""
    return scalar(
        conn,
        "SELECT DATEDIFF(MINUTE, MAX(LastUpdatedDate), SYSUTCDATETIME()) FROM staging.WorkQueueItem;",
    )


def load_and_merge(csv_path, adapter, batch_size=DEFAULT_BATCH_SIZE, dry_run=False):
    """The whole pipeline this module exists for: validate -> connect ->
    truncate+load raw -> usp_RunPull -> verify counts -> record
    core.PipelineRun. Returns a dict summary; raises on any failure (the
    caller -- main() below, or run_pipeline.py -- decides the process
    exit code). Safe to import and call directly from run_pipeline.py
    (no subprocess needed, one shared connection)."""
    t_start = time.time()

    if dry_run:
        # Dry run never opens a SQL connection/PipelineRun row at all, so
        # both checks (existence + strict header) happen together, up
        # front -- see validate_csv()'s own docstring.
        log_event("phase_start", phase="validate", csv_path=csv_path, adapter=adapter)
        validate_csv(csv_path)
        log_event("phase_done", phase="validate", duration_ms=int((time.time() - t_start) * 1000))
        log_event(
            "dry_run_plan",
            csv_path=csv_path,
            adapter=adapter,
            batch_size=batch_size,
            sql_server=env("SQL_SERVER"),
            sql_database=env("SQL_DATABASE"),
            note="config validated; no SQL connection attempted",
        )
        return {"dry_run": True}

    if not sqlconn.is_configured():
        raise RuntimeError(
            "SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD must all be set to load "
            "data (this is not the CSV-generation step -- see the adapters for that)."
        )

    # Existence-only check BEFORE opening a connection/run row -- a missing
    # file is a configuration problem, nothing was attempted, no ledger
    # entry warranted (see validate_csv_exists()'s own docstring).
    validate_csv_exists(csv_path)

    t_connect = time.time()
    log_event("phase_start", phase="connect")
    conn = sqlconn.connect()
    log_event("phase_done", phase="connect", duration_ms=int((time.time() - t_connect) * 1000))

    run_id = open_pipeline_run(conn, adapter)
    log_event("pipeline_run_opened", run_id=run_id, adapter=adapter)

    try:
        # STRICT HEADER CHECK, now that a run row exists to record a
        # failure against. A schema-drifted export (wrong/missing/
        # reordered columns) is exactly the "corrupted or wrong format on
        # ingestion" failure mode operators need visible in
        # core.PipelineRun (and therefore GET /api/health), not just a
        # container exit code with no run row for anyone to find. Raising
        # ValueError here (same type validate_csv_header always raised)
        # is still caught by main()'s ValueError branch -> exit code 2,
        # unchanged -- only WHERE it's recorded changes, not its exit code.
        t_validate = time.time()
        log_event("phase_start", phase="validate_header", csv_path=csv_path)
        validate_csv_header(csv_path)
        log_event("phase_done", phase="validate_header", duration_ms=int((time.time() - t_validate) * 1000))

        import uuid
        load_batch_id = str(uuid.uuid4())
        source_file = os.path.abspath(csv_path)

        fact_before = scalar(conn, "SELECT COUNT(*) FROM core.FactWorkItem;")

        t_truncate = time.time()
        log_event("phase_start", phase="truncate_raw")
        truncate_raw(conn)
        log_event("phase_done", phase="truncate_raw", duration_ms=int((time.time() - t_truncate) * 1000))

        t_load = time.time()
        log_event("phase_start", phase="load_raw", batch_size=batch_size)
        rows_loaded = load_batches(conn, csv_path, batch_size, source_file, load_batch_id)
        log_event(
            "phase_done", phase="load_raw",
            duration_ms=int((time.time() - t_load) * 1000), rows_loaded=rows_loaded,
        )

        t_pull = time.time()
        log_event("phase_start", phase="usp_run_pull")
        run_usp_run_pull(conn)
        log_event("phase_done", phase="usp_run_pull", duration_ms=int((time.time() - t_pull) * 1000))

        rows_staged = scalar(conn, "SELECT COUNT(*) FROM staging.WorkQueueItem;")
        fact_after = scalar(conn, "SELECT COUNT(*) FROM core.FactWorkItem;")
        rows_merged = (fact_after or 0) - (fact_before or 0)
        max_last_updated = scalar(conn, "SELECT MAX(LastUpdatedDate) FROM staging.WorkQueueItem;")

        rows_rejected = count_rejected_rows(conn, load_batch_id)
        backfill_rejected_run_id(conn, run_id, load_batch_id)
        unmapped_queues = unmapped_queues_this_pull(conn)
        unmapped_queues_json = json.dumps(unmapped_queues)
        watermark_age = watermark_age_minutes(conn)

        finish_pipeline_run(
            conn, run_id, "success",
            rows_staged=rows_staged, rows_merged=rows_merged, max_last_updated=max_last_updated,
            rows_rejected=rows_rejected, unmapped_queues_json=unmapped_queues_json,
            watermark_age_minutes=watermark_age,
        )

        summary = {
            "run_id": run_id,
            "rows_loaded": rows_loaded,
            "rows_staged": rows_staged,
            "fact_before": fact_before,
            "fact_after": fact_after,
            "rows_merged": rows_merged,
            "max_last_updated": max_last_updated,
            "rows_rejected": rows_rejected,
            "unmapped_queues": unmapped_queues,
            "watermark_age_minutes": watermark_age,
            "duration_ms": int((time.time() - t_start) * 1000),
        }
        log_event("pipeline_run_success", **summary)
        return summary
    except Exception as exc:
        error_text = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        try:
            finish_pipeline_run(conn, run_id, "failed", error=error_text)
        except Exception as inner:
            log_event("pipeline_run_finish_failed", original_error=error_text, finish_error=str(inner))
        log_event("pipeline_run_failed", run_id=run_id, error=error_text)
        raise
    finally:
        conn.close()


def build_arg_parser():
    p = argparse.ArgumentParser(
        description="Load a BPAWorkQueueItem CSV into Cloud SQL for SQL Server "
                    "(raw -> staging -> core, via core.usp_RunPull)."
    )
    p.add_argument("--csv", default=None, help="Path to the CSV (overrides CSV_PATH env var).")
    p.add_argument("--adapter", default=None, choices=["elastic", "api"],
                    help="Which adapter produced this CSV (overrides PIPELINE_ADAPTER env var).")
    p.add_argument("--dry-run", action="store_true",
                    help="Validate config/CSV and print the plan; make no SQL connection.")
    return p


def main():
    args = build_arg_parser().parse_args()
    cfg = build_config(args)
    try:
        summary = load_and_merge(
            cfg["csv_path"], cfg["adapter"], batch_size=cfg["batch_size"], dry_run=args.dry_run,
        )
    except ValueError as exc:
        log_event("config_or_csv_error", error=str(exc))
        return 2
    except RuntimeError as exc:
        log_event("config_error", error=str(exc))
        return 1
    except Exception as exc:
        log_event("sql_error", error=str(exc))
        return 3
    print(json.dumps(summary, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
