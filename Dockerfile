# ---------------------------------------------------------------------------
# Blue Prism RPA dashboard — static build served by nginx, sized for Cloud Run.
#
#   docker build -t bp-dashboard .
#   docker run -p 8080:8080 bp-dashboard
#
# The image regenerates the mock dataset and bakes /data/*.json at build time,
# so a fresh clone builds a fully working demo. For live data, either:
#   - mount/copy a real export CSV over data/mock/BPAWorkQueueItem.csv before
#     building (same schema, nothing else changes), or
#   - build with VITE_DATA_URL pointing at the data API and skip the bake:
#       docker build --build-arg VITE_DATA_URL=https://api.example/data/model.json .
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DATA_URL=""
ENV VITE_DATA_URL=${VITE_DATA_URL}
# deterministic mock CSV (gitignored) -> pipeline -> /public/data/*.json
RUN node tools/generate-mock-data.mjs && node tools/build-dashboard-data.mjs && npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Cloud Run sends traffic to $PORT (8080 by default)
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
