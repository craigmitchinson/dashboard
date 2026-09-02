#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 09_deploy_frontend.sh — build the SPA (root Dockerfile) in API mode and
# deploy/update its Cloud Run SERVICE, wired to the API service 08 just
# deployed via API_UPSTREAM. This is the DEFAULT "small team" topology:
# same-origin via this service's own nginx proxy (deploy/nginx.conf.template)
# — no Load Balancer, no custom domain required, one `gcloud run deploy` per
# side. See deploy/gcp.md's topology section for when to use
# 10_deploy_loadbalancer.sh instead.
#
# Run 08_deploy_api.sh first — this script reads its URL straight from
# `gcloud run services describe`.
#
# VITE_API_URL=/ (not a full URL, not empty) — see the root Dockerfile's
# header comment and deploy/gcp.md's "Same-origin topology" section for the
# exact reasoning: src/data/client.ts's `DATA_MODE` is
# `import.meta.env.VITE_API_URL ? "api" : "local"`, so an empty string reads
# as local mode (wrong), while "/" is truthy (api mode) AND its trailing
# slash is stripped by that same file's `API_BASE` computation down to "",
# producing request paths like "/api/model" — same-origin, exactly what this
# nginx proxy expects.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

if ! API_URL="$(gcloud run services describe "$API_SERVICE_NAME" --region="$REGION" --format='value(status.url)' 2>/dev/null)" || [ -z "$API_URL" ]; then
    echo "error: API service '$API_SERVICE_NAME' not found in region $REGION — run 08_deploy_api.sh first." >&2
    exit 1
fi

REPO_NAME="bp-dashboard"
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$REPO_NAME" \
        --repository-format=docker \
        --location="$REGION" \
        --description="Intelligent Automation dashboard SPA image"
fi

echo "Building and pushing $FRONTEND_IMAGE (api mode, API_UPSTREAM=$API_URL)..."
# Build args only affect the BUILD (baked into the JS bundle); API_UPSTREAM
# below is a runtime env var read by nginx at container start instead (see
# deploy/nginx.conf.template) — the two are deliberately separate knobs so
# the API's URL can change (redeploy, new revision) without rebuilding the
# SPA image, as long as VITE_API_URL's *shape* ("/" = same-origin) doesn't.
#
# `--tag` (the one-liner 06/08 use) can't pass --build-arg, so this writes a
# one-off Cloud Build config to a temp file instead — a plain file rather
# than `--config=/dev/stdin`, which is unreliable from Git Bash on Windows.
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

gcloud builds submit \
    --config="$BUILD_CONFIG_FILE" \
    --substitutions="_IMAGE=${FRONTEND_IMAGE},_VITE_API_URL=/,_VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER},_VITE_ENTRA_TENANT_ID=${VITE_ENTRA_TENANT_ID:-},_VITE_ENTRA_CLIENT_ID=${VITE_ENTRA_CLIENT_ID:-},_VITE_ENTRA_REDIRECT_URI=${VITE_ENTRA_REDIRECT_URI:-},_VITE_ENTRA_SCOPES=${VITE_ENTRA_SCOPES:-}" \
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
    --set-env-vars="API_UPSTREAM=${API_URL}" \
    --port=8080 \
    --min-instances=0 \
    --max-instances="$FRONTEND_MAX_INSTANCES" \
    --cpu=1 \
    --memory=256Mi \
    --allow-unauthenticated \
    --quiet

FRONTEND_URL="$(gcloud run services describe "$FRONTEND_SERVICE_NAME" --region="$REGION" --format='value(status.url)')"
echo "Frontend service $ACTION'd: $FRONTEND_SERVICE_NAME"
echo "  URL: $FRONTEND_URL"
echo "  proxying /api/ -> $API_URL"

# Closes the chicken-and-egg loop server/README.md's "Integration notes for
# other workers" flags: the API's CORS_ORIGIN should be the SPA's own
# origin, but that origin doesn't exist until AFTER this deploy — so 08
# deploys the API without it, and this script patches it in immediately
# afterward. Browser requests through this topology are same-origin (nginx
# proxies /api/ same-origin — see deploy/nginx.conf.template) so CORS_ORIGIN
# isn't load-bearing for normal traffic, but it still matters as
# defense-in-depth: it stops a browser page on some OTHER origin from
# reading a response if it ever called bp-api's own public *.run.app URL
# directly (see deploy/gcp.md §5a's note on that URL being reachable,
# just not usable without a valid Bearer token).
gcloud run services update "$API_SERVICE_NAME" \
    --region="$REGION" \
    --update-env-vars="CORS_ORIGIN=${FRONTEND_URL}" \
    --quiet
echo "  API's CORS_ORIGIN set to $FRONTEND_URL"
echo
echo "If you've since redeployed the API and its URL changed, re-run this script —"
echo "it re-reads the API's current URL each time rather than caching it."
echo
echo "Entra app registration: add ${FRONTEND_URL} (exactly — no trailing slash) as an"
echo "allowed redirect URI. VITE_ENTRA_REDIRECT_URI was left unset, so"
echo "src/auth/entra-provider.ts sends window.location.origin, which equals this URL"
echo "exactly — see deploy/gcp.md's Entra section."
