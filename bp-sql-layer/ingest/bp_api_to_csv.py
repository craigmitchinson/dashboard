#!/usr/bin/env python3
"""
bp_api_to_csv.py
----------------
PLAIN-LANGUAGE SUMMARY (read this first if you are not a software engineer)
============================================================================
This script logs in to Blue Prism's Authentication Server (the "Hub"), asks
the Blue Prism 7.x Web API for a list of work queues, and then downloads the
items on each queue (the individual "cases" the robots have worked). It
writes those items out to a CSV file in EXACTLY the same 16-column layout
that ingest/elastic_to_csv.py already produces, so it can be dropped into the
same SQL pipeline (see "WHERE THIS FEEDS INTO THE PIPELINE" below) without
any downstream change.

Use this script INSTEAD OF elastic_to_csv.py when your team has direct
credentials to Blue Prism's own REST API (no Elastic/Kibana hop involved).
Use elastic_to_csv.py INSTEAD OF this script when your team only has
Kibana/Elastic access, or when your BP database's purge/retention policy
means Elastic holds a longer history than the live BP database still does
(Elastic never forgets a queue item once it has been shipped there; the live
BP database usually purges completed items after a retention window). The
two scripts are alternative FRONT DOORS onto the identical CSV contract —
neither one replaces the other; pick whichever one your team can actually
reach.

This script only ever pulls a DELTA (new/changed items since last run), not
a full history re-pull, because work queue items in Blue Prism keep mutating
in place (Pending -> Locked -> Completed/Exception, sometimes multiple
attempts) until they reach a final state. See "DELTA / WATERMARK LOGIC"
further down for exactly how that is made both safe and complete.

ENVIRONMENT VARIABLES
============================================================================
  Name                     Purpose                                                    Default                      Required?
  ------------------------ ---------------------------------------------------------- ---------------------------- ---------
  BP_AUTH_URL              OAuth2 token endpoint on the BP Authentication Server (Hub) -                            Yes
  BP_CLIENT_ID             OAuth2 client_credentials client id                          -                            Yes
  BP_CLIENT_SECRET         OAuth2 client_credentials client secret                       -                            Yes
  BP_API_URL               Base URL of the BP 7.x Web API (e.g. https://bp.corp/api)    -                            Yes
  BP_OAUTH_SCOPE           OAuth2 "scope" value to request, if your Auth Server needs   "" (omit scope param)       No
                           one for the Web API resource
  BP_QUEUE_NAMES           Comma-separated queue names to pull. Empty/unset = all       "" (all queues)              No
                           queues returned by the enumeration endpoint
  BP_PAGE_SIZE             Items requested per page (skip/take pagination)              1000                         No
  BP_STATE_FILE            Path to the JSON watermark state file                        ./bp_api_watermark.json      No
  WATERMARK_OVERLAP_HOURS  Hours to re-pull behind each queue's stored watermark, to     24                           No
                           safely catch late in-place mutations (see below)
  BP_SINCE                 ISO-8601 date. Only used on a first run (no state file yet)  unset (pulls all history)   No
                           to set a floor instead of pulling all history
  BP_OUTPUT_CSV            Output CSV path (overridden by --output)                     ./workqueueitems_api.csv     No
  BP_WORKTIME_UNIT         Unit of the API's Worktime field: "ms" or "s". Converted     ms                           No
                           to whole seconds before writing (see convert_worktime())
  BP_FIELD_MAP_JSON        JSON overriding the default API-field -> CSV-column map      "" (use built-in map)       No
  BP_REQUEST_TIMEOUT       Per-HTTP-request timeout, in seconds                         30                           No
  BP_MAX_RETRIES           Max retry attempts on HTTP 429 / 5xx before giving up         5                            No
  BP_VERIFY_TLS            "false" to skip TLS certificate verification                 true                         No

EXAMPLE COMMANDS
============================================================================
  (a) First-time backfill run (no state file exists yet), scoped to two
      queues, with a floor date so we do not page all history:

        export BP_AUTH_URL=https://hub.corp.example/connect/token
        export BP_CLIENT_ID=bp-dashboard-svc
        export BP_CLIENT_SECRET=************
        export BP_API_URL=https://bpserver.corp.example/api
        export BP_QUEUE_NAMES="Invoice Processing,Claims Intake"
        export BP_SINCE=2026-01-01T00:00:00
        python bp_api_to_csv.py --output ./workqueueitems_api.csv

  (b) Scheduled incremental delta run (state file already exists from a
      prior run; only the overlap window plus anything new is pulled):

        python bp_api_to_csv.py

  (c) See what a run WOULD do without pulling any items:

        python bp_api_to_csv.py --dry-run

WHERE THIS FEEDS INTO THE PIPELINE
============================================================================
The CSV this script writes is loaded exactly the same way as the Elastic
adapter's output:
  1. Point scripts/10_bulk_load_csv.sql's @File variable at this script's
     --output path.
  2. Run 10_bulk_load_csv.sql. It BULK INSERTs the 16 columns into
     raw.WorkQueueItem, stamps provenance, then calls core.usp_RunPull
     (scripts/09_proc_run_pull.sql), which in turn runs
     staging.usp_LoadStaging (scripts/05_proc_load_staging.sql) and
     core.usp_MergeFact (scripts/06_proc_merge_fact.sql).
  3. usp_MergeFact only overwrites a row when the incoming LastUpdatedDate
     is newer than what is already stored — see DELTA / WATERMARK LOGIC
     below for why that makes re-pulling the overlap window safe.

DELTA / WATERMARK LOGIC (why this is both SAFE and NECESSARY)
============================================================================
A Blue Prism work queue item mutates in place — the same row goes from
Pending to Locked to Completed/Exception, sometimes across several retried
Attempts — until it reaches a final state. Its LastUpdatedDate moves every
time it changes. core.usp_MergeFact (06_proc_merge_fact.sql) keys off
ID + "is the incoming LastUpdatedDate newer than what's stored" to decide
whether to overwrite a fact row, and it NEVER deletes.

That means:
  - Re-pulling a window of items we already have is SAFE: any row whose
    LastUpdatedDate has not moved since our last pull is a no-op UPDATE
    (LastUpdatedDate not newer -> WHEN MATCHED condition false -> skipped).
  - Re-pulling that window is NECESSARY: an item could still be sitting in
    Locked or Pending state at the moment we recorded our watermark, then
    change again a minute later. If we only ever asked for
    "lastUpdated > watermark" with no overlap, a mutation that lands with a
    timestamp at or before our watermark (clock skew, transaction commit
    lag, etc.) could be missed forever.
  - So every run asks for items with lastUpdated >= (stored watermark -
    WATERMARK_OVERLAP_HOURS), which reliably catches late mutations while
    costing only a bounded amount of harmless re-work.

On the very first run (no state file yet), there is no watermark to work
from. If BP_SINCE is set we use that as a floor; if not, we pull ALL
history — but see the loud warning printed to stderr in that case: for a
very large Blue Prism estate (50-100M+ historic queue items), paging that
much data through a REST API is not a good idea. Do a one-time bulk
database backfill instead (talk to your DBA about exporting/restoring the
BP database's WorkQueueItem history directly, or ask your Blue Prism admin
whether Elastic already holds it), and reserve this API adapter for
ongoing incremental deltas from that point forward.

FIELD MAPPING (BP 7.x Web API field -> CSV column)
============================================================================
The CSV header below is the FIXED CONTRACT — never change it. Everything
in the "API field" column is what THIS SCRIPT ASSUMES your BP 7.x Web API
calls that field. Every one of these is marked ASSUMPTION in DEFAULT_FIELD_MAP
below (and again inline) because this script was written without access to
a live BP 7.x Web API / Swagger document — verify each one against your own
instance's Swagger/OpenAPI page (typically {BP_API_URL}/swagger) before
relying on this in production. Override any of them without touching code
via BP_FIELD_MAP_JSON, e.g.:
  BP_FIELD_MAP_JSON='{"Status":"itemStatus","Resource":"lockedResourceName"}'

  API field (per work-queue-item payload)   CSV column          Notes
  ------------------------------------------ ------------------- --------------------------------------------
  id                                         ID                  ASSUMPTION: item's unique identifier field
  keyValue                                   KeyValue            ASSUMPTION
  priority                                   Priority            ASSUMPTION
  status                                     Status              ASSUMPTION: string enum, e.g. Pending /
                                                                  Locked / Completed / Exception / Deferred
  tags                                       Tags                ASSUMPTION: array of strings; joined with
                                                                  ';' to match elastic_to_csv.py's convention
  lockedResource                             Resource            ASSUMPTION: name of the resource/agent that
                                                                  has (or last had) the item locked
  attempt                                    Attempt             ASSUMPTION
  loadedDate                                 LoadedDate          ASSUMPTION
  lastUpdated                                LastUpdatedDate     ASSUMPTION: the change-detection field that
                                                                  drives core.usp_MergeFact's overwrite rule
                                                                  and this script's own watermark logic
  deferredDate                               DeferredDate        ASSUMPTION
  lockedDate                                 LockedDate          ASSUMPTION
  completedDate                              CompletedDate       ASSUMPTION
  workTimeMs                                 Worktime            ASSUMPTION: verify the unit (milliseconds?)
                                                                  matches what staging.usp_LoadStaging /
                                                                  downstream reporting expects for Worktime.
                                                                  scripts/08_report_views.sql hard-assumes
                                                                  Worktime is in SECONDS (TotalWorktimeSec,
                                                                  AvgWorktimeSec, ProductiveSeconds,
                                                                  WastedBotSeconds and the per-second cost
                                                                  views all key off it), so BP_WORKTIME_UNIT
                                                                  controls a ms->s conversion before this
                                                                  column is written -- see convert_worktime()
  exceptionDate                              ExceptionDate       ASSUMPTION
  exceptionReason                            ExceptionReason     ASSUMPTION
  (queue name from the /workqueues           QueueName           ASSUMPTION: this script always trusts the
   enumeration response, not the item                            queue name from the enumeration call it is
   payload)                                                      currently iterating, not any per-item field,
                                                                  so QueueName is always populated correctly
                                                                  even if the item payload omits or duplicates
                                                                  a queue reference of its own.

Only the Python standard library is used (matching elastic_to_csv.py, which
uses urllib.request rather than the third-party 'requests' package) — no
pip installs needed on a locked-down ops box.
"""

