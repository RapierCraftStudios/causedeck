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

### Merge-fix note
- The post-merge `turbo run typecheck` failure was exit 127 (`turbo: command not found`): a PATH problem on the checker, not a source conflict. The branch touches no `apps/` or `packages/` files, so no symbol or key collision is possible there.
- Verified instead: `node_modules/.bin/tsc -p .github/actions/freeze-guard/tsconfig.json --noEmit` passes; freeze and infra node tests pass (46/46). `lane-check.sh` is not present on this host. No source change needed.

### Post-merge check
`turbo: command not found` was a PATH problem in the check shell, not a code conflict. `pnpm exec turbo run typecheck --concurrency=2` on the merged tree: 24/24 tasks pass, so no rename was needed. V1–V4 and `forgedock check` pass again.

## Merge-check follow-up
`turbo: command not found` (exit 127) was a PATH problem on the check host, not a merge conflict. No code change. Verified with tsc on .github/actions/freeze-guard and node:test for freeze, check-migrations and deploy-workflows (46 pass, 0 fail).

Re-checked after the second merge of the base (restore-drill, worker registry tests): `pnpm exec turbo run typecheck --concurrency=2` passes 24/24; exit 127 was `turbo` missing from the check shell's PATH, not a code conflict, so nothing was renamed.

## Merge-fix note
The reported `turbo: command not found` (exit 127) was an environment/PATH failure, not a merge conflict: no duplicate keys or symbols. `pnpm exec turbo run typecheck --filter='...[origin/milestone/production-infra-scale]'` passes (no workspace package changed), freeze-guard tests pass and its tsconfig typechecks. No code changes needed.

## Merge-fix note (#106, third merge)
`turbo: command not found` (exit 127) was `turbo` missing from the check shell's PATH, not a code conflict. `pnpm exec turbo run typecheck --concurrency=2` passes 24/24 on the merged tree. No source changes.

## Merge-fix note (#106, fourth)
`turbo: command not found` (exit 127) is a PATH problem in the check shell, not a code conflict. `pnpm exec turbo run typecheck` passes 24/24. No source changes.

### Post-merge check
After merging the base, `turbo` was not on PATH (exit 127), which is an environment problem rather than a code conflict. `pnpm exec turbo run typecheck --filter='...[origin/milestone/production-infra-scale]'` exits 0 (22/22 tasks). V1-V3 re-ran green on the merged tree. The `runChecks` rename in 063c99c3 already removed the same-name collision with doctor.ts. No code change was needed.

## Merge-fix: turbo typecheck exit 127
Cause: `turbo` not on PATH in the check shell (host environment), not a code conflict. With node_modules/.bin on PATH, `turbo run typecheck` passes (24/24). No source change.

## Merge-fix (fifth): turbo typecheck exit 127
Cause: `turbo` not on PATH in the check shell (host environment), not a symbol or key collision. With `node_modules/.bin` on PATH, `turbo run typecheck --filter='...[origin/milestone/production-infra-scale]'` passes (22/22). No source change.

## Conformance fix
R16 was missing from result.json (dropped in an earlier rewrite). Re-added as implemented: `enabled` defaults to false in both Stage C modules (aws-ecs-fargate/variables.tf:1, aws-elasticache/variables.tf:1), and every resource is gated by `count = var.enabled ? 1 : 0`. The 'Stage C skeletons are disabled by default' test in stage-b-policy.test.mjs (line 286) covers this. V1-V4 re-run green.
