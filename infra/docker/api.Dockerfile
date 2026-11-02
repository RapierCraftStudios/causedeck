# API image (#14): Hono on Node, drains on SIGTERM.
# Build from the repo root:  docker build -f infra/docker/api.Dockerfile -t causedeck-api .
# Hardened for production (#97): digest-pinned base (see base/README.md), tini as PID 1, numeric
# non-root user, pruned `pnpm deploy --prod` output, no package-manager caches, UTC, and no writes
# outside /tmp (run with a read-only root filesystem and a tmpfs there).
ARG NODE_IMAGE=node:22.23.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
# The root `prepare` script (lefthook install) is a no-op without a .git directory; the image has no git.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true LEFTHOOK=0
RUN corepack enable
WORKDIR /repo
# Host node_modules symlinks are dropped before installing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api apps/api
COPY packages packages
# better-auth declares optional peers (next, vitest, drizzle-kit, ...). With auto-install-peers the
# workspace resolves them, so `pnpm deploy --prod` copies Next.js + SWC, vitest + Playwright and
# drizzle-kit into this image (~90 MB compressed, over the 250 MB size gate, #1104). Nothing here
# imports them at runtime (migrations use drizzle-orm's migrator); drop them after the deploy.
# Keep this list in sync with the other Node service Dockerfile (api/worker).
ARG OPTIONAL_PEERS_UNUSED="next@* @next+swc-* @playwright+test@* playwright@* playwright-core@* vitest@* @vitest+* drizzle-kit@* @esbuild-kit+* typescript@*"
RUN find . -name node_modules -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --ignore-scripts --filter "@causedeck/api..." \
  && pnpm --filter "@causedeck/api" --prod deploy --legacy /deploy \
  && cd /deploy/node_modules/.pnpm && rm -rf $OPTIONAL_PEERS_UNUSED && cd /repo \
  && pnpm store prune && rm -rf /pnpm/store

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC API_PORT=3001
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
WORKDIR /app
COPY --from=build /deploy /app
# 1000 is the image's `node` user; numeric so Kubernetes/compose can enforce runAsNonRoot.
USER 1000:1000
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
# Exec form, no shell or pnpm wrapper, so SIGTERM reaches node and the 10 s drain runs.
CMD ["node", "--import", "tsx", "src/server.ts"]
