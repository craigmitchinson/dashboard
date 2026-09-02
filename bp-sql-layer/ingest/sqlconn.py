#!/usr/bin/env python3
"""
sqlconn.py
----------
Shared Cloud SQL for SQL Server connection + watermark helpers, used by
load_to_sql.py, run_pipeline.py, elastic_to_csv.py and bp_api_to_csv.py.

DELIBERATELY A SEPARATE, OPTIONAL MODULE: elastic_to_csv.py and
bp_api_to_csv.py both advertise "Python stdlib only -- no pip installs
needed on a locked-down ops box" (see ingest/README.md), and that
guarantee must keep holding for anyone running either adapter WITHOUT SQL
connectivity (e.g. against an on-prem/self-managed SQL Server fed via
10_bulk_load_csv.sql, or just generating a CSV for manual inspection).
pyodbc is therefore imported LAZILY, inside connect() below, only at the
moment SQL-backed watermark storage is actually requested (i.e. when
SQL_SERVER is set) -- never at module import time. A caller that never
sets SQL_SERVER never needs pyodbc installed.

CONNECTIVITY, VERIFIED (see bp-sql-layer/ingest/README.md and
deploy/cloudsql.md for full citations):
  - Cloud Run (service or Job) CANNOT reach Cloud SQL for SQL Server over
    PUBLIC IP -- Google's own Cloud Run + Cloud SQL for SQL Server
    quickstart states this explicitly. The ingest job therefore needs
    Direct VPC egress (or a Serverless VPC Access connector) onto the
    same VPC as the instance's PRIVATE IP, and connects over plain TCP
    on port 1433 straight to that private IP -- there is no Unix-socket
    proxy injection for SQL Server the way there is for Postgres/MySQL
    (whose client libraries support Unix domain sockets; SQL Server's
    wire protocol/ODBC driver stack does not use one here). See
    deploy/cloudsql.md for the exact gcloud flags.
  - Cloud SQL for SQL Server does NOT support IAM database authentication
    (verified: Google's own docs state IAM auth is available for Cloud
    SQL for SQL Server INSTANCE/backup operations only, not database
    logins) -- unlike Postgres/MySQL, there is no "connect as your GCP
    identity" option here. Built-in SQL Server username/password
    authentication (SQL_USER/SQL_PASSWORD below, sourced from Secret
    Manager in production -- see deploy/cloudsql.md) is therefore the
    only practical option for a service account-driven Cloud Run Job,
    short of standing up a customer-managed Active Directory domain
    purely to get Windows-integrated auth, which is out of scope here.

CONFIG (env vars, shared by every script that imports this module):
  SQL_SERVER    Cloud SQL private IP address (or on-prem host/IP for the
                self-managed alternative). No port suffix; see SQL_PORT.
  SQL_PORT      TCP port (default 1433).
  SQL_DATABASE  Database name (BPAnalytics, per 01_database_and_schemas.sql).
  SQL_USER      SQL Server login.
  SQL_PASSWORD  SQL Server login password (Secret Manager-sourced env var
                in production -- see deploy/cloudsql.md; never logged,
                see mask() in load_to_sql.py/the adapters).
  SQL_ENCRYPT   "yes" (default) or "no" -- TDS encryption in transit.
  SQL_TRUST_SERVER_CERTIFICATE
                "yes" or "no" (default "no" -- validate the server cert).
                Cloud SQL for SQL Server instances present a certificate
                signed by a Cloud SQL-managed CA; leave this "no" and set
                SQL_CA_CERT_PATH to that CA's PEM so the driver actually
                validates it, rather than disabling validation. Set to
                "yes" only for a quick local/test connection where you
                accept the man-in-the-middle risk knowingly.
  SQL_CA_CERT_PATH
                Optional path to the Cloud SQL instance's server-ca.pem
                (download via `gcloud sql instances describe` /
                `gcloud sql ssl server-ca-certs list` -- see
                deploy/cloudsql.md). Passed to the driver as its trusted
                root; only meaningful when SQL_TRUST_SERVER_CERTIFICATE
                is "no".
  SQL_CONNECT_TIMEOUT_SECONDS
                Driver connection timeout (default 30).

A caller with none of SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD set
should treat this module as "not configured" and fall back to its own
local behaviour (a JSON state file, an explicit FROM_DATE/TO_DATE, etc.)
-- see is_configured() below.
"""

import os
import sys


def env(name, default=None):
    return os.environ.get(name, default)


def is_configured():
    """True when enough env vars are set to attempt a SQL connection.

    All four of SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD are
    required together -- a partially-set group is almost certainly a
    misconfiguration (e.g. a typo'd env var name), not an intentional
    "half use SQL". Callers that find this False must fall back to their
    non-SQL behaviour rather than error, since "no SQL configured" is the
    normal/default case for a standalone adapter run.
    """
    required = ("SQL_SERVER", "SQL_DATABASE", "SQL_USER", "SQL_PASSWORD")
    present = [env(k) for k in required]
    if all(present):
        return True
    if any(present):
        missing = [k for k, v in zip(required, present) if not v]
        print(
            "warning: some but not all SQL_* connection env vars are set "
            f"(missing: {', '.join(missing)}) -- treating SQL as NOT configured "
            "and falling back to non-SQL behaviour. Set all four, or none.",
            file=sys.stderr,
        )
    return False


