#!/usr/bin/env python3
"""
elastic_to_csv.py
-----------------
Pulls Blue Prism work queue items out of Elastic (the Kibana-backed store the
Blue Prism API ships queue logs into) and writes a CSV in the EXACT
raw.WorkQueueItem schema:

  ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
  LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate,
  Worktime, ExceptionDate, ExceptionReason, QueueName

That CSV is the universal swap point of the whole stack:
  - drop it in data/mock/ (dashboard repo) and run `npm run data:build`
    to drive the web dashboard, or
  - BULK INSERT it with scripts/10_bulk_load_csv.sql and run
    core.usp_RunPull to feed the SQL warehouse / Power BI.

Configuration is all environment variables (12-factor, so the same script
runs locally, in a scheduled job, or in Cloud Run):

  ELASTIC_URL        e.g. https://elastic.internal:9200        (required)
  ELASTIC_INDEX      e.g. bp-workqueueitems-*                  (required)
  ELASTIC_API_KEY    base64 ApiKey value                       (one of key/basic)
  ELASTIC_USER / ELASTIC_PASSWORD                              (basic auth alt.)
  ELASTIC_VERIFY_TLS "false" to skip cert verification         (default true)
  FROM_DATE          ISO date, filter on lastupdateddate >=    (optional --
                     see SQL-BACKED WATERMARK below for what happens when
                     this is left unset AND SQL connectivity is configured)
  TO_DATE            ISO date, filter on lastupdateddate <=    (optional)
  FIELD_MAP_JSON     JSON overriding source field names        (optional)
  OUT_CSV            output path (default ./workqueueitems.csv)
  PAGE_SIZE          search_after page size (default 5000)
  BP_WORKTIME_UNIT   Unit of the Elastic worktime field: "ms" or "s".
                     Converted to whole seconds before writing (default "s")
  ELASTIC_WATERMARK_OVERLAP_HOURS
                     Only consulted when SQL-backed watermark storage is
                     active (see below). Hours to re-pull behind the
                     stored watermark every run, same purpose and same
                     reasoning as bp_api_to_csv.py's WATERMARK_OVERLAP_HOURS
                     (default 24).

SQL-BACKED WATERMARK (Cloud Run Job production use -- OPTIONAL):
  This script has no built-in watermark of its own by default (see the
  PLAYBOOK.md section 8 gap this fills) -- FROM_DATE/TO_DATE are plain,
  manually-set date bounds. When run_pipeline.py/load_to_sql.py's SQL
  connection env vars (SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD --
  see sqlconn.py) are ALL set AND FROM_DATE is NOT explicitly set, this
  script instead:
    1. reads core.IngestWatermark's stored LastUpdatedMax for
       (Source='elastic', Queue='*') (see 11_pipeline_ops.sql),
    2. sets its effective FROM_DATE to (that value minus
       ELASTIC_WATERMARK_OVERLAP_HOURS) -- the same "always re-pull a
       deliberate overlap window behind the watermark, never exactly at
       it" discipline bp_api_to_csv.py already uses, for the identical
       reason (a work queue item mutating in place near the edge of a
       narrow window could otherwise be missed forever),
    3. after a successful pull, writes the MAX(lastupdateddate) seen
       across all pulled rows back to that same row.
  An explicitly-set FROM_DATE always wins outright (e.g. for a deliberate
  bounded backfill window) -- the SQL watermark is only consulted when
  FROM_DATE is entirely unset. This makes a stateless Cloud Run Job's
  ELASTIC pulls resumable across restarts without a local state file,
  mirroring bp_api_to_csv.py's existing JSON-file-based watermark for the
  API adapter. Falls back to today's plain FROM_DATE/TO_DATE-only
  behaviour (no watermark at all beyond whatever you pass) when SQL env
  vars are not all set -- e.g. running this by hand, or feeding
  10_bulk_load_csv.sql against an on-prem SQL Server. pyodbc (needed only
  for this SQL path) is imported lazily inside sqlconn.py, so the
  "standard library only" guarantee below still holds for anyone who
  doesn't set the SQL_* env vars.

Only the standard library is used for the core pull — no pip installs
needed on a locked-down ops box, UNLESS SQL-backed watermark storage above
is active, which needs pyodbc (see sqlconn.py's docstring for why that
import is lazy/optional).
"""

import csv
import json
import os
import ssl
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sqlconn  # noqa: E402 (see SQL-BACKED WATERMARK above; lazy pyodbc import inside)

# The CSV columns, in the exact raw.WorkQueueItem order.
COLUMNS = [
    "ID", "KeyValue", "Priority", "Status", "Tags", "Resource", "Attempt",
    "LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate",
    "CompletedDate", "Worktime", "ExceptionDate", "ExceptionReason", "QueueName",
]

