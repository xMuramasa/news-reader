# news-ui: the Vite build served by a small Bun static server. Build context: the repo root (see .dockerignore).
#   docker build -f docker/ui.Dockerfile -t news-ui .
# The final image holds dist/ and server.ts only (no node_modules). Runs as uid 1000 with a read-only root filesystem.

FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/schema/package.json packages/schema/
COPY apps/api/package.json apps/api/
COPY apps/ui/package.json apps/ui/
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/schema/src packages/schema/src
COPY apps/ui apps/ui
RUN cd apps/ui && bun run build

FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DIST_DIR=/app/dist \
    TMPDIR=/tmp \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
COPY --from=build /app/apps/ui/server.ts ./server.ts
COPY --from=build /app/apps/ui/dist ./dist
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.ts"]
