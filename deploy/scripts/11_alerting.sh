#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 11_alerting.sh — Cloud Monitoring alerting for the ingest Cloud Run Job
# ($INGEST_JOB_NAME), so a broken pipeline is a page, not something someone
# notices three days later because the dashboard's header dot went amber.
# Complements, doesn't replace, GET /api/health's `lastRun`/`stale` fields
# (server/src/routes/health.ts) and the Data health block (src/pages/admin/
# DataSyncSection.tsx) that already surface the SAME underlying facts
# in-app — this script is for when nobody's looking at the dashboard.
#
# TWO LOG-BASED ALERT POLICIES, both driven by run_pipeline.py's own
# structured JSON stdout (see that script's log_event()/EXIT CODES doc —
# every failure path it takes logs an event, whatever the exit code: 1
# config, 2 adapter subprocess, 3 CSV/SQL, 4 reject-rate-exceeded):
#
#   1. bp-ingest-run-failed        -- fires the moment ANY execution logs a
#      failure event (jsonPayload.event is "pipeline_failed" or
#      "config_error") -- i.e. "this execution finished with a non-zero
#      exit". A conditionMatchedLog condition: no polling delay, alerts on
#      the log entry itself.
#   2. bp-ingest-no-recent-success -- a LOG-ABSENCE condition: fires when
#      NO "pipeline_success" event has been logged for 60 minutes straight
#      -- catches the failure mode #1 CAN'T: the job silently stops being
#      invoked at all (Cloud Scheduler misconfigured/paused/deleted), or a
#      container-level crash (OOM, an uncaught exception before
#      run_pipeline.py's own try/except runs) that never reaches ANY
#      log_event() call, non-zero exit or not. Implemented as a
#      logs-based metric (count of "pipeline_success" events) plus a
#      conditionAbsent condition on that metric -- Cloud Monitoring's
#      alerting API has no standalone "log absence" condition type; a
#      metric absence condition on a logs-derived metric is the documented
#      way to express one (see Google's "Monitor absence of log entries"
#      guide).
#
# Both notify the single email address in ALERT_EMAIL (env.sh) via one
# shared notification channel (created once, reused by both policies).
#
# IDEMPOTENT: safe to re-run. Skips creating a resource (metric, channel,
# or policy) that already exists by name/displayName rather than erroring
# OR silently duplicating it -- this script does not attempt to reconcile
# an existing policy's CONTENTS if you hand-edited it in the console;
# delete it first if you want this script's version reinstated.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

if [ -z "${ALERT_EMAIL:-}" ]; then
    echo "error: ALERT_EMAIL is not set in env.sh -- add a line like:" >&2
    echo '  ALERT_EMAIL="oncall@example.com"' >&2
    exit 1
fi

SUCCESS_METRIC_NAME="bp_ingest_pipeline_success"
FAILED_POLICY_DISPLAY_NAME="bp-ingest-run-failed"
ABSENCE_POLICY_DISPLAY_NAME="bp-ingest-no-recent-success"
CHANNEL_DISPLAY_NAME="bp-ingest-alerts-email"

# --- 1. Logs-based metric: counts "pipeline_success" events, one per
#        successful ingest run -- the input the absence condition below
#        watches. ---
if ! gcloud logging metrics describe "$SUCCESS_METRIC_NAME" >/dev/null 2>&1; then
    gcloud logging metrics create "$SUCCESS_METRIC_NAME" \
        --description="Count of successful bp-ingest-pull runs (run_pipeline.py's pipeline_success log event)." \
        --log-filter="resource.type=\"cloud_run_job\" resource.labels.job_name=\"${INGEST_JOB_NAME}\" jsonPayload.event=\"pipeline_success\""
    echo "Created logs-based metric: $SUCCESS_METRIC_NAME"
else
    echo "Logs-based metric already exists, leaving as-is: $SUCCESS_METRIC_NAME"
fi

# --- 2. Notification channel (email) -- created once, reused by both
#        policies below. ---
EXISTING_CHANNEL="$(gcloud alpha monitoring channels list \
    --filter="displayName=\"${CHANNEL_DISPLAY_NAME}\"" \
    --format='value(name)' | head -n1)"