import argparse
import csv
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# The CSV columns, in the exact raw.WorkQueueItem order. FIXED CONTRACT.
COLUMNS = [
    "ID", "KeyValue", "Priority", "Status", "Tags", "Resource", "Attempt",
    "LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate",
    "CompletedDate", "Worktime", "ExceptionDate", "ExceptionReason", "QueueName",
]

# Date-typed CSV columns: normalised to ISO-8601 UTC ('yyyy-mm-ddTHH:MM:SS',
# UTC by construction). The 'Z'/offset designator is deliberately omitted —
# see the ASSUMPTION note on ISO_DATE_FORMAT below.
DATE_COLUMNS = {
    "LoadedDate", "LastUpdatedDate", "DeferredDate",
    "LockedDate", "CompletedDate", "ExceptionDate",
}

# ASSUMPTION: values are emitted as 'yyyy-mm-ddTHH:MM:SS' (ISO-8601, UTC,
# no trailing 'Z'/offset). 05_proc_load_staging.sql runs
# TRY_CONVERT(DATETIME2(0), ...) against these values; that form parses
# unambiguously in SQL Server regardless of session DATEFORMAT/language
# (unlike 'dd/mm/yyyy'-style values), and avoiding the 'Z' suffix sidesteps
# any doubt about datetime2 (vs. datetimeoffset) handling of the UTC
# designator on older SQL Server compatibility levels. Every timestamp this
# script emits IS UTC — verify that assumption against your BP API's actual
# timezone behaviour (some BP estates store/display server-local time).
ISO_DATE_FORMAT = "%Y-%m-%dT%H:%M:%S"

