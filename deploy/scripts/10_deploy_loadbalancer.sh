#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 10_deploy_loadbalancer.sh — OPTIONAL, ADVANCED. The PRODUCTION-recommended
# topology: one external HTTPS Load Balancer in front of BOTH Cloud Run
# services (SPA + API) as two Serverless NEG backends, path-routed on one
# domain (/api/* -> the API service, everything else -> the SPA service).
#
# Run 08_deploy_api.sh first. This REPLACES 09_deploy_frontend.sh's role
# (same-origin nginx proxy) rather than layering on top of it — with the LB
# doing the path routing, the SPA image can be built and deployed in STATIC
# mode's Dockerfile shape but pointed at the LB's own origin: build with
# VITE_API_URL=/ exactly as 09 does (same reasoning — same-origin request
# paths), then deploy the SPA's Cloud Run service directly (skip nginx's own
# /api/ proxy entirely — set API_UPSTREAM="" since the LB, not this
# container's nginx, is what routes /api/* to the API service now).
#
# WHY THIS IS THE PRODUCTION RECOMMENDATION (see deploy/gcp.md's topology
# section for the full comparison):
#   - single origin/domain for the whole app — no reliance on nginx's own
#     proxy_pass hop (one fewer network segment per API call, and nginx is
#     no longer a load-bearing part of the API's request path at all)
#   - the API service can run with --ingress=internal-and-cloud-load-balancing
#     (this script sets it) — its own *.run.app URL stops accepting traffic
#     from the public internet AT ALL, a platform-level boundary, not just
#     the application-level Entra JWT check 08's topology relies on alone
#   - Cloud Armor (WAF/rate-limiting/geo-blocking) and Identity-Aware Proxy
#     both attach at the Load Balancer, optionally, without touching either
#     Cloud Run service — IAP-optional means you can add org-SSO-gated
#     access later without redeploying anything here
#   - a managed TLS certificate on your own domain, rather than each
#     service's own *.run.app URL
#
# TRADE-OFF: materially more moving parts than 09's single `gcloud run
# deploy` per side (a static IP, two Serverless NEGs, two backend services,
# a URL map, a managed cert — which is NOT provisioned/active until DNS
# actually points at the reserved IP, see the final echo below — and a
# forwarding rule), and a domain you control (LB_DOMAIN in env.sh). Use
# 09_deploy_frontend.sh instead if you don't need any of the bullets above
# yet.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

if [ -z "${LB_DOMAIN:-}" ]; then
    echo "error: env.sh must set LB_DOMAIN (the domain you'll point at this Load Balancer, e.g. dashboard.example.com)" >&2
    exit 1
fi

if ! API_URL="$(gcloud run services describe "$API_SERVICE_NAME" --region="$REGION" --format='value(status.url)' 2>/dev/null)" || [ -z "$API_URL" ]; then
    echo "error: API service '$API_SERVICE_NAME' not found in region $REGION — run 08_deploy_api.sh first." >&2
    exit 1
fi

# --- SPA service, deployed for the LB (not nginx) to do the /api/ routing ---
REPO_NAME="bp-dashboard"
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$REPO_NAME" \
        --repository-format=docker \
        --location="$REGION" \
        --description="Intelligent Automation dashboard SPA image"
fi

BUILD_CONFIG_FILE="$(mktemp)"
trap 'rm -f "$BUILD_CONFIG_FILE"' EXIT
cat > "$BUILD_CONFIG_FILE" <<'EOF'
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --tag=${_IMAGE}
      - --build-arg=VITE_API_URL=${_VITE_API_URL}
      - --build-arg=VITE_AUTH_PROVIDER=${_VITE_AUTH_PROVIDER}
      - --build-arg=VITE_ENTRA_TENANT_ID=${_VITE_ENTRA_TENANT_ID}
      - --build-arg=VITE_ENTRA_CLIENT_ID=${_VITE_ENTRA_CLIENT_ID}
      - --build-arg=VITE_ENTRA_REDIRECT_URI=${_VITE_ENTRA_REDIRECT_URI}
      - --build-arg=VITE_ENTRA_SCOPES=${_VITE_ENTRA_SCOPES}
      - .
