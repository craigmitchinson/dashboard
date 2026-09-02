# ---------------------------------------------------------------------------
# Ingest job image -- runs run_pipeline.py as a Cloud Run Job (Cloud Scheduler
# triggers one execution per pull; see deploy/cloudsql.md and deploy/gcp.md).
#
#   docker build -t bp-ingest -f bp-sql-layer/ingest/Dockerfile bp-sql-layer/ingest
#   docker run --rm \
#     -e BP_ADAPTER=elastic -e ELASTIC_URL=... -e ELASTIC_INDEX=... \
#     -e SQL_SERVER=... -e SQL_DATABASE=BPAnalytics -e SQL_USER=... -e SQL_PASSWORD=... \
#     bp-ingest
#
# Not runnable/verifiable with an actual `docker build` in this environment --
# every step below is lifted verbatim (base image, package names, EULA
# handling) from Microsoft's own current Linux ODBC driver installation
# documentation (learn.microsoft.com, "Install the Microsoft ODBC driver for
# SQL Server (Linux)", Debian tab) so it can be checked by inspection against
# that source rather than assumed. See load_to_sql.py's docstring for why
# pyodbc + this driver was chosen over pymssql.
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# --- Microsoft ODBC Driver 18 for SQL Server -------------------------------
# VERIFIED (learn.microsoft.com/en-us/sql/connect/odbc/linux-mac/
# installing-the-microsoft-odbc-driver-for-sql-server, "Debian" tab, current
# as of this writing): Debian is an officially supported distribution for
# ODBC Driver 18; python:3.12-slim is Debian-based (Debian 12 "bookworm" as
# of Python 3.12's official image). The steps below are exactly Microsoft's
# documented Debian install sequence: add Microsoft's own apt repository via
# their packages-microsoft-prod.deb, then apt-get install msodbcsql18 with
# ACCEPT_EULA=Y (Microsoft's documented non-interactive EULA acceptance for
# apt) plus unixodbc-dev (needed to build pyodbc's C extension against
# unixODBC's headers) and libgssapi-krb5-2 (Microsoft's own note: "optional:
# kerberos library for debian-slim distributions" -- this IS a slim image).
# curl and gnupg are build-time-only tools to fetch/verify that repo config;
# apt lists are cleaned up in the same layer to keep the image lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        gnupg \
        ca-certificates \
    && curl -sSL -O https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && rm packages-microsoft-prod.deb \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && apt-get install -y --no-install-recommends unixodbc-dev libgssapi-krb5-2 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pyodbc only -- no other third-party deps. Pinned loosely (>=) rather than
# to an exact version deliberately: this is a small, stable dependency
# surface where picking up routine patch releases is lower-risk than pinning
# and drifting from upstream security fixes; pin exactly if your change-
# control process requires it.
RUN pip install --no-cache-dir "pyodbc>=5.1,<6"

# The whole ingest/ directory: the two adapters, sqlconn.py, load_to_sql.py,
# run_pipeline.py, README.md. Nothing outside bp-sql-layer/ingest/ is needed
# at runtime -- the .sql scripts under bp-sql-layer/scripts/ are run ONCE
# (per deploy/cloudsql.md's bootstrap runbook) via sqlcmd from a bastion/
# Cloud Shell, not by this container.
COPY . /app

# --- Non-root ---------------------------------------------------------------
# python:3.12-slim runs as root by default; create and switch to an
# unprivileged user for defense in depth (this container only ever makes
# outbound connections -- to Elastic/the BP API and to Cloud SQL -- it never
# needs to bind a privileged port or write outside its own /app/work dir).
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin ingest \
    && mkdir -p /app/work \
    && chown -R ingest:ingest /app
USER ingest

# Where the adapter writes its CSV and load_to_sql.py reads it from, unless
# overridden -- see run_pipeline.py's CSV_PATH env var. Lives under the
# non-root user's writable /app/work, not /app itself (which is owned by
# root's COPY layer other than the chown above).
ENV CSV_PATH=/app/work/workqueueitems.csv

# --- Documented environment contract ---------------------------------------
# Cloud Run Job env/secrets wiring sets these (see deploy/cloudsql.md) --
# none are baked into the image with real values; the ENV lines below exist
# only to document the full contract in one place and to give BP_ADAPTER a
# sane default. Every var without a default here is REQUIRED at run time by
# whichever component reads it (see run_pipeline.py, sqlconn.py,
# elastic_to_csv.py / bp_api_to_csv.py's own docstrings for the complete,
# authoritative list -- this comment is a pointer, not a duplicate source of
# truth):
#   BP_ADAPTER            'elastic' (default) or 'api'
#   CSV_PATH              set above; override only if you need a different
#                         scratch path
#   IN_FLIGHT_STALE_MINUTES, LOAD_BATCH_SIZE   run_pipeline.py / load_to_sql.py tuning
#   SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD, SQL_PORT,
#   SQL_ENCRYPT, SQL_TRUST_SERVER_CERTIFICATE, SQL_CA_CERT_PATH,
#   SQL_CONNECT_TIMEOUT_SECONDS                sqlconn.py -- SQL_PASSWORD is a
#                                               Secret Manager-backed secret
#                                               reference in the Cloud Run Job
#                                               spec (--set-secrets), never a
#                                               plain env var value in
#                                               production; see deploy/cloudsql.md
#   ELASTIC_URL, ELASTIC_INDEX, ELASTIC_API_KEY / ELASTIC_USER+ELASTIC_PASSWORD,
#   ELASTIC_VERIFY_TLS, FROM_DATE, TO_DATE, FIELD_MAP_JSON, PAGE_SIZE,
#   BP_WORKTIME_UNIT, ELASTIC_WATERMARK_OVERLAP_HOURS   elastic_to_csv.py
#     (needed only when BP_ADAPTER=elastic; ELASTIC_API_KEY / the
#     ELASTIC_USER+ELASTIC_PASSWORD pair is also Secret Manager-backed)
#   BP_AUTH_URL, BP_CLIENT_ID, BP_CLIENT_SECRET, BP_API_URL, BP_OAUTH_SCOPE,
#   BP_QUEUE_NAMES, BP_PAGE_SIZE, WATERMARK_OVERLAP_HOURS, BP_SINCE,
#   BP_WORKTIME_UNIT, BP_FIELD_MAP_JSON, BP_REQUEST_TIMEOUT, BP_MAX_RETRIES,
#   BP_VERIFY_TLS         bp_api_to_csv.py (needed only when BP_ADAPTER=api;
#                         BP_CLIENT_SECRET is also Secret Manager-backed)
# BP_STATE_FILE is deliberately NOT set here: when SQL_* is fully configured
# (the Cloud Run Job's normal production mode), bp_api_to_csv.py ignores it
# entirely in favour of core.IngestWatermark (see that script's docstring);
# it only matters for a non-SQL manual run, where its own default
# (./bp_api_watermark.json, relative to /app/work if you `cd` there) is fine.
ENV BP_ADAPTER=elastic

ENTRYPOINT ["python", "run_pipeline.py"]
