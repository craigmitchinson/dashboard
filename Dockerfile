# ---------------------------------------------------------------------------
# Blue Prism / Intelligent Automation dashboard SPA — static build served by
# nginx, sized for Cloud Run. This builds ONLY the frontend; the API is a
# separate image at server/Dockerfile (see deploy/gcp.md), deployed as its
# own Cloud Run service.
#
# Two build modes, selected by whether VITE_API_URL is set:
#
#   static mode (default — VITE_API_URL unset): generates the mock dataset
#   and bakes /data/*.json at build time, exactly as before this task — a
#   fresh clone builds a fully working, self-contained demo with no API.
#
#   api mode (VITE_API_URL set): skips the mock-data generation/bake
#   entirely (nothing in api mode ever reads the baked file) — the SPA
#   calls the API at runtime instead, via src/data/client.ts.
#
#   docker build -t bp-dashboard .                                    # static
#   docker run -p 8080:8080 bp-dashboard
#
#   docker build -t bp-dashboard \
#     --build-arg VITE_API_URL=/ \
#     --build-arg VITE_AUTH_PROVIDER=entra \
#     --build-arg VITE_ENTRA_TENANT_ID=... \
#     --build-arg VITE_ENTRA_CLIENT_ID=... \
#     --build-arg VITE_ENTRA_REDIRECT_URI=https://your-domain/ \
#     --build-arg VITE_ENTRA_SCOPES="openid profile email" .            # api
#   docker run -e API_UPSTREAM=https://bp-api-xxxxx-ew2.a.run.app \
#     -p 8080:8080 bp-dashboard
#
# VITE_API_URL=/ is deliberate, not a placeholder — see deploy/gcp.md's
# "Same-origin topology" section for why "/" (rather than "" or a full URL)
# is the value that makes src/data/client.ts's DATA_MODE resolve to "api"
# while still producing same-origin request paths ("/api/model", etc.) once
# this image's nginx proxies /api/ to the real API service. Point it at a
# full https://... URL instead only if the SPA is calling the API
# cross-origin (bypassing this image's own proxy) — that also requires
# CORS_ORIGIN to be set on the API service (see deploy/scripts/08_deploy_api.sh).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# --- SPA build-time config — see deploy/gcp.md's env matrix for the full
# per-service list (build-time vs runtime, which service). Every VITE_*
# value the API contract defines is accepted here, whether or not this
# particular build uses it, so one Dockerfile serves both modes. ---
ARG VITE_API_URL=""
ARG VITE_DATA_URL=""
ARG VITE_AUTH_PROVIDER="dev"
ARG VITE_ENTRA_TENANT_ID=""
ARG VITE_ENTRA_CLIENT_ID=""
ARG VITE_ENTRA_REDIRECT_URI=""
ARG VITE_ENTRA_SCOPES=""
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_DATA_URL=${VITE_DATA_URL} \
    VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER} \
    VITE_ENTRA_TENANT_ID=${VITE_ENTRA_TENANT_ID} \
    VITE_ENTRA_CLIENT_ID=${VITE_ENTRA_CLIENT_ID} \
    VITE_ENTRA_REDIRECT_URI=${VITE_ENTRA_REDIRECT_URI} \
    VITE_ENTRA_SCOPES=${VITE_ENTRA_SCOPES}

# static mode only: deterministic mock CSV (gitignored) -> pipeline ->
# /public/data/*.json. Skipped in api mode (VITE_API_URL set) — running the
# pipeline would just bake data that api mode never reads, and static mode's
# own behaviour/output is unchanged by this branch (identical to the
# unconditional `RUN` this replaced).
RUN if [ -z "$VITE_API_URL" ]; then \
      echo "VITE_API_URL unset — static mode, generating and baking mock data" && \
      node tools/generate-mock-data.mjs && node tools/build-dashboard-data.mjs; \
    else \
      echo "VITE_API_URL set — api mode, skipping mock data generation/bake"; \
    fi
RUN npm run build

# nginx-unprivileged (not plain nginx): non-root by default (runs as uid
# 101, listens on 8080 out of the box) via proper image permissions, rather
# than this Dockerfile patching ownership/capabilities itself — and it ships
# the same /docker-entrypoint.d/20-envsubst-on-templates.sh templating
# mechanism deploy/nginx.conf.template relies on.
FROM nginxinc/nginx-unprivileged:1.27-alpine
# The base image already switches to its unprivileged user (nginx, uid 101)
# near the end of ITS OWN Dockerfile — every RUN/COPY below inherits that
# unless overridden, which is fine for the two COPY lines (this image
# chowns /etc/nginx and /usr/share/nginx/html to that user specifically so
# templating/serving works without root) but NOT for `apk add`, which needs
# root to write into /etc/apk and /etc/ssl. Switch to root only for that one
# line, then explicitly back to nginx before the COPYs, matching the base
# image's own intended non-root ownership of both target directories rather
# than silently leaving everything root-owned from here on.
USER root
# CA bundle for verifying the API Cloud Run service's TLS certificate when
# proxying /api/ (see deploy/nginx.conf.template's proxy_ssl_* directives).
RUN apk add --no-cache ca-certificates
USER nginx
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Runtime config, substituted into the nginx config at container start (see
# deploy/nginx.conf.template's header comment) — NOT build args, since the
# same image is meant to be deployed with different API_UPSTREAM values
# without rebuilding (e.g. a staging vs prod API service).
#   API_UPSTREAM unset (default): /api/ returns a 404 JSON stub, static/local
#     mode. Set to the API Cloud Run service's HTTPS base URL (no trailing
#     slash) to enable the same-origin proxy.
ENV API_UPSTREAM=""
# Cloud Run sends traffic to $PORT (8080 by default; Cloud Run overrides this
# env var automatically if the service is configured with a different port).
ENV PORT=8080
EXPOSE 8080