images:
  - ${_IMAGE}
EOF
echo "Building and pushing $FRONTEND_IMAGE (api mode, routed by the LB — no nginx API_UPSTREAM)..."
gcloud builds submit \
    --config="$BUILD_CONFIG_FILE" \
    --substitutions="_IMAGE=${FRONTEND_IMAGE},_VITE_API_URL=/,_VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER},_VITE_ENTRA_TENANT_ID=${VITE_ENTRA_TENANT_ID:-},_VITE_ENTRA_CLIENT_ID=${VITE_ENTRA_CLIENT_ID:-},_VITE_ENTRA_REDIRECT_URI=https://${LB_DOMAIN}/,_VITE_ENTRA_SCOPES=${VITE_ENTRA_SCOPES:-}" \
    ../..
rm -f "$BUILD_CONFIG_FILE"
trap - EXIT

if gcloud run services describe "$FRONTEND_SERVICE_NAME" --region="$REGION" >/dev/null 2>&1; then
    ACTION="update"
else
    ACTION="deploy"
fi
gcloud run "$ACTION" "$FRONTEND_SERVICE_NAME" \
    --region="$REGION" \
    --image="$FRONTEND_IMAGE" \
    --set-env-vars="API_UPSTREAM=" \
    --ingress=internal-and-cloud-load-balancing \
    --port=8080 \
    --min-instances=0 \
    --max-instances="$FRONTEND_MAX_INSTANCES" \
    --cpu=1 \
    --memory=256Mi \
    --allow-unauthenticated \
    --quiet
echo "Frontend service $ACTION'd (ingress restricted to the LB): $FRONTEND_SERVICE_NAME"

# --- lock the API down to LB-only ingress too, and point CORS_ORIGIN at the
# one public domain (same reasoning as 09_deploy_frontend.sh's equivalent
# step — see its comment) ---
gcloud run services update "$API_SERVICE_NAME" \
    --region="$REGION" \
    --ingress=internal-and-cloud-load-balancing \
    --update-env-vars="CORS_ORIGIN=https://${LB_DOMAIN}" \
    --quiet
echo "API service's ingress restricted to the LB, CORS_ORIGIN=https://${LB_DOMAIN}: $API_SERVICE_NAME"

# --- Serverless NEGs (one per Cloud Run service, regional) ---
FRONTEND_NEG_NAME="${FRONTEND_SERVICE_NAME}-neg"
API_NEG_NAME="${API_SERVICE_NAME}-neg"

create_neg_if_missing() {
    local neg_name="$1" service_name="$2"
    if ! gcloud compute network-endpoint-groups describe "$neg_name" --region="$REGION" >/dev/null 2>&1; then
        gcloud compute network-endpoint-groups create "$neg_name" \
            --region="$REGION" \
            --network-endpoint-type=serverless \
            --cloud-run-service="$service_name"
    else
        echo "NEG $neg_name already exists, skipping create"
    fi
}
create_neg_if_missing "$FRONTEND_NEG_NAME" "$FRONTEND_SERVICE_NAME"
create_neg_if_missing "$API_NEG_NAME" "$API_SERVICE_NAME"

# --- backend services (global, one per NEG — serverless NEGs need no health check) ---
FRONTEND_BACKEND_NAME="${FRONTEND_SERVICE_NAME}-backend"
API_BACKEND_NAME="${API_SERVICE_NAME}-backend"

create_backend_if_missing() {
    local backend_name="$1" neg_name="$2"
    if ! gcloud compute backend-services describe "$backend_name" --global >/dev/null 2>&1; then
        gcloud compute backend-services create "$backend_name" \
            --global \
            --load-balancing-scheme=EXTERNAL_MANAGED
        gcloud compute backend-services add-backend "$backend_name" \
            --global \
            --network-endpoint-group="$neg_name" \
            --network-endpoint-group-region="$REGION"
    else
        echo "backend service $backend_name already exists, skipping create"
    fi
}
create_backend_if_missing "$FRONTEND_BACKEND_NAME" "$FRONTEND_NEG_NAME"
create_backend_if_missing "$API_BACKEND_NAME" "$API_NEG_NAME"

