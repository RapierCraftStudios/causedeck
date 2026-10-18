# API image (#14): Hono on Node, runs as the non-root `node` user and drains on SIGTERM.
# Build from the repo root:  docker build -f infra/docker/api.Dockerfile -t causedeck-api .
# Production hardening (multi-arch, distroless, compose.prod) arrives with #97.

FROM node:22.23.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# Only what the API needs; host node_modules symlinks are dropped before installing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api apps/api
COPY packages packages
RUN find . -name node_modules -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@causedeck/api..."

FROM node:22.23.0-bookworm-slim AS runtime
ENV NODE_ENV=production API_PORT=3001
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
# Exec form, no shell or pnpm wrapper, so SIGTERM reaches node and the 10 s drain runs.
CMD ["node", "--import", "tsx", "src/server.ts"]
