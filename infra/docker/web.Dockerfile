# Web image (#10): Next.js standalone server for apps/web, runs as the non-root `node` user.
# Build from the repo root:  docker build -f infra/docker/web.Dockerfile -t causedeck-web .
# Build only for now; deployment (Caddy, compose.prod, multi-arch) arrives with Production Infra.

FROM node:22.23.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
# Host node_modules symlinks and build output are dropped before installing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web apps/web
COPY packages packages
RUN find . \( -name node_modules -o -name .next \) -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --ignore-scripts --filter "@causedeck/web..."
# APP_URL feeds Server Actions `allowedOrigins` at build time.
ARG APP_URL
ENV APP_URL=${APP_URL}
RUN pnpm --filter @causedeck/web build

FROM node:22.23.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Standalone output: a traced server.js plus only the node_modules it needs; static assets beside it.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
# Exec form so SIGTERM reaches node directly.
CMD ["node", "apps/web/server.js"]