# --- URL map: default -> SPA, /api/* -> API ---
URL_MAP_NAME="bp-dashboard-urlmap"
if ! gcloud compute url-maps describe "$URL_MAP_NAME" >/dev/null 2>&1; then
    gcloud compute url-maps create "$URL_MAP_NAME" \
        --default-service="$FRONTEND_BACKEND_NAME"
    gcloud compute url-maps add-path-matcher "$URL_MAP_NAME" \
        --path-matcher-name=api-matcher \
        --default-service="$FRONTEND_BACKEND_NAME" \
        --new-hosts="$LB_DOMAIN" \
        --path-rules="/api/*=${API_BACKEND_NAME}"
else
    echo "URL map $URL_MAP_NAME already exists, skipping create — to change routing, edit it directly"
    echo "  (gcloud compute url-maps edit $URL_MAP_NAME) rather than re-running this script."
fi

# --- managed TLS certificate for LB_DOMAIN ---
CERT_NAME="bp-dashboard-cert"
if ! gcloud compute ssl-certificates describe "$CERT_NAME" --global >/dev/null 2>&1; then
    gcloud compute ssl-certificates create "$CERT_NAME" \
        --domains="$LB_DOMAIN" \
        --global
else
    echo "managed cert $CERT_NAME already exists, skipping create"
fi

# --- static IP + HTTPS target proxy + forwarding rule ---
IP_NAME="bp-dashboard-ip"
if ! gcloud compute addresses describe "$IP_NAME" --global >/dev/null 2>&1; then
    gcloud compute addresses create "$IP_NAME" --global --ip-version=IPV4
fi
STATIC_IP="$(gcloud compute addresses describe "$IP_NAME" --global --format='value(address)')"

PROXY_NAME="bp-dashboard-https-proxy"
if ! gcloud compute target-https-proxies describe "$PROXY_NAME" >/dev/null 2>&1; then
    gcloud compute target-https-proxies create "$PROXY_NAME" \
        --url-map="$URL_MAP_NAME" \
        --ssl-certificates="$CERT_NAME"
else
    echo "target HTTPS proxy $PROXY_NAME already exists, skipping create"
fi

FORWARDING_RULE_NAME="bp-dashboard-https-rule"
if ! gcloud compute forwarding-rules describe "$FORWARDING_RULE_NAME" --global >/dev/null 2>&1; then
    gcloud compute forwarding-rules create "$FORWARDING_RULE_NAME" \
        --global \
        --load-balancing-scheme=EXTERNAL_MANAGED \
        --address="$IP_NAME" \
        --target-https-proxy="$PROXY_NAME" \
        --ports=443
else
    echo "forwarding rule $FORWARDING_RULE_NAME already exists, skipping create"
fi

echo
echo "Load Balancer provisioned. Reserved static IP: $STATIC_IP"
echo
echo "NEXT (manual, outside gcloud): point ${LB_DOMAIN}'s DNS A record at $STATIC_IP."
echo "The managed certificate ($CERT_NAME) stays PROVISIONING until that DNS record"
echo "resolves and Google's cert authority can validate it — this can take up to"
echo "~60 minutes after the DNS change propagates. Check status with:"
echo "  gcloud compute ssl-certificates describe $CERT_NAME --global --format='value(managed.status)'"
echo
echo "Until the cert is ACTIVE, https://${LB_DOMAIN} will fail/warn — this is"
echo "expected, not a misconfiguration. An HTTP->HTTPS redirect listener on port 80"
echo "is NOT created by this script (add one via a second URL map that only"
echo "redirects, plus a target-http-proxy + forwarding rule on port 80, once the"
echo "domain and cert are confirmed working) — deliberately left as a follow-up so"
echo "this script's first run doesn't serve plaintext HTTP for the dashboard even"
echo "briefly."
