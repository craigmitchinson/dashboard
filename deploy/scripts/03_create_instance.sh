#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 03_create_instance.sh — create the Cloud SQL for SQL Server instance,
# database and app login. Idempotent (checks for existence before each
# create). Run 02_network.sh first.
#
# EDITION/VERSION: see env.sh.example's comment on SQL_EDITION/
# SQL_DATABASE_VERSION for the verified edition/pricing rationale.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

ROOT_PASSWORD_FILE="$(mktemp)"
trap 'rm -f "$ROOT_PASSWORD_FILE"' EXIT

if ! gcloud sql instances describe "$SQL_INSTANCE_NAME" >/dev/null 2>&1; then
    echo "Generating a random sqlserver admin (sa-equivalent) password..."
    # Cloud SQL for SQL Server's built-in admin login is literally "sqlserver".
    openssl rand -base64 24 > "$ROOT_PASSWORD_FILE"

    gcloud sql instances create "$SQL_INSTANCE_NAME" \
        --database-version="$SQL_DATABASE_VERSION" \
        --edition="$SQL_EDITION" \
        --tier="$SQL_TIER" \
        --region="$REGION" \
        --storage-size="$SQL_STORAGE_SIZE_GB" \
        --storage-auto-increase \
        --network="projects/${PROJECT_ID}/global/networks/${NETWORK_NAME}" \
        --no-assign-ip \
        --root-password="$(cat "$ROOT_PASSWORD_FILE")"

    # Store the admin password in Secret Manager immediately — never leave
    # it only in the temp file / shell history.
    if ! gcloud secrets describe "$SQL_ROOT_PASSWORD_SECRET_NAME" >/dev/null 2>&1; then
        gcloud secrets create "$SQL_ROOT_PASSWORD_SECRET_NAME" --data-file="$ROOT_PASSWORD_FILE"
    else
        gcloud secrets versions add "$SQL_ROOT_PASSWORD_SECRET_NAME" --data-file="$ROOT_PASSWORD_FILE"
    fi
    echo "sqlserver admin password stored in Secret Manager: $SQL_ROOT_PASSWORD_SECRET_NAME"
else
    echo "instance $SQL_INSTANCE_NAME already exists, skipping create"
fi

# --no-assign-ip above means this instance has ONLY a private IP — correct
# for the Cloud Run Job's connectivity (see 02_network.sh's comment), but it
# also means sqlcmd from Cloud Shell needs the Cloud SQL Auth Proxy (which
# works over private IP too, from a resource on the same VPC — e.g. a small
# bastion Compute Engine VM on $NETWORK_NAME/$SUBNET_NAME) rather than a
# direct public-IP + authorized-networks connection. See deploy/cloudsql.md's
# "running the bootstrap scripts" section for both options, including the
# public-IP alternative if you'd rather open one up temporarily for the
# initial bootstrap only.

if ! gcloud sql databases describe "$SQL_DATABASE_NAME" --instance="$SQL_INSTANCE_NAME" >/dev/null 2>&1; then
    # 01_database_and_schemas.sql also does `CREATE DATABASE BPAnalytics`
    # itself (idempotent, IF DB_ID(...) IS NULL) — creating it here too is
    # redundant but harmless, and lets this script be the one place that
    # provisions the full instance+db+user trio in one pass without having
    # already run any .sql script yet.
    gcloud sql databases create "$SQL_DATABASE_NAME" --instance="$SQL_INSTANCE_NAME"
else
    echo "database $SQL_DATABASE_NAME already exists, skipping create"
fi

APP_PASSWORD_FILE="$(mktemp)"
trap 'rm -f "$APP_PASSWORD_FILE" "$ROOT_PASSWORD_FILE"' EXIT

if ! gcloud sql users list --instance="$SQL_INSTANCE_NAME" --format="value(name)" | grep -qx "$SQL_APP_USER"; then
    openssl rand -base64 24 > "$APP_PASSWORD_FILE"
    gcloud sql users create "$SQL_APP_USER" \
        --instance="$SQL_INSTANCE_NAME" \
        --password="$(cat "$APP_PASSWORD_FILE")"

    if ! gcloud secrets describe "$SQL_APP_PASSWORD_SECRET_NAME" >/dev/null 2>&1; then
        gcloud secrets create "$SQL_APP_PASSWORD_SECRET_NAME" --data-file="$APP_PASSWORD_FILE"
    else
        gcloud secrets versions add "$SQL_APP_PASSWORD_SECRET_NAME" --data-file="$APP_PASSWORD_FILE"
    fi
    echo "app login password stored in Secret Manager: $SQL_APP_PASSWORD_SECRET_NAME"

    # A fresh SQL Server login has no permissions on BPAnalytics yet — grant
    # db_owner so it can run 01-12's DDL during bootstrap AND the pipeline's
    # DML/EXECs afterwards. Tighten this later (e.g. to db_datareader +
    # EXECUTE on core.usp_RunPull/core.usp_GetInFlightRun + db_datawriter on
    # just raw/staging/core.PipelineRun/core.IngestWatermark) once the
    # bootstrap is done and you want least-privilege for the steady-state
    # ingest job login — see deploy/cloudsql.md's hardening note.
    # The actual GRANT happens in 05_bootstrap_schema.sh's step 0 — it needs
    # an authenticated sqlcmd session against the instance, not a gcloud
    # call, so it lives there rather than here.
    echo "Login created. 05_bootstrap_schema.sh will grant it db_owner on $SQL_DATABASE_NAME."
else
    echo "login $SQL_APP_USER already exists, skipping create"
fi

INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(connectionName)')"
PRIVATE_IP="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(ipAddresses[0].ipAddress)')"

echo "Instance ready."
echo "  connectionName : $INSTANCE_CONNECTION_NAME"
echo "  private IP     : $PRIVATE_IP"
echo "Save these — 05_bootstrap_schema.sh and 06_deploy_ingest_job.sh both need them."
