#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 05_bootstrap_schema.sh — run bp-sql-layer/scripts/01 through 12, IN ORDER,
# against the Cloud SQL for SQL Server instance, via sqlcmd through the
# Cloud SQL Auth Proxy. Run once, after 01-04. Safe to re-run (every script
# 01-12 is idempotent by design — see each script's own header comment).
#
# CONNECTIVITY METHOD CHOSEN, VERIFIED (see deploy/cloudsql.md for the full
# citations): the Cloud SQL Auth Proxy is Google's own recommended
# connection method ("Using the Cloud SQL Auth Proxy is the recommended
# method for connecting to a Cloud SQL instance" — docs.cloud.google.com/
# sql/docs/sqlserver/connect-auth-proxy), and it works over the instance's
# PUBLIC IP without needing an authorized-networks entry for this machine's
# address (unlike a bare `sqlcmd -S <public-ip>` connection) — it
# authenticates via your gcloud/IAM credentials and wraps the connection in
# TLS itself. 03_create_instance.sh deliberately created the instance with
# --no-assign-ip (private-IP-only, correct for steady-state Cloud Run
# connectivity — see 02_network.sh's comment), so THIS SCRIPT TEMPORARILY
# assigns a public IP purely so the Auth Proxy (run from wherever you invoke
# this script — Cloud Shell or a laptop with gcloud installed, no VPC
# peering/bastion needed for this one-time bootstrap) can reach it, then
# REMOVES the public IP again at the end, whether the run succeeded or
# failed (see the trap below). The database itself is never reachable
# without valid IAM credentials + the Auth Proxy during the (usually a
# minute or two) window the public IP is assigned.
#
# ALTERNATIVE (documented, not scripted here): if you'd rather never assign
# a public IP even temporarily, stand up a small Compute Engine VM on
# $NETWORK_NAME/$SUBNET_NAME (same VPC as the instance's private IP), install
# the Cloud SQL Auth Proxy + mssql-tools18 there, `gcloud compute ssh
# --tunnel-through-iap` to it, and run this same sqlcmd sequence from inside
# it against the private IP instead. See deploy/cloudsql.md's "bastion
# alternative" section for the exact steps.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

SCRIPTS_DIR="../../bp-sql-layer/scripts"
PROXY_PORT=1433
PROXY_PID=""
PUBLIC_IP_ASSIGNED=0

cleanup() {
    if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
        kill "$PROXY_PID" 2>/dev/null || true
    fi
    if [ "$PUBLIC_IP_ASSIGNED" -eq 1 ]; then
        echo "Removing the temporary public IP from $SQL_INSTANCE_NAME..."
        gcloud sql instances patch "$SQL_INSTANCE_NAME" --no-assign-ip --quiet || \
            echo "WARNING: failed to remove the temporary public IP — remove it manually: gcloud sql instances patch $SQL_INSTANCE_NAME --no-assign-ip"
    fi
}
trap cleanup EXIT

# --- sqlcmd availability (mssql-tools18) ---
if ! command -v sqlcmd >/dev/null 2>&1; then
    echo "sqlcmd not found — installing mssql-tools18 (Debian/Cloud Shell path; see"
    echo "learn.microsoft.com's Linux ODBC driver install docs, same repo this"
    echo "project's ingest/Dockerfile uses)."
    curl -sSL -O https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb
    sudo dpkg -i packages-microsoft-prod.deb
    rm packages-microsoft-prod.deb
    sudo apt-get update
    sudo ACCEPT_EULA=Y apt-get install -y mssql-tools18 unixodbc-dev
    export PATH="$PATH:/opt/mssql-tools18/bin"
fi

# --- cloud-sql-proxy availability ---
if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
    echo "cloud-sql-proxy not found — downloading it."
    curl -sSL -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.linux.amd64
    chmod +x cloud-sql-proxy
    PATH="$PWD:$PATH"
fi

INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(connectionName)')"

echo "Temporarily assigning a public IP to $SQL_INSTANCE_NAME for the Auth Proxy..."
gcloud sql instances patch "$SQL_INSTANCE_NAME" --assign-ip --quiet
PUBLIC_IP_ASSIGNED=1

echo "Starting Cloud SQL Auth Proxy for $INSTANCE_CONNECTION_NAME on 127.0.0.1:${PROXY_PORT}..."
cloud-sql-proxy --port "$PROXY_PORT" "$INSTANCE_CONNECTION_NAME" &
PROXY_PID=$!

# Wait for the proxy's local listener to come up (poll, don't sleep-and-hope).
for _ in $(seq 1 30); do
    if (echo > "/dev/tcp/127.0.0.1/${PROXY_PORT}") >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

SQLSERVER_ADMIN_PASSWORD="$(gcloud secrets versions access latest --secret="$SQL_ROOT_PASSWORD_SECRET_NAME")"
APP_USER_PASSWORD="$(gcloud secrets versions access latest --secret="$SQL_APP_PASSWORD_SECRET_NAME")"

run_sqlcmd() {
    sqlcmd -S "127.0.0.1,${PROXY_PORT}" -U sqlserver -P "$SQLSERVER_ADMIN_PASSWORD" \
        -C -N -l 30 "$@"
}

echo "Step 0: granting db_owner on $SQL_DATABASE_NAME to $SQL_APP_USER..."
run_sqlcmd -Q "USE ${SQL_DATABASE_NAME}; IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${SQL_APP_USER}') CREATE USER [${SQL_APP_USER}] FOR LOGIN [${SQL_APP_USER}]; ALTER ROLE db_owner ADD MEMBER [${SQL_APP_USER}];"

for n in 01 02 03 04 05 06 07 08 09 10 11 12; do
    script_path=$(ls "${SCRIPTS_DIR}/${n}_"*.sql 2>/dev/null | head -1)
    if [ "$n" = "10" ]; then
        echo "Skipping ${script_path} (10_bulk_load_csv.sql — the on-prem/self-managed"
        echo "BULK INSERT alternative, NOT applicable to Cloud SQL; see its own header"
        echo "comment. Production data loading uses bp-sql-layer/ingest/load_to_sql.py"
        echo "via the Cloud Run Job instead, not a bootstrap-time script.)"
        continue
    fi
    if [ -z "$script_path" ]; then
        echo "WARNING: no script found matching ${SCRIPTS_DIR}/${n}_*.sql, skipping"
        continue
    fi
    echo "Running $script_path..."
    run_sqlcmd -i "$script_path"
done

echo "Schema bootstrap complete. Scripts 01-09, 11, 12 ran; 10 was skipped (see above)."
echo "Next: 06_deploy_ingest_job.sh."
