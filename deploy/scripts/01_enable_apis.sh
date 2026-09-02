#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 01_enable_apis.sh — enable the Google APIs this deployment needs.
# Run once per project. Idempotent (gcloud services enable is a no-op if
# already enabled).
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

gcloud config set project "$PROJECT_ID"

gcloud services enable \
    sqladmin.googleapis.com \
    servicenetworking.googleapis.com \
    run.googleapis.com \
    cloudscheduler.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    compute.googleapis.com \
    iam.googleapis.com

echo "APIs enabled for project $PROJECT_ID."
