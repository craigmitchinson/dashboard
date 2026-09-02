#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 02_network.sh — VPC + subnet + Private Service Access peering range, the
# prerequisite for giving Cloud SQL for SQL Server a PRIVATE IP.
#
# WHY PRIVATE IP IS REQUIRED HERE (verified — see deploy/cloudsql.md's
# citations): Cloud Run (service or Job) cannot connect to Cloud SQL for SQL
# Server over public IP at all — Google's own Cloud Run + Cloud SQL for SQL
# Server quickstart states this explicitly. Postgres/MySQL have a public-IP+
# connector path that doesn't exist for SQL Server (no Unix-socket proxy for
# the SQL Server wire protocol). Private Service Access (a VPC peering
# Google manages on your behalf) is the standard mechanism Cloud SQL uses to
# expose a private IP inside your own VPC.
#
# Idempotent: every gcloud call below is guarded by an existence check.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

if ! gcloud compute networks describe "$NETWORK_NAME" >/dev/null 2>&1; then
    gcloud compute networks create "$NETWORK_NAME" --subnet-mode=custom
else
    echo "network $NETWORK_NAME already exists, skipping create"
fi

if ! gcloud compute networks subnets describe "$SUBNET_NAME" --region="$REGION" >/dev/null 2>&1; then
    gcloud compute networks subnets create "$SUBNET_NAME" \
        --network="$NETWORK_NAME" \
        --region="$REGION" \
        --range="$SUBNET_RANGE"
else
    echo "subnet $SUBNET_NAME already exists, skipping create"
fi

if ! gcloud compute addresses describe "$PSA_RANGE_NAME" --global >/dev/null 2>&1; then
    gcloud compute addresses create "$PSA_RANGE_NAME" \
        --global \
        --purpose=VPC_PEERING \
        --prefix-length="$PSA_RANGE_PREFIX_LENGTH" \
        --network="$NETWORK_NAME"
else
    echo "PSA range $PSA_RANGE_NAME already exists, skipping create"
fi

# Connect the peering (idempotent: --force update is safe to re-run; a
# fresh network with no existing peering just creates it).
gcloud services vpc-peerings connect \
    --service=servicenetworking.googleapis.com \
    --ranges="$PSA_RANGE_NAME" \
    --network="$NETWORK_NAME"

echo "Network + Private Service Access peering ready: $NETWORK_NAME / $SUBNET_NAME."
echo "Cloud SQL instances created with --network=$NETWORK_NAME will get a private IP in this peering."
