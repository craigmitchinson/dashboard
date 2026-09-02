#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 06_deploy_ingest_job.sh — build the ingest container and deploy/update the
# Cloud Run Job. Re-run any time bp-sql-layer/ingest/ changes.
#
# CLOUD SQL CONNECTIVITY, VERIFIED (see deploy/cloudsql.md's citations):
# Cloud Run CANNOT reach Cloud SQL for SQL Server over public IP at all —
# only private IP + Direct VPC egress (or a Serverless VPC Access connector)
# works. This script uses Direct VPC egress (--network/--subnet/--vpc-egress,
# no separate connector resource to provision) onto the same VPC
# 02_network.sh created, plus --set-cloudsql-instances so the platform wires
# up the Cloud SQL connection metadata Google's own quickstart pairs with
# Direct VPC egress for this exact scenario.
#
# --vpc-egress=private-ranges-only (not Google's quickstart example value of
# all-traffic): this job ALSO needs plain internet egress for the chosen
# adapter's own API (Elastic, or the Blue Prism Auth Server/Web API) and for
# Secret Manager/Artifact Registry. private-ranges-only routes ONLY
# RFC1918-private-address-bound traffic (i.e. the Cloud SQL private IP)
# through the VPC and leaves everything else on Cloud Run's normal internet
# path — no Cloud NAT to provision. all-traffic would route EVERYTHING
# (including the adapter's internet calls) through this VPC, which then
# requires a Cloud NAT gateway for that traffic to reach the internet at
# all (a private subnet has no route to the internet on its own) — only
# switch to all-traffic (and add Cloud NAT) if you specifically need this
# job's outbound IP to be static/allowlistable at the Elastic/BP API side.
#
# CONCURRENCY: --max-retries=0 and --task-count=1 are set deliberately —
# this pipeline's OWN in-flight guard (run_pipeline.py's
# check_in_flight_guard(), backed by core.usp_GetInFlightRun — see
# 11_pipeline_ops.sql) is the real "never overlap pulls" mechanism (Cloud
# Run Jobs/Scheduler have no built-in "skip if still running" the way a
# Kubernetes CronJob's concurrencyPolicy: Forbid does), so an automatic
# platform-level retry of a genuinely slow-but-still-succeeding run would
# just create exactly the overlapping-run risk the in-flight guard exists to
# prevent — better to let a failed run fail, get logged in core.PipelineRun
# as Status='failed', and be picked up cleanly by the NEXT scheduled
# invocation 15 minutes later.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

REPO_NAME="bp-ingest"
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$REPO_NAME" \
        --repository-format=docker \
        --location="$REGION" \
        --description="BP ingest pipeline job image"
fi

echo "Building and pushing $INGEST_IMAGE..."
# `--tag` (no `--config`) tells Cloud Build to synthesize a single-step
# "docker build" from whatever Dockerfile it finds in the submitted context
# directory — bp-sql-layer/ingest/Dockerfile, which is exactly the build
# context this points at (matching the `docker build` invocation documented
# in that Dockerfile's own header comment).
gcloud builds submit --tag "$INGEST_IMAGE" ../../bp-sql-layer/ingest

INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(connectionName)')"
PRIVATE_IP="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(ipAddresses[0].ipAddress)')"

# Secrets referenced by name:version=latest — Cloud Run resolves them at
# container start via the Secret Manager API, using the job's own service
# account (granted roles/secretmanager.secretAccessor in 04_secrets.sh).
SECRET_FLAGS=(--set-secrets "SQL_PASSWORD=${SQL_APP_PASSWORD_SECRET_NAME}:latest")
if [ "$BP_ADAPTER" = "elastic" ]; then
    SECRET_FLAGS+=(--set-secrets "ELASTIC_API_KEY=${ELASTIC_API_KEY_SECRET_NAME}:latest")
elif [ "$BP_ADAPTER" = "api" ]; then
    SECRET_FLAGS+=(--set-secrets "BP_CLIENT_SECRET=${BP_CLIENT_SECRET_SECRET_NAME}:latest")
fi

# Non-secret env vars. Add the chosen adapter's own non-secret config here
# (ELASTIC_URL/ELASTIC_INDEX, or BP_AUTH_URL/BP_CLIENT_ID/BP_API_URL/
# BP_QUEUE_NAMES) — left as placeholders below; fill in your real values.
ENV_VARS="BP_ADAPTER=${BP_ADAPTER}"
ENV_VARS="${ENV_VARS},SQL_SERVER=${PRIVATE_IP},SQL_DATABASE=${SQL_DATABASE_NAME},SQL_USER=${SQL_APP_USER}"
ENV_VARS="${ENV_VARS},SQL_TRUST_SERVER_CERTIFICATE=no"
# ENV_VARS="${ENV_VARS},ELASTIC_URL=https://your-elastic:9200,ELASTIC_INDEX=bp-workqueueitems-*"
# ENV_VARS="${ENV_VARS},BP_AUTH_URL=...,BP_CLIENT_ID=...,BP_API_URL=...,BP_QUEUE_NAMES=..."

if gcloud run jobs describe "$INGEST_JOB_NAME" --region="$REGION" >/dev/null 2>&1; then
    ACTION="update"
else
    ACTION="create"
fi

gcloud run jobs "$ACTION" "$INGEST_JOB_NAME" \
    --region="$REGION" \
    --image="$INGEST_IMAGE" \
    --service-account="$INGEST_SERVICE_ACCOUNT_EMAIL" \
    --network="$NETWORK_NAME" \
    --subnet="$SUBNET_NAME" \
    --vpc-egress=private-ranges-only \
    --set-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
    --set-env-vars="$ENV_VARS" \
    "${SECRET_FLAGS[@]}" \
    --max-retries=0 \
    --task-count=1 \
    --parallelism=1 \
    --tasks=1 \
    --cpu=1 \
    --memory=512Mi \
    --task-timeout=600

echo "Ingest job $ACTION'd: $INGEST_JOB_NAME"
echo "Test it once manually before scheduling: gcloud run jobs execute $INGEST_JOB_NAME --region=$REGION --wait"
echo "Next: 07_scheduler.sh."