if [ -z "$EXISTING_CHANNEL" ]; then
    CHANNEL_NAME="$(gcloud alpha monitoring channels create \
        --display-name="$CHANNEL_DISPLAY_NAME" \
        --type=email \
        --channel-labels="email_address=${ALERT_EMAIL}" \
        --format='value(name)')"
    echo "Created notification channel: $CHANNEL_NAME ($ALERT_EMAIL)"
else
    CHANNEL_NAME="$EXISTING_CHANNEL"
    echo "Notification channel already exists, reusing: $CHANNEL_NAME"
fi

# --- 3. Alert policy: any execution finishing with a non-zero exit. ---
if ! gcloud alpha monitoring policies list \
    --filter="displayName=\"${FAILED_POLICY_DISPLAY_NAME}\"" \
    --format='value(name)' | grep -q .; then

    FAILED_POLICY_JSON="$(mktemp)"
    cat > "$FAILED_POLICY_JSON" <<EOF
{
  "displayName": "${FAILED_POLICY_DISPLAY_NAME}",
  "documentation": {
    "content": "bp-ingest-pull finished with a non-zero exit (see run_pipeline.py's EXIT CODES doc for what each code means). Check the execution's logs: gcloud run jobs executions list --job=${INGEST_JOB_NAME} --region=${REGION}",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "pipeline_failed or config_error logged",
      "conditionMatchedLog": {
        "filter": "resource.type=\"cloud_run_job\" resource.labels.job_name=\"${INGEST_JOB_NAME}\" (jsonPayload.event=\"pipeline_failed\" OR jsonPayload.event=\"config_error\")"
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": {
    "notificationRateLimit": { "period": "300s" }
  }
}
EOF
    gcloud alpha monitoring policies create --policy-from-file="$FAILED_POLICY_JSON"
    rm -f "$FAILED_POLICY_JSON"
    echo "Created alert policy: $FAILED_POLICY_DISPLAY_NAME"
else
    echo "Alert policy already exists, leaving as-is: $FAILED_POLICY_DISPLAY_NAME"
fi

# --- 4. Alert policy: no successful execution in 60 minutes (log-absence,
#        via the logs-based metric created in step 1). ---
if ! gcloud alpha monitoring policies list \
    --filter="displayName=\"${ABSENCE_POLICY_DISPLAY_NAME}\"" \
    --format='value(name)' | grep -q .; then

    ABSENCE_POLICY_JSON="$(mktemp)"
    cat > "$ABSENCE_POLICY_JSON" <<EOF
{
  "displayName": "${ABSENCE_POLICY_DISPLAY_NAME}",
  "documentation": {
    "content": "No bp-ingest-pull execution has logged pipeline_success in 60 minutes -- either the pipeline is failing before it can log success, or nothing is triggering it at all (check Cloud Scheduler: gcloud scheduler jobs describe ${INGEST_JOB_NAME}-scheduler --location=${REGION}).",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "No pipeline_success in 60m",
      "conditionAbsent": {
        "filter": "metric.type=\"logging.googleapis.com/user/${SUCCESS_METRIC_NAME}\" resource.type=\"cloud_run_job\"",
        "duration": "3600s",
        "aggregations": [
          {
            "alignmentPeriod": "3600s",
            "perSeriesAligner": "ALIGN_COUNT",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": {
    "notificationRateLimit": { "period": "3600s" }
  }
}
EOF
    gcloud alpha monitoring policies create --policy-from-file="$ABSENCE_POLICY_JSON"
    rm -f "$ABSENCE_POLICY_JSON"
    echo "Created alert policy: $ABSENCE_POLICY_DISPLAY_NAME"
else
    echo "Alert policy already exists, leaving as-is: $ABSENCE_POLICY_DISPLAY_NAME"
fi

echo
echo "Alerting configured. Test the failure path once:"
echo "  gcloud run jobs execute ${INGEST_JOB_NAME} --region=${REGION} --update-env-vars=BP_ADAPTER=bogus --wait || true"
echo "(that deliberately fails config validation -- expect an email within a few minutes, then revert the env var if you left it set)."