# Default mapping: CSV column -> Blue Prism 7.x Web API field name. See the
# FIELD MAPPING table in the header docstring for the full ASSUMPTION-by-
# ASSUMPTION explanation. Override via BP_FIELD_MAP_JSON.
# QueueName is intentionally NOT looked up through this map at pull time —
# the script always uses the queue name from the enumeration call it is
# currently iterating (see fetch_queue_items / main). It is listed here only
# so BP_FIELD_MAP_JSON has a documented, overridable slot for it too, should
# a future version ever need to fall back to a per-item field.
DEFAULT_FIELD_MAP = {
    "ID": "id",
    "KeyValue": "keyValue",
    "Priority": "priority",
    "Status": "status",
    "Tags": "tags",
    "Resource": "lockedResource",
    "Attempt": "attempt",
    "LoadedDate": "loadedDate",
    "LastUpdatedDate": "lastUpdated",
    "DeferredDate": "deferredDate",
    "LockedDate": "lockedDate",
    "CompletedDate": "completedDate",
    "Worktime": "workTimeMs",
    "ExceptionDate": "exceptionDate",
    "ExceptionReason": "exceptionReason",
    "QueueName": "queueName",
}

SECRET_ENV_VARS = {"BP_CLIENT_SECRET"}


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        sys.exit(f"error: environment variable {name} is required")
    return v


