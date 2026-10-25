# Web image (#10): Next.js standalone server for apps/web (Node runtime, never edge: data stays in India).
# Build from the repo root:  docker build -f infra/docker/web.Dockerfile -t causedeck-web .
# Hardened for production (#97): digest-pinned base (see base/README.md), tini as PID 1, numeric
# non-root user, no package-manager caches, UTC. Next.js writes only to /tmp and .next/cache: run
# with a read-only root filesystem and tmpfs on /tmp and /app/apps/web/.next/cache.
ARG NODE_IMAGE=node:22.23.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
# Host node_modules symlinks and build output are dropped before installing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web apps/web
COPY packages packages
RUN find . \( -name node_modules -o -name .next -o -name .next-e2e \) -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --ignore-scripts --filter "@causedeck/web..."
# APP_URL feeds Server Actions `allowedOrigins` at build time.
ARG APP_URL
ENV APP_URL=${APP_URL}
RUN pnpm --filter @causedeck/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
WORKDIR /app
# Standalone output: a traced server.js plus only the node_modules it needs; static assets beside it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# 1000 is the image's `node` user; numeric so runtimes can enforce runAsNonRoot.
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
# Exec form so SIGTERM reaches node directly.
CMD ["node", "apps/web/server.js"]
