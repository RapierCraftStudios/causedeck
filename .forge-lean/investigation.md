**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield infra feature; dev-grade Dockerfiles exist, no prod stack)
**Task Type**: feature

### What Was Claimed
Production-grade images for web/api/worker/admin and `infra/docker/compose.prod.yml` for a single India VPS (Caddy, web x2, api, worker x2, admin, Postgres 17 + pgvector + WAL-G, MinIO), plus migrate/healthcheck/bootstrap scripts, an images workflow (multi-arch, GHCR, Trivy, SBOM, cosign), a compose smoke test, env examples and docs. 13 acceptance criteria (R1-R13).

### What We Found
- Base `origin/milestone/production-infra-scale` has only dev-grade Dockerfiles: `infra/docker/{web,api,worker,admin}.Dockerfile` (e.g. `api.Dockerfile:3` says "Production hardening ... arrives with #97"), `infra/docker/compose.dev.yml`, and `infra/docker/postgres/init/{01-extensions,02-roles}.sql`.
- Base images are tag-pinned (`node:22.23.0-bookworm-slim`, `api.Dockerfile:5`), not digest-pinned; no `tini`; `USER node` (non-root, named not numeric); no TZ/UTC; no `.dockerignore` in `infra/docker`.
- No `compose.prod.yml`, `postgres/Dockerfile`, `postgresql.conf`, `env/*.env.example`, `infra/scripts/{migrate,healthcheck,bootstrap-vps}.sh`, `infra/docker/test/`, `infra/caddy/` (owned by #98), or `.github/workflows/images.yml`.
- Existing static-lint precedent: `infra/scripts/compose-dev.test.mjs` (node test over compose YAML).
- Health: `packages/observability/src/health.ts:80` `createHealthHandlers` (checks registry, 2 s timeout `:36`); web `apps/web/src/health.ts:7` registers no checks; worker `apps/worker/src/health.ts:29`; api `apps/api/src/app.ts:90`; admin has `apps/admin/app/healthz` only (no /readyz).
- Owner-role migrations: `packages/db/scripts/migrate.ts`; role split in `infra/docker/postgres/init/02-roles.sql`.
- The issue already carries a frozen builder contract (FORGE:CONTRACT, sha e600d311805c) with 13 requirements; its D11 references a nonexistent R14 (should be R13) and D17 omits the exact app health files, corrected here. Stale `.forge-lean/*` files in the tree belong to another issue (WhatsApp link) and are overwritten.

### Root Cause
Greenfield: Stage A production packaging was never built; only dev Dockerfiles/compose exist.

### Affected Files
All new or hardened under `infra/docker/**`, `infra/scripts/**`, `.github/workflows/images.yml`, plus a clock-drift readiness check in `packages/observability/src/health.ts` wired into `apps/{web,api,worker}` health modules. See contract.json deliverables.

### Sibling Sweep
`.github/workflows/*` all pin actions by SHA and are checked by lint-workflows; images.yml must follow. Caddyfile is #98's (no `infra/caddy` yet), so compose mounts a path with a minimal placeholder. Admin lacks `/readyz`; drift check is not wired there (healthz only).

### History
Dev Dockerfiles from #10/#14/#15; dev compose from ad0a831 (#5). No prior prod attempt merged.

### Recommendation
Implement per contract.json in one lane (infra files mostly independent, ~25 files, well under split threshold). Static compose lint test and observability unit test are the in-lane checks; image size, smoke, Trivy/cosign, bootstrap idempotence are CI/out-of-band.

### Related Issues
#1 (parent), #10, #14, #15 (done); #98 Caddy, #99 Terraform, #100 deploy, #101 backups, #102 monitoring, #108 VPS, #116 secrets (out of scope / external).