# Default mapping: CSV column -> Elastic document field. The Blue Prism 7.x
# API names are lower-cased here as they commonly land via the standard
# ingest pipeline; override any of them with FIELD_MAP_JSON, e.g.
#   FIELD_MAP_JSON='{"ID":"itemid","QueueName":"queue.name"}'
DEFAULT_FIELD_MAP = {
    "ID": "id",
    "KeyValue": "keyvalue",
    "Priority": "priority",
    "Status": "status",
    "Tags": "tags",
    "Resource": "resource",
    "Attempt": "attempt",
    "LoadedDate": "loadeddate",
    "LastUpdatedDate": "lastupdateddate",
    "DeferredDate": "deferreddate",
    "LockedDate": "lockeddate",
    "CompletedDate": "completeddate",
    "Worktime": "worktime",
    "ExceptionDate": "exceptiondate",
    "ExceptionReason": "exceptionreason",
    "QueueName": "queuename",
}


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        sys.exit(f"error: environment variable {name} is required")
    return v


def get_nested(doc, path):
    """Resolve 'a.b.c' style field paths against a hit's _source."""
    cur = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def norm(value):
    """Normalise Elastic values to what staging.usp_LoadStaging expects."""
    if value is None:
        return ""
    if isinstance(value, list):  # e.g. tags arrays -> BP's semicolon convention
        return ";".join(str(v) for v in value)
    s = str(value)
    # ISO timestamps: '2026-07-14T18:22:05.000Z' -> '2026-07-14 18:22:05'
    if len(s) >= 19 and s[4] == "-" and s[10] == "T":
        s = s[:19].replace("T", " ")
    return s


def convert_worktime(value, unit):
    """Convert the Elastic worktime value to whole seconds for the CSV."""
    if value is None or value == "":
        return ""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return ""
    if unit == "ms":
        numeric = numeric / 1000.0
    return str(int(round(numeric)))


def parse_iso_utc(value):
    """Parse an ISO-8601-ish timestamp (optionally with a trailing 'Z' or
    numeric offset, 'T' or ' ' separator) into a naive UTC datetime, or
    None. Used only for the SQL-backed watermark path (see module
    docstring) -- the main CSV-writing path uses norm()'s simpler
    string-level rewrite instead, unchanged."""
    from datetime import datetime, timezone

    if value is None or value == "":
        return None
    s = str(value).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if len(s) > 10 and s[10] == " ":
        s = s[:10] + "T" + s[11:]
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def resolve_from_date(field_map):
    """Resolve the effective FROM_DATE: an explicit FROM_DATE env var
    always wins outright; otherwise, when SQL watermark storage is
    configured, fall back to (stored watermark - overlap hours); with
    neither, no lower date bound at all (today's existing behaviour).
    Returns (from_date_str_or_None, sql_conn_or_None) -- the caller is
    responsible for closing sql_conn_or_None once the pull (and the
    resulting watermark write) is complete."""
    from datetime import timedelta

    explicit = env("FROM_DATE")
    if explicit:
        return explicit, None
    if not sqlconn.is_configured():
        return None, None
    conn = sqlconn.connect()
    watermark = sqlconn.get_watermark(conn, "elastic", "*")
    if watermark is None:
        print(
            "info: no stored core.IngestWatermark row yet for (elastic, '*') and "
            "FROM_DATE is unset -- pulling with no lower date bound at all on this "
            "first run. Set FROM_DATE explicitly for a bounded first backfill "
            "instead if this index holds a lot of history (see PLAYBOOK.md section 8).",
            file=sys.stderr,
        )
        return None, conn
    overlap_hours = float(env("ELASTIC_WATERMARK_OVERLAP_HOURS", "24"))
    effective = watermark - timedelta(hours=overlap_hours)
    print(
        f"SQL watermark for (elastic, '*') = {watermark.isoformat()}; "
        f"pulling from {effective.isoformat()} (overlap {overlap_hours}h)",
        file=sys.stderr,
    )
    return effective.strftime("%Y-%m-%dT%H:%M:%S"), conn