def build_connection_string():
    """Build the pyodbc/ODBC connection string from env vars.

    DRIVER CHOICE, VERIFIED: "ODBC Driver 18 for SQL Server" is
    Microsoft's current officially supported Linux ODBC driver (Microsoft
    Learn's "Install the Microsoft ODBC driver for SQL Server (Linux)"
    page lists Debian among its supported distributions, which is what
    ingest/Dockerfile's python:3.12-slim base image is), installed via
    Microsoft's own packages.microsoft.com apt repository -- see
    ingest/Dockerfile for the exact install steps, cited there.
    """
    server = _require("SQL_SERVER")
    port = env("SQL_PORT", "1433")
    database = _require("SQL_DATABASE")
    user = _require("SQL_USER")
    password = _require("SQL_PASSWORD")
    encrypt = env("SQL_ENCRYPT", "yes")
    trust_cert = env("SQL_TRUST_SERVER_CERTIFICATE", "no")
    ca_cert_path = env("SQL_CA_CERT_PATH")
    timeout = env("SQL_CONNECT_TIMEOUT_SECONDS", "30")

    parts = [
        "DRIVER={ODBC Driver 18 for SQL Server}",
        f"SERVER={server},{port}",
        f"DATABASE={database}",
        f"UID={user}",
        f"PWD={password}",
        f"Encrypt={encrypt}",
        f"TrustServerCertificate={trust_cert}",
        f"Connection Timeout={timeout}",
    ]
    if ca_cert_path and trust_cert.strip().lower() != "yes":
        # ODBC Driver 18 for SQL Server's certificate-store parameter for
        # a custom trusted root. Only meaningful when the driver is
        # actually validating the cert (TrustServerCertificate=no).
        parts.append(f"ServerCertificate={ca_cert_path}")
    return ";".join(parts) + ";"


def _require(name):
    v = env(name)
    if not v:
        sys.exit(f"error: environment variable {name} is required for a SQL connection")
    return v


def connect():
    """Open a pyodbc connection. Raises SystemExit with a clear message
    if pyodbc is not installed -- see the module docstring for why it is
    not a hard dependency of every script that imports this module."""
    try:
        import pyodbc
    except ImportError as exc:
        sys.exit(
            "error: pyodbc is required for SQL-backed connectivity/watermark "
            "storage (SQL_SERVER is set) but is not installed. "
            "pip install pyodbc (plus the Microsoft ODBC Driver 18 for SQL "
            "Server system package -- see ingest/Dockerfile), or unset "
            f"SQL_SERVER to use local/JSON-file behaviour instead. ({exc})"
        )
    return pyodbc.connect(build_connection_string(), autocommit=False)


# --------------------------------------------------------------------
# Watermark helpers -- core.IngestWatermark (see 11_pipeline_ops.sql).
# --------------------------------------------------------------------

def get_watermark(conn, source, queue):
    """Return the stored LastUpdatedMax (a naive UTC datetime) for
    (source, queue), or None if never recorded. source is 'elastic' or
    'api'; queue is the BP queue name for 'api', or '*' for 'elastic'
    (see 11_pipeline_ops.sql's core.IngestWatermark comment)."""
    cur = conn.cursor()
    cur.execute(
        "SELECT LastUpdatedMax FROM core.IngestWatermark WHERE Source = ? AND Queue = ?",
        (source, queue),
    )
    row = cur.fetchone()
    return row[0] if row else None


def set_watermark(conn, source, queue, value):
    """Upsert (source, queue) -> value (a datetime). Commits immediately
    -- callers should only invoke this AFTER the CSV/merge that value
    represents is durably complete (see run_pipeline.py and
    11_pipeline_ops.sql's comment on why watermark-advance order matters:
    the same "never advance a watermark ahead of durably-written data"
    discipline bp_api_to_csv.py's JSON-file save_state() already follows,
    now applied to the SQL-backed store too)."""
    cur = conn.cursor()
    cur.execute(
        """
        MERGE core.IngestWatermark AS tgt
        USING (SELECT ? AS Source, ? AS Queue, ? AS LastUpdatedMax) AS src
           ON tgt.Source = src.Source AND tgt.Queue = src.Queue
        WHEN MATCHED THEN UPDATE SET
            LastUpdatedMax = src.LastUpdatedMax, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED BY TARGET THEN INSERT (Source, Queue, LastUpdatedMax, UpdatedAt)
            VALUES (src.Source, src.Queue, src.LastUpdatedMax, SYSUTCDATETIME());
        """,
        (source, queue, value),
    )
    conn.commit()
