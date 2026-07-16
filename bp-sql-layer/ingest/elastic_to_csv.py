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
  FROM_DATE          ISO date, filter on lastupdateddate >=    (optional)
  TO_DATE            ISO date, filter on lastupdateddate <=    (optional)
  FIELD_MAP_JSON     JSON overriding source field names        (optional)
  OUT_CSV            output path (default ./workqueueitems.csv)
  PAGE_SIZE          search_after page size (default 5000)
  BP_WORKTIME_UNIT   Unit of the Elastic worktime field: "ms" or "s".
                     Converted to whole seconds before writing (default "s")

Only the standard library is used — no pip installs needed on a locked-down
ops box.
"""

import csv
import json
import os
import ssl
import sys
import urllib.request

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

    # date-bounded query on the change-detection field, else match_all
    must = []
    rng = {}
    if env("FROM_DATE"):
        rng["gte"] = env("FROM_DATE")
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
            total += len(hits)
            search_after = hits[-1]["sort"]
            print(f"  pulled {total} items…", file=sys.stderr)

    print(f"wrote {out_path}: {total} work queue items")
    if total == 0:
        print("warning: zero items — check ELASTIC_INDEX / FIELD_MAP_JSON / date range", file=sys.stderr)


if __name__ == "__main__":
    main()