def main():
    base = env("ELASTIC_URL", required=True).rstrip("/")
    index = env("ELASTIC_INDEX", required=True)
    out_path = env("OUT_CSV", "workqueueitems.csv")
    page_size = int(env("PAGE_SIZE", "5000"))

    field_map = dict(DEFAULT_FIELD_MAP)
    override = env("FIELD_MAP_JSON")
    if override:
        field_map.update(json.loads(override))

    # Default is "s" here (unlike bp_api_to_csv.py's "ms" default) because
    # this script's existing behavior already assumed the Elastic worktime
    # field was in seconds — verify your actual Elastic index's unit before
    # trusting the default.
    worktime_unit = env("BP_WORKTIME_UNIT", "s").strip().lower()
    if worktime_unit not in ("ms", "s"):
        print(
            f"warning: BP_WORKTIME_UNIT={worktime_unit!r} not recognised "
            "(expected 'ms' or 's'); defaulting to 's'",
            file=sys.stderr,
        )
        worktime_unit = "s"

    headers = {"Content-Type": "application/json"}
    api_key = env("ELASTIC_API_KEY")
    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    elif env("ELASTIC_USER"):
        import base64
        cred = f"{env('ELASTIC_USER')}:{env('ELASTIC_PASSWORD', '')}"
        headers["Authorization"] = "Basic " + base64.b64encode(cred.encode()).decode()

    ctx = None
    if env("ELASTIC_VERIFY_TLS", "true").lower() == "false":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    # date-bounded query on the change-detection field, else match_all.
    # resolve_from_date() handles the SQL-backed-watermark fallback (see
    # module docstring); it also opens (and hands back) the SQL
    # connection used later to WRITE the new watermark after a
    # successful pull, so the two never disagree about which connection/
    # transaction they're using.
    effective_from_date, watermark_conn = resolve_from_date(field_map)
    must = []
    rng = {}
    if effective_from_date:
        rng["gte"] = effective_from_date
    if env("TO_DATE"):
        rng["lte"] = env("TO_DATE")
    if rng:
        must.append({"range": {field_map["LastUpdatedDate"]: rng}})
    query = {"bool": {"must": must}} if must else {"match_all": {}}

    def search(body):
        req = urllib.request.Request(
            f"{base}/{index}/_search",
            data=json.dumps(body).encode(),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, context=ctx) as resp:
            return json.loads(resp.read())

    total = 0
    search_after = None
    # Results are sorted ascending on LastUpdatedDate (see the "sort" body
    # below), so the LAST row written overall carries the maximum
    # LastUpdatedDate seen this pull -- this is what gets written back as
    # the new watermark. Captured from the raw source field (not the
    # already-CSV-formatted `row`) so parse_iso_utc() sees the field's
    # native shape, whatever that is.
    last_lastupdated_raw = None
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(COLUMNS)
        while True:
            body = {
                "size": page_size,
                "query": query,
                # deterministic deep pagination: sort by the change field + id tiebreak
                "sort": [{field_map["LastUpdatedDate"]: "asc"}, {"_id": "asc"}],
            }
            if search_after:
                body["search_after"] = search_after
            data = search(body)
            hits = data.get("hits", {}).get("hits", [])
            if not hits:
                break
            for hit in hits:
                src = hit.get("_source", {})
                row = []
                for c in COLUMNS:
                    if c == "Worktime":
                        row.append(convert_worktime(get_nested(src, field_map[c]), worktime_unit))
                    else:
                        row.append(norm(get_nested(src, field_map[c])))
                writer.writerow(row)
                last_lastupdated_raw = get_nested(src, field_map["LastUpdatedDate"])
            total += len(hits)
            search_after = hits[-1]["sort"]
            print(f"  pulled {total} items…", file=sys.stderr)

    print(f"wrote {out_path}: {total} work queue items")
    if total == 0:
        print("warning: zero items — check ELASTIC_INDEX / FIELD_MAP_JSON / date range", file=sys.stderr)

    # SQL-backed watermark write-back (see resolve_from_date() and the
    # module docstring): only when SQL is configured (watermark_conn is
    # not None), and only ADVANCE the watermark when at least one row was
    # actually pulled AND its LastUpdatedDate parsed cleanly -- writing a
    # watermark forward on a zero-row or unparseable pull would silently
    # skip real data on the next run's overlap window.
    if watermark_conn is not None:
        try:
            max_seen = parse_iso_utc(last_lastupdated_raw) if total > 0 else None
            if max_seen is not None:
                sqlconn.set_watermark(watermark_conn, "elastic", "*", max_seen)
                print(f"SQL watermark for (elastic, '*') advanced to {max_seen.isoformat()}", file=sys.stderr)
            elif total > 0:
                print(
                    "warning: pulled rows but could not parse the last row's "
                    f"LastUpdatedDate ({last_lastupdated_raw!r}) -- watermark NOT advanced, "
                    "next run will re-pull this same window",
                    file=sys.stderr,
                )
        finally:
            watermark_conn.close()


if __name__ == "__main__":
    main()
