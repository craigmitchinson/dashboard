#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 07_scheduler.sh — Cloud Scheduler job that triggers one execution of the
# ingest Cloud Run Job on a cron schedule.
#
# VERIFIED PATTERN: Cloud Run Jobs (unlike Cloud Run services) have no HTTPS
# invocation URL of their own — they're triggered via the Cloud Run Admin
# API's `:run` method. Cloud Scheduler's HTTP target calls that API
# endpoint directly (https://run.googleapis.com/v2/projects/.../jobs/...:run)
# with an OAuth2 token (Google's own gcloud reference for
# `scheduler jobs create http` documents --oauth-service-account-email
# specifically for calling *.googleapis.com APIs, as opposed to
# --oidc-service-account-email which is for a custom Cloud Run *service*
# URL) — this is NOT the same as the --add-cloudsql-instances-style
# "trigger a Cloud Run *service*" pattern; a Job needs this Admin-API call
# instead.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

SCHEDULER_JOB_NAME="${INGEST_JOB_NAME}-scheduler"
SCHEDULER_SA_NAME="bp-ingest-scheduler"
SCHEDULER_SA_EMAIL="${SCHEDULER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$SCHEDULER_SA_EMAIL" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SCHEDULER_SA_NAME" \
        --display-name="Cloud Scheduler -> bp-ingest-pull Cloud Run Job trigger"
fi

# The scheduler's service account needs Cloud Run Invoker on THIS JOB
# specifically (least privilege — not a project-wide role) to call :run.
gcloud run jobs add-iam-policy-binding "$INGEST_JOB_NAME" \
    --region="$REGION" \
    --member="serviceAccount:${SCHEDULER_SA_EMAIL}" \
    --role="roles/run.invoker"

RUN_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${INGEST_JOB_NAME}:run"

if gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --location="$REGION" >/dev/null 2>&1; then
    ACTION="update"
else
    ACTION="create"
fi

gcloud scheduler jobs "$ACTION" http "$SCHEDULER_JOB_NAME" \
    --location="$REGION" \
    --schedule="$INGEST_SCHEDULE" \
    --uri="$RUN_URI" \
    --http-method=POST \
    --oauth-service-account-email="$SCHEDULER_SA_EMAIL" \
    --time-zone="Etc/UTC"

echo "Scheduler $ACTION'd: $SCHEDULER_JOB_NAME (schedule: $INGEST_SCHEDULE, UTC)"
echo "Test it once manually: gcloud scheduler jobs run $SCHEDULER_JOB_NAME --location=$REGION"
echo "Then watch the run: gcloud run jobs executions list --job=$INGEST_JOB_NAME --region=$REGION"
echo
echo "Deployment complete. See deploy/gcp.md's 'first real data pull' runbook to validate end to end."
