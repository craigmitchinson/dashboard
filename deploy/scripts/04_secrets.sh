#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 04_secrets.sh — create the Secret Manager entries the ingest job needs
# beyond the two SQL passwords 03_create_instance.sh already stored
# (bp-sql-root-password, bp-sql-app-password): the chosen adapter's own
# credential(s), and the ingest job's service account with access to all of
# it.
#
# Prompts interactively for secret VALUES (never takes them as CLI args —
# CLI args land in shell history / process listings). Re-run safely: adds a
# new secret VERSION each time rather than failing on "already exists".
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

create_or_add_version() {
    local secret_name="$1"
    local prompt_label="$2"
    read -r -s -p "$prompt_label: " secret_value
    echo
    if [ -z "$secret_value" ]; then
        echo "  (empty value entered, skipping $secret_name)"
        return
    fi
    if ! gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
        printf '%s' "$secret_value" | gcloud secrets create "$secret_name" --data-file=-
    else
        printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=-
    fi
    echo "  stored: $secret_name"
}

case "$BP_ADAPTER" in
    elastic)
        echo "BP_ADAPTER=elastic — collecting the Elastic API key."
        create_or_add_version "$ELASTIC_API_KEY_SECRET_NAME" "Elastic API key (ELASTIC_API_KEY)"
        ;;
    api)
        echo "BP_ADAPTER=api — collecting the Blue Prism OAuth2 client secret."
        create_or_add_version "$BP_CLIENT_SECRET_SECRET_NAME" "Blue Prism OAuth2 client secret (BP_CLIENT_SECRET)"
        ;;
    *)
        echo "error: env.sh's BP_ADAPTER must be 'elastic' or 'api', got '$BP_ADAPTER'" >&2
        exit 1
        ;;
esac

# --- Service account for the ingest Cloud Run Job ---
if ! gcloud iam service-accounts describe "$INGEST_SERVICE_ACCOUNT_EMAIL" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$INGEST_SERVICE_ACCOUNT_NAME" \
        --display-name="BP ingest pipeline Cloud Run Job"
else
    echo "service account $INGEST_SERVICE_ACCOUNT_EMAIL already exists, skipping create"
fi

# Cloud SQL Client: required to establish the Cloud SQL connection (see
# deploy/cloudsql.md's connectivity section) even though the actual DB auth
# is username/password, not IAM — Cloud SQL for SQL Server does NOT support
# IAM database authentication (verified: Google's docs state IAM auth for
# Cloud SQL for SQL Server covers instance/backup operations only, not
# database logins), so this role is about permission to USE the Cloud SQL
# connection infrastructure, not about logging into the database itself.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${INGEST_SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/cloudsql.client" \
    --condition=None

# Secret accessor on exactly the secrets this job needs — least privilege,
# not a project-wide secretAccessor grant.
for secret in "$SQL_APP_PASSWORD_SECRET_NAME" "$ELASTIC_API_KEY_SECRET_NAME" "$BP_CLIENT_SECRET_SECRET_NAME"; do
    if gcloud secrets describe "$secret" >/dev/null 2>&1; then
        gcloud secrets add-iam-policy-binding "$secret" \
            --member="serviceAccount:${INGEST_SERVICE_ACCOUNT_EMAIL}" \
            --role="roles/secretmanager.secretAccessor" \
            --condition=None
    fi
done

echo "Secrets + service account ready. Next: 05_bootstrap_schema.sh."
