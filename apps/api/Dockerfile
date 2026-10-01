# syntax=docker/dockerfile:1.7
# API image. Build from the monorepo root:
#   docker build -f apps/api/Dockerfile -t noble-api .
ARG NODE_VERSION=22

# ---- build: install API dependencies, bundle it, then isolate production dependencies ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /app
# Manifests first, so a dependency-free code change reuses the cached install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @noble/api...
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @noble/api build
# A self-contained folder holding only the API's production dependencies.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @noble/api deploy --prod /deploy

# ---- runtime: plain Node, non-root, production dependencies only ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4100 \
    UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/src/server.js"]
