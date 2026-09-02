#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 08_deploy_api.sh — build the data API container (server/Dockerfile) and
# deploy/update its Cloud Run SERVICE. Shared by BOTH topologies documented
# in deploy/gcp.md (nginx-proxy default, and the Load Balancer alternative
# in 10_deploy_loadbalancer.sh) — this script only stands the API up; which
# script fronts it (09 or 10) is a separate decision.
#
# CLOUD SQL CONNECTIVITY: identical reasoning to 06_deploy_ingest_job.sh —
# Cloud Run cannot reach Cloud SQL for SQL Server over public IP at all, only
# private IP + Direct VPC egress works, and this reuses the SAME VPC/subnet
# 02_network.sh created for the ingest job rather than provisioning a second
# network (see deploy/gcp.md's topology diagram). --vpc-egress=private-ranges-only
# for the same reason as that script: the API's own outbound calls (Entra
# JWKS fetch, Secret Manager, Artifact Registry) need plain internet egress,
# which private-ranges-only leaves on Cloud Run's normal path instead of
# forcing everything through this VPC (which would then need a Cloud NAT).
#
# NETWORK EXPOSURE: this deploys with --allow-unauthenticated (the API's
# Cloud Run URL is publicly reachable) but AUTH_MODE=entra, so every request
# still requires a valid Entra-issued Bearer JWT scoped to ENTRA_AUDIENCE —
# see server/src/auth/middleware.ts. This is the deliberate "small team"
# trade-off documented in deploy/gcp.md's topology section: it keeps
# 09_deploy_frontend.sh's nginx proxy_pass simple (a plain HTTPS reverse
# proxy, no per-request ID-token minting) at the cost of the API's network
# boundary being enforced by the application, not the platform. The
# alternative in 10_deploy_loadbalancer.sh removes public reachability
# entirely (--ingress internal-and-cloud-load-balancing) — see that script
# and deploy/gcp.md for why it's the recommended PRODUCTION topology instead.
#
# CONFIG.TS'S OWN PRODUCTION GUARD (see server/src/config.ts) refuses to
# start at all with AUTH_MODE=dev or AUTH_MODE=none when NODE_ENV=production
# — this script does not need to re-enforce that, the container does it on
# every boot.
#
# HEALTH CHECK: Cloud Run's built-in startup/liveness probe (a TCP check on
# $PORT) already gates traffic on the container actually listening — that is
# NOT the same as GET /api/health (which additionally reports lastPullAt/dbOk
# by querying core.PipelineRun). Wiring /api/health into an actual
# Cloud Monitoring uptime check + alerting policy is a deliberate follow-up,
# not scripted here (it needs notification-channel decisions this script
# shouldn't guess at) — see deploy/gcp.md's rollout section.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

REPO_NAME="bp-api"
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$REPO_NAME" \
        --repository-format=docker \
        --location="$REGION" \
        --description="Intelligent Automation dashboard data API image"
fi

echo "Building and pushing $API_IMAGE..."
# `--tag` (no `--config`) synthesizes a single-step "docker build" from
# server/Dockerfile — matching the API container contract's own build
# invocation (node:22-alpine, listens on $PORT, default 8080).
gcloud builds submit --tag "$API_IMAGE" ../../server

if ! gcloud iam service-accounts describe "$API_SERVICE_ACCOUNT_EMAIL" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$API_SERVICE_ACCOUNT_NAME" \
        --display-name="Intelligent Automation dashboard data API"
else
    echo "service account $API_SERVICE_ACCOUNT_EMAIL already exists, skipping create"
fi

