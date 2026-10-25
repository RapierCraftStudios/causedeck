# Admin image (#309): Next.js standalone server for apps/admin (the staff console), runs as the
# non-root `node` user and exposes `/healthz`.
# Build from the repo root:  docker build -f infra/docker/admin.Dockerfile -t causedeck-admin .
# Exposure is per deployment and never baked in: put it behind Cloudflare Access (CF_ACCESS_AUD,
# CF_ACCESS_TEAM_DOMAIN) and/or ADMIN_IP_ALLOWLIST at runtime (docs/engineering/admin-console.md).

FROM node:22.23.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
# Host node_modules symlinks and build output are dropped before installing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/admin apps/admin
COPY packages packages
RUN find . \( -name node_modules -o -name .next -o -name .next-e2e \) -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --ignore-scripts --filter "@causedeck/admin..."
# ADMIN_URL feeds Server Actions `allowedOrigins` at build time.
ARG ADMIN_URL
ENV ADMIN_URL=${ADMIN_URL}
RUN pnpm --filter @causedeck/admin build

FROM node:22.23.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3200 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Standalone output: a traced server.js plus only the node_modules it needs; static assets beside it.
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
# Exec form so SIGTERM reaches node directly.
CMD ["node", "apps/admin/server.js"]
