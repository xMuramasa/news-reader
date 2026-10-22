# news-api: Bun + mongodb driver. Build context: the repo root (see .dockerignore).
#   docker build -f docker/api.Dockerfile -t news-api .
# Runs as uid 1000 with a read-only root filesystem (nothing is written outside /tmp).

FROM oven/bun:1.4.3 AS build
WORKDIR /app
# Every workspace manifest is needed for --frozen-lockfile; only production dependencies are installed (the UI has
# none: it ships as static files in its own image).
COPY package.json bun.lock ./
COPY packages/schema/package.json packages/schema/
COPY apps/api/package.json apps/api/
COPY apps/ui/package.json apps/ui/
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY packages/schema/src packages/schema/src
COPY apps/api/src apps/api/src
COPY config/outlets.json config/stack.json config/

FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_DIR=/app/config \
    TMPDIR=/tmp \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    INGEST_PORT=8787 \
    PUBLIC_PORT=8080
# Owned by root, read-only for the app user.
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/config ./config
USER 1000:1000
EXPOSE 8787 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PUBLIC_PORT || 8080) + '/healthz', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "apps/api/src/main.ts"]