def mask(name, value):
    if value is None:
        return "(not set)"
    if name in SECRET_ENV_VARS:
        return "*" * 8
    return value


def parse_iso(value):
    """Parse a variety of ISO-8601-ish inputs into a naive UTC datetime.

    ASSUMPTION: the BP Web API returns timestamps as ISO-8601 strings
    (optionally with a trailing 'Z' or numeric UTC offset, optional
    fractional seconds, 'T' or ' ' separator). If your instance instead
    returns Unix epoch millis or some other shape, adjust this function.
    """
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
        # last-resort fallback: trim to whole seconds and retry
        try:
            dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def format_iso(dt):
    return dt.strftime(ISO_DATE_FORMAT)


def norm(column, value):
    """Normalise one BP API field's value into its CSV string form."""
    if value is None:
        return ""
    if column == "Tags" and isinstance(value, list):
        return ";".join(str(v) for v in value)
    if column in DATE_COLUMNS:
        dt = parse_iso(value)
        return format_iso(dt) if dt else ""
    return str(value)


def convert_worktime(value, unit):
    """Convert the API's Worktime value to whole seconds for the CSV.

    scripts/08_report_views.sql hard-assumes Worktime is in SECONDS:
    vw_HubCostPerSecondByDate, vw_SpokeCostPerSecondByDate, and the
    TotalWorktimeSec / AvgWorktimeSec / ProductiveSeconds / WastedBotSeconds
    columns all key off it directly, and 05_proc_load_staging.sql does a
    bare TRY_CONVERT(INT, Worktime) with no unit conversion of its own. If
    the real BP API field is actually milliseconds (as DEFAULT_FIELD_MAP's
    'workTimeMs' name assumes) and this script wrote that value through
    unconverted, every cost/ROI figure in the dashboard would silently
    inflate 1000x.

    BP_WORKTIME_UNIT controls the conversion: "ms" (the default, matching
    the assumed field name) divides by 1000 and rounds to the nearest whole
    second; "s" passes the value through unchanged (rounded to an int).
    Flip to BP_WORKTIME_UNIT=s once you've confirmed against your real BP
    API/Swagger doc that the field already reports seconds.
    """
    if value is None or value == "":
        return ""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return ""
    if unit == "ms":
        numeric = numeric / 1000.0
    return str(int(round(numeric)))


class BPApiError(RuntimeError):
    pass


class TokenManager:
    """OAuth2 client-credentials token holder with auto-refresh.

    Long paging runs across many queues can easily outlast a single
    access token's lifetime, so every API call goes through get_token(),
    which transparently refreshes when the token is at or past expiry
    (with a small safety margin), and force_refresh() lets the caller
    recover from an unexpected 401 mid-run.
    """

    def __init__(self, auth_url, client_id, client_secret, scope, timeout, max_retries):
        self.auth_url = auth_url
        self.client_id = client_id
        self.client_secret = client_secret
        self.scope = scope
        self.timeout = timeout
        self.max_retries = max_retries
        self._token = None
        self._expires_at = 0.0

    def get_token(self):
        if self._token is None or time.time() >= self._expires_at:
            self._refresh()
        return self._token

    def force_refresh(self):
        self._refresh()

    def _refresh(self):
        form = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        # ASSUMPTION: the BP Authentication Server (Hub, IdentityServer4-based)
        # accepts an OAuth2 "scope" parameter for the Web API resource. Leave
        # BP_OAUTH_SCOPE unset if your instance does not require one.
        if self.scope:
            form["scope"] = self.scope
        body = urllib.parse.urlencode(form).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        status, payload = http_request(
            "POST", self.auth_url, headers=headers, data=body,
            timeout=self.timeout, max_retries=self.max_retries,
        )
        try:
            resp = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise BPApiError(f"token endpoint returned non-JSON response: {exc}") from exc
        token = resp.get("access_token")
        if not token:
            raise BPApiError("token endpoint response had no access_token field")
        expires_in = resp.get("expires_in", 3600)
        try:
            expires_in = float(expires_in)
        except (TypeError, ValueError):
            expires_in = 3600.0
        self._token = token
        # refresh 60s early so a request started right at expiry doesn't race it
        self._expires_at = time.time() + max(expires_in - 60, 30)


