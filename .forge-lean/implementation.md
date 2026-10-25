### Approach
Harden the four app Dockerfiles, add a WAL-G/pgvector Postgres image, a prod compose stack, env examples, ops scripts, a CI images workflow and an in-readiness clock-drift check. Heavy checks (builds, size, smoke, Trivy, cosign) run only in CI.

### Changes
- infra/docker/{web,api,worker,admin}.Dockerfile: ARG-pinned base, tini, numeric non-root, pruned deploy, UTC.
- infra/docker/.dockerignore, base/README.md, README.md: context excludes, pinning docs, prod/staging and resource-limit docs.
- infra/docker/postgres/{Dockerfile,postgresql.conf}: pgvector + checksum-verified WAL-G, archive_mode on.
- infra/docker/compose.prod.yml, env/{prod,staging}.env.example: hardened stack with limits.
- infra/scripts/{migrate,healthcheck,bootstrap-vps}.sh, infra/docker/test/compose-smoke.sh, infra/caddy/Caddyfile (placeholder, #98).
- infra/scripts/compose-prod.test.mjs: static compose lint.
- packages/observability/src/health.ts (+test), apps/{web,api,worker} health wiring: clock drift in /readyz only.
- .github/workflows/images.yml: build, size gate, smoke, multi-arch publish, Trivy, SBOM, cosign.

### Acceptance Criteria Status
- R1 ✅ images.yml size/non-root steps; Dockerfiles
- R2 ✅ compose.prod.yml, images.yml verify job
- R3 ✅ compose-prod.test.mjs
- R4 ✅ compose.prod.yml ports; compose-smoke.sh
- R5 ✅ postgres/Dockerfile, postgresql.conf:24
- R6 ✅ migrate.sh, compose.prod.yml migrate service
- R7 ✅ compose-smoke.sh
- R8 ✅ read_only in compose.prod.yml
- R9 ✅ images.yml publish job
- R10 ✅ compose.prod.yml limits, infra/docker/README.md
- R11 ✅ bootstrap-vps.sh
- R12 ✅ packages/observability/src/health.ts clockDriftCheckFromEnv
- R13 ✅ env/staging.env.example

### Verification
- V1 compose-prod/dev node tests: pass
- V2 bash -n on four scripts: pass
- V3 observability health.test.ts: 11 pass
- V4 worker health + web health-routes: pass
- Clock-drift tests in health.test.ts fail without the fix (function absent). Compose lint tests fail against the base compose (file absent).

### Notes
New env var CLOCK_DRIFT_REFERENCE_URL (optional; unset disables the check). Repo vars WALG_SHA256_AMD64/ARM64 are needed in CI. Docker-based checks were not run locally.

## Lint fix
CI lint failed (no log). Prettier flagged infra/docker/compose.prod.yml; reformatted with prettier --write. Other changed files pass prettier; eslint on changed TS OOMed locally, left to CI.
