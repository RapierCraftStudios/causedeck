**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield release-engineering feature; images and compose exist, no deploy path or freeze guard)
**Task Type**: feature

### What Was Claimed
Add staging and production deploy pipelines (GHCR images, SSH to the VPS, pull, expand-only migrate, rolling `up -d`, `/readyz` gates, automatic rollback), production promotion from a green staging deploy of the same SHA, a court-day change freeze (18:00-23:00 and 07:00-10:30 IST) with an audited `hotfix` override, release records, a PR freeze warning, a runbook, and CI tests (12 acceptance criteria).

### What We Found
Verified against `origin/milestone/production-infra-scale` (b29b1e35; HEAD merge-base 9a89ccd2 is 3 merges behind, none touch these paths).
- No deploy workflows: `.github/workflows/` has only ci, e2e, images, lint-workflows, security, storybook, terraform, visual-update. No `.github/actions/freeze-guard`, `infra/scripts/{deploy,rollback,smoke}.sh`, `deploy.test.sh`, or `infra/runbooks/court-day-freeze.md`.
- `.github/workflows/images.yml:20-27` publishes multi-arch images only on push to `main` (`publish` job gated on `refs/heads/main`), tagged `sha-<gitsha>`; nothing builds on `staging` pushes. `ci.yml:10` already triggers on `staging`.
- `infra/docker/compose.prod.yml:82,121,160,200`: images are `ghcr.io/${IMAGE_ORG}/causedeck-<svc>:sha-${GIT_SHA}`; `web` and `worker` use `deploy.replicas: 2` (`:101,:180`); healthchecks hit `/readyz` (`:106-118`).
- `infra/scripts/migrate.sh:1-50`: starts postgres/minio, sets role passwords, runs `compose --profile migrate run --rm migrate` as `causedeck_owner`. `infra/scripts/healthcheck.sh:20-45` polls every service at once (no per-service ordering or 60 s gate).
- `/readyz` already returns `version` = `GIT_SHA` (`packages/observability/src/health.ts:83,91`), so the "exposes the running sha" criterion needs only a test/assertion in smoke.
- Migrations live in `packages/db/migrations/*.sql` (e.g. `0000_baseline.sql`, `20261025040000_whatsapp_inbound.sql`); no expand-only static check exists.
- Test precedent: root `test:ci-scripts` (`package.json:31`) runs `node --experimental-strip-types --test 'infra/scripts/*.test.mjs' 'infra/scripts/*.test.ts' 'infra/terraform/test/*.test.mjs'`; `infra/scripts/tsconfig.json` includes `*.ts` only; `compose-prod.test.mjs` is the static-lint model. `lint-workflows.yml` runs actionlint on `.github/**`.

### Root Cause
Greenfield: #97 (images, compose), #98 (Caddy) and #3 (CI) are merged, but the release path (deploy orchestration, rollback, freeze policy) was deliberately left to #100.

### Affected Files
Issue list: `.github/workflows/{deploy-staging,deploy-prod,hotfix-prod}.yml`, `.github/actions/freeze-guard/{action.yml,index.ts,test/freeze.test.ts}`, `infra/scripts/{deploy,rollback,smoke}.sh`, `infra/scripts/deploy.test.sh`, `infra/runbooks/court-day-freeze.md`.
Additional (needed by acceptance criteria): `.github/workflows/freeze-warning.yml` (scheduled PR warning), `.github/workflows/deploy-test.yml` (runs deploy.test.sh in CI), `infra/scripts/check-migrations.mjs` + `.test.mjs` (expand-only check), `package.json` (extend `test:ci-scripts` globs to include the freeze test), `.github/workflows/images.yml` (make the build reusable for staging via `workflow_call`).

### Sibling Sweep
- `healthcheck.sh` polls all services together; deploy needs a per-service variant (add `--service`/replica loop in `deploy.sh`, keep `healthcheck.sh` behaviour unchanged since `compose-smoke.sh` uses it).
- `images.yml` publish is main-only; `staging` needs the same signed-image path so prod promotion deploys the identical SHA.
- `infra/caddy` and `infra/terraform` are unaffected. No other deploy/freeze code to sweep.

### History
No introducing commit (greenfield). Prior related work: #97 (`c4a31bcd`, compose.prod), #98 (`2d6f7bad`, Caddy; PR flagged `conformance.omission`, so list every requirement explicitly here), #3 (CI).

### Recommendation
Implement in one lane (about 17 files, well under split thresholds). Keep timezone logic in a pure, unit-tested `freeze.ts` with a thin `index.ts` (Intl with `Asia/Kolkata`, no client input); reuse it from `freeze-warning.yml`. `deploy.sh` runs on the VPS over pinned-host-key SSH, records `/opt/causedeck/releases/<sha>/release.json` and the previous tags, rolls api and worker then web replicas one at a time with a 60 s `/readyz` gate, and calls `rollback.sh` on failure. Prod promotion verifies a successful staging deployment record for the same SHA within 24 h via the GitHub deployments API. Real SSH/secrets are #116/#108; CI uses docker-in-docker.

### Related Issues
#1 (parent), #97, #98, #3 (dependencies, all closed), #101 (backups), #108 (VPS, human), #116 (GitHub environments and secrets, human).