def build_ssl_context():
    if env("BP_VERIFY_TLS", "true").lower() == "false":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


_SSL_CONTEXT = None  # populated in main() once config is resolved


def http_request(method, url, headers=None, data=None, timeout=30, max_retries=5):
    """A single HTTP call with exponential-backoff retry on 429/5xx.

    Honors a Retry-After header (seconds, or an HTTP-date — the latter is
    approximated by falling back to the exponential backoff schedule since
    parsing HTTP-date reliably without extra dependencies is more trouble
    than it's worth here). Returns (status_code, body_bytes-as-str).
    """
    attempt = 0
    while True:
        req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CONTEXT) as resp:
                return resp.getcode(), resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            if e.code in (429,) or 500 <= e.code < 600:
                attempt += 1
                if attempt > max_retries:
                    raise BPApiError(
                        f"{method} {url} failed after {attempt} attempts: HTTP {e.code}: {body}"
                    ) from e
                wait = _retry_wait(e.headers.get("Retry-After"), attempt)
                print(
                    f"  warning: HTTP {e.code} from {url}, retrying in {wait:.1f}s "
                    f"(attempt {attempt}/{max_retries})",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue
            raise BPApiError(f"{method} {url} failed: HTTP {e.code}: {body}") from e
        except urllib.error.URLError as e:
            attempt += 1
            if attempt > max_retries:
                raise BPApiError(f"{method} {url} failed after {attempt} attempts: {e.reason}") from e
            wait = _retry_wait(None, attempt)
            print(
                f"  warning: network error contacting {url}: {e.reason}; retrying in {wait:.1f}s "
                f"(attempt {attempt}/{max_retries})",
                file=sys.stderr,
            )
            time.sleep(wait)
            continue


def _retry_wait(retry_after_header, attempt):
    if retry_after_header:
        try:
            return float(retry_after_header)
        except ValueError:
            pass  # not a plain seconds value (likely an HTTP-date) -- fall through
    return min(2 ** (attempt - 1), 60)  # 1, 2, 4, 8, ... capped at 60s


def api_get(base_url, path, token_mgr, timeout, max_retries, params=None):
    url = base_url.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    attempted_reauth = False
    while True:
        headers = {
            "Authorization": f"Bearer {token_mgr.get_token()}",
            "Accept": "application/json",
        }
        try:
            status, body = http_request("GET", url, headers=headers, timeout=timeout, max_retries=max_retries)
        except BPApiError as e:
            # a 401 surfaces as an HTTPError -> BPApiError with "HTTP 401" in
            # the message; force one token refresh and retry once before
            # giving up, in case the token expired between get_token() and
            # the request landing on the wire.
            if "HTTP 401" in str(e) and not attempted_reauth:
                attempted_reauth = True
                token_mgr.force_refresh()
                continue
            raise
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise BPApiError(f"GET {url} returned non-JSON response: {exc}") from exc


def enumerate_queues(base_url, token_mgr, timeout, max_retries):
    """List work queues.

    ASSUMPTION: GET {BP_API_URL}/api/v7/workqueues returns either a bare
    JSON array of queue objects, or an envelope like {"queues": [...]}.
    Each queue object is assumed to expose "id" and "name" fields. Verify
    the exact path and shape against your instance's Swagger/OpenAPI doc.
    """
    data = api_get(base_url, "/api/v7/workqueues", token_mgr, timeout, max_retries)
    if isinstance(data, dict):
        queues = data.get("queues", data.get("items", []))
    else:
        queues = data
    return queues or []


def fetch_queue_items(base_url, queue_id, since_dt, page_size, token_mgr, timeout, max_retries):
    """Yield item dicts for one queue, paging with skip/take.

    ASSUMPTION: BP's Web API paginates work-queue-item listings with
    skip/take query parameters (rather than an opaque continuation/page
    token) — this is the more common convention for BP's REST APIs, but
    confirm against your Swagger doc; if it instead uses a page token,
    swap this loop to follow that token from the response envelope.

    ASSUMPTION: the endpoint accepts a "lastUpdatedFrom" query parameter
    (ISO-8601) to filter items server-side, and the response envelope is
    {"items": [...], "totalCount": N} (or a bare array if there's no
    envelope — handled below).
    """
    skip = 0
    while True:
        params = {"skip": skip, "take": page_size}
        if since_dt is not None:
            params["lastUpdatedFrom"] = format_iso(since_dt)
        data = api_get(
            base_url, f"/api/v7/workqueues/{queue_id}/items", token_mgr, timeout, max_retries, params=params
        )
        items = data.get("items", []) if isinstance(data, dict) else (data or [])
        if not items:
            return
        for item in items:
            yield item
        if len(items) < page_size:
            return
        skip += page_size


def load_state(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        try:
            return json.load(fh)
        except json.JSONDecodeError:
            print(f"warning: {path} is not valid JSON, starting with empty state", file=sys.stderr)
            return {}


def save_state(path, state):
    """Atomic write: temp file in the same directory, then replace."""
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp_path = _mkstemp_text(directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2, sort_keys=True)
        os.replace(tmp_path, path)
    except Exception:
        _silent_remove(tmp_path)
        raise


def _mkstemp_text(directory):
    import tempfile
    fd, path = tempfile.mkstemp(prefix=".bp_api_state.", suffix=".tmp", dir=directory)
    return fd, path


def _silent_remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def resolve_field_map():
    field_map = dict(DEFAULT_FIELD_MAP)
    override = env("BP_FIELD_MAP_JSON")
    if override:
        field_map.update(json.loads(override))
    return field_map


def print_config_summary(cfg):
    print("Resolved configuration:", file=sys.stderr)
    for key in sorted(cfg):
        print(f"  {key} = {mask(key, cfg[key])}", file=sys.stderr)


def build_arg_parser():
    p = argparse.ArgumentParser(description="Pull Blue Prism work queue items via the BP 7.x REST API and write the BPAWorkQueueItem CSV.")
    p.add_argument("--dry-run", action="store_true", help="Print resolved config and the queues that would be pulled; fetch no items.")
    p.add_argument("--output", default=None, help="Output CSV path (overrides BP_OUTPUT_CSV).")
    return p


def main():
    global _SSL_CONTEXT
    args = build_arg_parser().parse_args()
    start_time = time.time()

    cfg = {
        "BP_AUTH_URL": env("BP_AUTH_URL", required=not args.dry_run),
        "BP_CLIENT_ID": env("BP_CLIENT_ID", required=not args.dry_run),
        "BP_CLIENT_SECRET": env("BP_CLIENT_SECRET", required=not args.dry_run),
        "BP_API_URL": env("BP_API_URL", required=not args.dry_run),
        "BP_OAUTH_SCOPE": env("BP_OAUTH_SCOPE", ""),
        "BP_QUEUE_NAMES": env("BP_QUEUE_NAMES", ""),
        "BP_PAGE_SIZE": env("BP_PAGE_SIZE", "1000"),
        "BP_STATE_FILE": env("BP_STATE_FILE", "./bp_api_watermark.json"),
        "WATERMARK_OVERLAP_HOURS": env("WATERMARK_OVERLAP_HOURS", "24"),
        "BP_SINCE": env("BP_SINCE", ""),
        "BP_OUTPUT_CSV": args.output or env("BP_OUTPUT_CSV", "./workqueueitems_api.csv"),
        "BP_WORKTIME_UNIT": env("BP_WORKTIME_UNIT", "ms"),
        "BP_REQUEST_TIMEOUT": env("BP_REQUEST_TIMEOUT", "30"),
        "BP_MAX_RETRIES": env("BP_MAX_RETRIES", "5"),
        "BP_VERIFY_TLS": env("BP_VERIFY_TLS", "true"),
    }

    _SSL_CONTEXT = build_ssl_context()
    page_size = int(cfg["BP_PAGE_SIZE"])
    overlap_hours = float(cfg["WATERMARK_OVERLAP_HOURS"])
    timeout = float(cfg["BP_REQUEST_TIMEOUT"])
    max_retries = int(cfg["BP_MAX_RETRIES"])
    out_path = cfg["BP_OUTPUT_CSV"]
    state_path = cfg["BP_STATE_FILE"]
    queue_filter = {q.strip() for q in cfg["BP_QUEUE_NAMES"].split(",") if q.strip()}
    field_map = resolve_field_map()
    worktime_unit = cfg["BP_WORKTIME_UNIT"].strip().lower()
    if worktime_unit not in ("ms", "s"):
        print(
            f"warning: BP_WORKTIME_UNIT={cfg['BP_WORKTIME_UNIT']!r} not recognised "
            "(expected 'ms' or 's'); defaulting to 'ms'",
            file=sys.stderr,
        )
        worktime_unit = "ms"

    if args.dry_run:
        print_config_summary(cfg)
        print("\nDry run: no items will be fetched.", file=sys.stderr)
        if not cfg["BP_AUTH_URL"] or not cfg["BP_API_URL"]:
            print(
                "BP_AUTH_URL / BP_API_URL / credentials not fully set; "
                "cannot enumerate real queues. Configured queue filter: "
                + (", ".join(sorted(queue_filter)) if queue_filter else "(none -- would pull ALL queues)"),
                file=sys.stderr,
            )
            return 0
        token_mgr = TokenManager(
            cfg["BP_AUTH_URL"], cfg["BP_CLIENT_ID"], cfg["BP_CLIENT_SECRET"],
            cfg["BP_OAUTH_SCOPE"], timeout, max_retries,
        )
        try:
            queues = enumerate_queues(cfg["BP_API_URL"], token_mgr, timeout, max_retries)
        except BPApiError as e:
            print(f"Could not enumerate queues to preview: {e}", file=sys.stderr)
            print(
                "Configured queue filter: "
                + (", ".join(sorted(queue_filter)) if queue_filter else "(none -- would pull ALL queues)"),
                file=sys.stderr,
            )
            return 0
        names = [q.get("name", "?") for q in queues]
        if queue_filter:
            names = [n for n in names if n in queue_filter]
        print("Queues that WOULD be pulled:", file=sys.stderr)
        for n in names:
            print(f"  - {n}", file=sys.stderr)
        return 0

    state = load_state(state_path)
    first_run = not os.path.exists(state_path)
    if first_run and not cfg["BP_SINCE"]:
        print(
            "!" * 78 + "\n"
            "! WARNING: no watermark state file found and BP_SINCE is not set.\n"
            "! This run will attempt to pull ALL HISTORY for every selected queue\n"
            "! through the live BP Web API. For a large Blue Prism estate\n"
            "! (50-100M+ historic work queue items), that is almost certainly the\n"
            "! wrong approach -- do a one-time bulk database backfill instead\n"
            "! (export/restore the BP database's WorkQueueItem history directly,\n"
            "! or check whether Elastic already holds it via elastic_to_csv.py),\n"
            "! and reserve this API adapter for ongoing incremental deltas.\n"
            + "!" * 78,
            file=sys.stderr,
        )

    since_floor = parse_iso(cfg["BP_SINCE"]) if cfg["BP_SINCE"] else None

    token_mgr = TokenManager(
        cfg["BP_AUTH_URL"], cfg["BP_CLIENT_ID"], cfg["BP_CLIENT_SECRET"],
        cfg["BP_OAUTH_SCOPE"], timeout, max_retries,
    )

    try:
        queues = enumerate_queues(cfg["BP_API_URL"], token_mgr, timeout, max_retries)
    except BPApiError as e:
        sys.exit(f"error: could not enumerate work queues: {e}")

    if queue_filter:
        queues = [q for q in queues if q.get("name") in queue_filter]
        missing = queue_filter - {q.get("name") for q in queues}
        for m in missing:
            print(f"warning: BP_QUEUE_NAMES included '{m}' but no such queue was returned by the API", file=sys.stderr)

    if not queues:
        print("warning: no queues to pull (check BP_QUEUE_NAMES / API connectivity)", file=sys.stderr)

    out_dir = os.path.dirname(os.path.abspath(out_path)) or "."
    fd, tmp_csv_path = _mkstemp_text(out_dir)
    total = 0
    # Watermarks computed this run are accumulated here, NOT written to the
    # state file until the CSV that backs them is durably in place at
    # out_path (see the single save_state() call after os.replace, below).
    # A queue's on-disk watermark must never advance ahead of durably-written
    # data: if it did, a crash on a LATER queue would delete this run's tmp
    # CSV (the except clause below), while the state file already reflected
    # the advanced watermark -- permanently skipping any items between the
    # old watermark and (new watermark - overlap) on the next run's overlap
    # window. Accumulating in memory and flushing once after the atomic
    # rename avoids that.
    new_watermarks = {}
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(COLUMNS)

            for queue in queues:
                queue_name = queue.get("name", "?")
                queue_id = queue.get("id")
                prior_watermark_str = state.get(queue_name)
                prior_watermark = parse_iso(prior_watermark_str) if prior_watermark_str else None

                if prior_watermark is not None:
                    since_dt = prior_watermark - timedelta(hours=overlap_hours)
                elif since_floor is not None:
                    since_dt = since_floor
                else:
                    since_dt = None  # first run, no floor: full history for this queue

                print(
                    f"queue '{queue_name}': watermark before = "
                    f"{prior_watermark_str or '(none)'}, pulling since = "
                    f"{format_iso(since_dt) if since_dt else '(all history)'}",
                    file=sys.stderr,
                )

                queue_count = 0
                max_seen = prior_watermark
                for item in fetch_queue_items(cfg["BP_API_URL"], queue_id, since_dt, page_size, token_mgr, timeout, max_retries):
                    row = []
                    for col in COLUMNS:
                        if col == "QueueName":
                            row.append(queue_name)
                            continue
                        raw_value = item.get(field_map[col])
                        if col == "Worktime":
                            row.append(convert_worktime(raw_value, worktime_unit))
                        else:
                            row.append(norm(col, raw_value))
                    writer.writerow(row)
                    queue_count += 1
                    total += 1

                    item_updated = parse_iso(item.get(field_map["LastUpdatedDate"]))
                    if item_updated is not None and (max_seen is None or item_updated > max_seen):
                        max_seen = item_updated

                    if queue_count % page_size == 0:
                        print(f"  ...{queue_count} items pulled from '{queue_name}' so far", file=sys.stderr)

                new_watermark_str = format_iso(max_seen) if max_seen else prior_watermark_str
                print(
                    f"queue '{queue_name}': pulled {queue_count} items, watermark after = "
                    f"{new_watermark_str or '(none -- queue empty)'}",
                    file=sys.stderr,
                )

                # Record the candidate watermark in memory only -- see the
                # note above new_watermarks for why this must not hit disk yet.
                if new_watermark_str:
                    new_watermarks[queue_name] = new_watermark_str

        os.replace(tmp_csv_path, out_path)
    except BaseException:
        _silent_remove(tmp_csv_path)
        raise

    # Only now -- after the CSV this run's watermarks represent is durably
    # at out_path -- is it safe to advance the state file. If the process
    # crashed anywhere above this line, no watermark advances at all, so the
    # next run simply (and safely, if a little wastefully) re-pulls from the
    # prior watermarks; core.usp_MergeFact's own "only overwrite when the
    # incoming LastUpdatedDate is newer" rule makes that re-pull a no-op for
    # anything already merged, so nothing is lost and nothing is corrupted.
    if new_watermarks:
        state.update(new_watermarks)
        save_state(state_path, state)

    duration = time.time() - start_time
    print(f"wrote {out_path}: {total} work queue items across {len(queues)} queues in {duration:.1f}s", file=sys.stderr)
    print(f"wrote {out_path}: {total} work queue items")
    if total == 0:
        print("warning: zero items -- check BP_QUEUE_NAMES / BP_SINCE / API connectivity", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
