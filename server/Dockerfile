# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# server/Dockerfile — the dashboard's production data API. Build context
# MUST be the repo root (not server/), because this service imports
# ../shared/model-assembler.mjs and ../shared/auth-mappings.mjs:
#   docker build -f server/Dockerfile -t ia-coe-dashboard-api .
# See server/README.md for env vars; deploy/** wires the Cloud Run service
# and the SPA's nginx /api proxy in front of it.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app
COPY shared/ ./shared/
COPY server/package.json server/package-lock.json* ./server/
WORKDIR /app/server
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY shared/ ./shared/
COPY server/package.json server/package-lock.json* ./server/
WORKDIR /app/server
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist

RUN addgroup -S apirunner && adduser -S apirunner -G apirunner
USER apirunner

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
