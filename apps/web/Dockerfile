# syntax=docker/dockerfile:1.7
# Web image: builds the React app and serves it with Caddy, which also proxies /api to the API container.
# Build from the monorepo root:
#   docker build -f apps/web/Dockerfile -t noble-web .
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @noble/web...
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# VITE_* values are read at build time and baked into the bundle, so they arrive as build args.
# The Mapbox token is a public pk.… token; it is visible in the bundle by design.
ARG VITE_MAPBOX_TOKEN=""
ARG VITE_API_BASE_URL=""
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN \
    VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @noble/web build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80 443
