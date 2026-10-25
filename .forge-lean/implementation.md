### Approach
Pure IST freeze logic (`freeze.ts`) shared by the composite action and the warning workflow; thin SSH wrapper (`remote-deploy.sh`) pins the host key; `deploy.sh` and `rollback.sh` run on the VPS; images.yml is reused through `workflow_call`.

### Changes
- `.github/actions/freeze-guard/*`: freeze logic, entrypoint, action, tests, tsconfig (for lint).
- `.github/workflows/deploy-staging.yml`, `deploy-prod.yml`, `hotfix-prod.yml`: staging, production (freeze first job, promotion, `production` environment) and hotfix (`hotfix` environment, audit comment, Slack payload).
- `.github/workflows/freeze-warning.yml`: hourly warning on `deploy:prod` PRs.
- `.github/workflows/deploy-test.yml`: runs `deploy.test.sh` with Docker in CI.
- `.github/workflows/images.yml`: `workflow_call` with `publish`, branch-name tag.
- `infra/scripts/deploy.sh`, `rollback.sh`, `smoke.sh`, `remote-deploy.sh`, `check-promotion.sh`, `check-migrations.mjs`: deploy pipeline.
- `infra/scripts/deploy.test.sh`, `check-migrations.test.mjs`, `deploy-workflows.test.mjs`: tests.
- `infra/runbooks/court-day-freeze.md`: runbook. `package.json`: runs `.github/actions/*/test` in `test:ci-scripts`.

### Acceptance Criteria Status
- R1 ✅ freeze.ts:28, freeze.test.ts
- R2 ✅ deploy-prod.yml:27 (freeze job first), deploy-workflows.test.mjs
- R3 ✅ deploy-staging.yml:14
- R4 ✅ deploy-prod.yml:40, check-promotion.sh
- R5 ✅ deploy.sh (order), deploy.test.sh (CI only)
- R6 ✅ rollback.sh, deploy.sh:80
- R7 ✅ deploy.test.sh probe (CI only)
- R8 ✅ hotfix-prod.yml:36
- R9 ✅ check-migrations.mjs:30
- R10 ✅ deploy.sh write_release; `/readyz` already reports `GIT_SHA` (packages/observability/src/health.ts:83)
- R11 ✅ remote-deploy.sh (StrictHostKeyChecking=yes, pinned known_hosts)
- R12 ✅ court-day-freeze.md
- R13 ✅ freeze-warning.yml
- R14 ✅ deploy-prod.yml promote job
- R15 ✅ court-day-freeze.md "Hot-deployable changes"

### Verification
- V1 freeze tests: pass. V2: pass (89 tests with all infra tests). V3 bash -n: pass. V4 checks.mjs: pass. `forgedock check`: PASS.
- New tests fail without the fix (the modules and workflows do not exist on base).
- Not run locally: `deploy.test.sh` (needs Docker; runs in deploy-test.yml) and actionlint (CI).

### Notes
- Secrets needed in GitHub environments: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, GHCR_USER, GHCR_PULL_TOKEN; SLACK_WEBHOOK_URL in `hotfix`.
- Freeze clock is never an input (no FREEZE_NOW override); tests inject a Date.
- Fixed an invalid-YAML step name in deploy-prod.yml found by prettier.