# roles/cloudsql.client: see 04_secrets.sh's comment on this same grant for
# the ingest job — permission to USE the Cloud SQL connection plumbing
# alongside Direct VPC egress, not DB login (SQL Server has no IAM DB auth).
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${API_SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/cloudsql.client" \
    --condition=None

# Secret accessor on exactly the SQL app password — least privilege, not a
# project-wide grant. The API reads BPAnalytics with the SAME login the
# ingest job writes with ($SQL_APP_USER) by default; see deploy/cloudsql.md
# section 7's hardening note on splitting this into a narrower, read-mostly
# login for the API specifically (SELECT on report.vw_*/core.PipelineRun,
# plus whatever PUT /api/reference's write path needs) once you're ready to
# tighten it beyond this prototype's shared db_owner login.
if gcloud secrets describe "$SQL_APP_PASSWORD_SECRET_NAME" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$SQL_APP_PASSWORD_SECRET_NAME" \
        --member="serviceAccount:${API_SERVICE_ACCOUNT_EMAIL}" \
        --role="roles/secretmanager.secretAccessor" \
        --condition=None
else
    echo "WARNING: secret $SQL_APP_PASSWORD_SECRET_NAME not found — run 03_create_instance.sh first" >&2
    exit 1
fi

INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(connectionName)')"
PRIVATE_IP="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(ipAddresses[0].ipAddress)')"

# AUTH_MODE=entra requires ENTRA_TENANT_ID/ENTRA_AUDIENCE — see
# server/src/config.ts's throw if they're missing. See deploy/gcp.md's
# "Entra app registration" section for where these values come from.
if [ "$AUTH_MODE" = "entra" ] && { [ -z "${ENTRA_TENANT_ID:-}" ] || [ -z "${ENTRA_AUDIENCE:-}" ]; }; then
    echo "error: env.sh's AUTH_MODE=entra requires ENTRA_TENANT_ID and ENTRA_AUDIENCE to be set" >&2
    exit 1
fi

ENV_VARS="NODE_ENV=production,AUTH_MODE=${AUTH_MODE},DATA_SOURCE=sql,LOG_LEVEL=${API_LOG_LEVEL}"
ENV_VARS="${ENV_VARS},SQL_SERVER=${PRIVATE_IP},SQL_PORT=1433,SQL_DATABASE=${SQL_DATABASE_NAME},SQL_USER=${SQL_APP_USER}"
ENV_VARS="${ENV_VARS},SQL_ENCRYPT=true,SQL_TRUST_CERT=false"
if [ "$AUTH_MODE" = "entra" ]; then
    ENV_VARS="${ENV_VARS},ENTRA_TENANT_ID=${ENTRA_TENANT_ID},ENTRA_AUDIENCE=${ENTRA_AUDIENCE}"
fi
# CORS_ORIGIN: NOT set here even though server/README.md's "Integration
# notes for other workers" lists it as a deploy-time var — this is a
# chicken-and-egg problem (it should be the frontend's OWN origin, which
# doesn't exist until the frontend is deployed AFTER this script runs).
# 09_deploy_frontend.sh / 10_deploy_loadbalancer.sh both patch it in via
# `gcloud run services update --update-env-vars` immediately after their own
# deploy — see their comments. Set API_CORS_ORIGIN here only for a manual
# override (e.g. a known custom domain decided ahead of time).
if [ -n "${API_CORS_ORIGIN:-}" ]; then
    ENV_VARS="${ENV_VARS},CORS_ORIGIN=${API_CORS_ORIGIN}"
fi

if gcloud run services describe "$API_SERVICE_NAME" --region="$REGION" >/dev/null 2>&1; then
    ACTION="update"
else
    ACTION="deploy"
fi

gcloud run "$ACTION" "$API_SERVICE_NAME" \
    --region="$REGION" \
    --image="$API_IMAGE" \
    --service-account="$API_SERVICE_ACCOUNT_EMAIL" \
    --network="$NETWORK_NAME" \
    --subnet="$SUBNET_NAME" \
    --vpc-egress=private-ranges-only \
    --set-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
    --set-env-vars="$ENV_VARS" \
    --set-secrets="SQL_PASSWORD=${SQL_APP_PASSWORD_SECRET_NAME}:latest" \
    --port=8080 \
    --min-instances="$API_MIN_INSTANCES" \
    --max-instances="$API_MAX_INSTANCES" \
    --concurrency="$API_CONCURRENCY" \
    --cpu=1 \
    --memory=512Mi \
    --timeout=60 \
    --allow-unauthenticated \
    --quiet

API_URL="$(gcloud run services describe "$API_SERVICE_NAME" --region="$REGION" --format='value(status.url)')"
echo "API service $ACTION'd: $API_SERVICE_NAME"
echo "  URL: $API_URL"
echo "Smoke-test it: curl -s ${API_URL}/api/health   (no auth required — see server/README.md)"
echo "Next: 09_deploy_frontend.sh (nginx-proxy default) or 10_deploy_loadbalancer.sh (production LB topology) — see deploy/gcp.md."
