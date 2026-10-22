# Continuous integration

CI is GitHub Actions. It gates every pull request, and the ForgeDock pipeline merges only on green checks. Spec: technical spike (#1) §1 (Testing), §2 (`.github/workflows`), §10. Issue #3.

## Workflows

| Workflow | File | Triggers | Jobs |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | `pull_request`, `push` to `main`, `staging` and ForgeDock lane branches `feat/issue-*-lean`, `merge_group` | `lint`, `typecheck`, `test`, `build`, `tenancy` |
| Security | `.github/workflows/security.yml` | `pull_request`, `push` to `main`, `staging`, `milestone/**`, weekly cron (Mon 02:30 UTC), manual | `audit`, `gitleaks`, `codeql`, `dependency-review` (PRs only) |
| Lint workflows | `.github/workflows/lint-workflows.yml` | `pull_request` and `push` touching `.github/**` | `actionlint` |
| Dependabot | `.github/dependabot.yml` | weekly | npm (one grouped `catalog` PR), github-actions (workflows and `.github/actions/*`) |

Every job bootstraps with the composite action `.github/actions/setup` (pnpm from `packageManager`, Node from `.nvmrc` with the pnpm store cache, a Turborepo cache chosen by its `turbo-cache` input, `pnpm install --frozen-lockfile`). Later workflows (e2e #16, Storybook #8, deploys) reuse it after `actions/checkout`.

### CI jobs

All jobs run on `ubuntu-latest`. `lint`, `typecheck` and `build` have `timeout-minutes: 15` and call `infra/scripts/ci-affected.sh <task>`; `tenancy` (`timeout-minutes: 6`) always runs in full. `test` is a matrix of shards plus an aggregating job (D-047, below).

| Job | Runs |
|---|---|
| `lint` | Prettier (changed files only on pull requests, else `pnpm format:check`), then the docs checks (`pnpm adr:lint`, `pnpm adr:test`, `pnpm docs:links`, `pnpm docs:permissions:check`; see [docs/adr](../adr/README.md)), then ESLint (`turbo run lint`), then `docker compose -f infra/docker/compose.dev.yml config -q` (dev stack definition, #5) |
| `typecheck` | `tsc --noEmit` (`turbo run typecheck`) |
| `test` | The required check: an aggregating job that `needs` every `test-shard` and fails unless all of them succeeded. It runs no tests itself |
| `test-shard (<group>)` | One per package group: Vitest with coverage and JUnit reports, then the zero-test guard, then uploads the `test-reports-<group>` artifact (`coverage/` and `reports/junit.xml` per package). `rest` also runs `pnpm db:check`, `pnpm i18n:check` and `pnpm --filter @causedeck/adapters test:golden` (committed synthetic fixtures only) |
| `build` | `turbo run build` |
| `tenancy` | The cross-tenant suite (#19, #209), always in full: a `pgvector/pgvector:0.8.7-pg17` service gets the dev init SQL (`infra/docker/postgres/init/*.sql`) and `pnpm db:migrate`, then `pnpm db:check-rls` and `pnpm test:tenancy` (Testcontainers, a 4-minute step timeout). Any failure is a release blocker; see [tenancy.md](tenancy.md#cross-tenant-suite) |

### Fast lane gate (D-047)

A lane PR runs in about 6 minutes (it was about 16). Nothing is dropped; the work is cached, split and narrowed.

- **Test shards.** `infra/scripts/ci-test-shard.mjs` groups the workspaces by measured Vitest duration: `db` (db, auth), `core`, `web`, `services` (admin, api, worker) and `rest` (every other workspace, so a new package is picked up automatically). `ci-affected.sh` intersects the shard with the change-aware filter (`CI_TEST_SHARD`); a shard with no affected package passes with nothing to run. `CI_TURBO_CONCURRENCY=3` still caps Testcontainers suites per runner. To rebalance, edit `NAMED_SHARDS` and the `shard` matrix in `ci.yml` together.
- **Required check.** `test` is the job that `needs: test-shard` with `if: always()`; a failed, cancelled or skipped shard fails it. Branch protection keeps requiring `test`; never require the `test-shard (...)` names.
- **Prettier.** On `pull_request` only the files changed against the base (`git diff --name-only --diff-filter=ACMRT origin/<base>...HEAD`) are checked; the full `prettier --check .` runs on push, `merge_group` and whenever Prettier's config, the lockfile or the root `package.json` changed (`infra/scripts/ci-changed-files.sh`).
- **Docs checks** (ADR lint, ADR script tests, docs links, permissions doc) run on pushes and merge groups, and on pull requests that change `docs/`, `packages/auth/`, the lockfile, the root `package.json` or `.github/`.
- **ESLint cache.** Lane PRs (base `milestone/**`) pass `--cache --cache-strategy content` and restore `.cache/eslint` with `actions/cache`. Ship PRs, pushes and merge groups lint without it, because typed linting (`projectService`) can go stale when a type changes in a file that did not. Turbo's own lint cache is exact and is always on.
- **Next.js cache.** `build` restores `apps/*/.next/cache` with `actions/cache`.
- **Cross-tenant gate.** `tenancy` is unchanged and still runs in full on every PR. 

## Tiers (D-044, loosened by D-045 and D-046)

CI runs in tiers so lane PRs stay fast, ship PRs carry one heavy gate, and the slow suites only report.

| Tier | When | Jobs |
| --- | --- | --- |
| **Fast** (every PR) | Every pull request, including lane PRs into `milestone/*` | `lint` (format, ADR, docs links, affected lint), `typecheck`, `test`, `build` — change-aware via `infra/scripts/ci-affected.sh`; `audit`, `gitleaks`; `storybook` build + interaction/axe tests (light and dark) for `packages/ui` and, in the `storybook-web` job, for the `apps/web` Storybook (courts components, #426) when `packages/ui`, `packages/i18n`, `apps/web/components` or the web Storybook config change (path filter); `actionlint` when `.github/` changes |
| **Ship** | Ship PRs into `staging` or `main`, pushes to `main`, or any PR labelled `full-ci` | Everything in Fast, plus `e2e` (2 shards, `E2E_SCOPE=ship`, 30 min timeout): the one heavy merge gate |
| **Report-only** | Nightly schedule, manual dispatch, or a PR labelled `full-ci`; `continue-on-error`, never blocks a merge | `lighthouse` (perf/a11y budgets), `visual` (Storybook visual regression, 4 shards); nightly and dispatch also run `e2e` with `E2E_SCOPE=full` (90 min timeout) |

- **e2e scope (D-046).** `E2E_SCOPE=ship` runs all non-visual specs on `chromium-1280-light`, `@smoke` on `chromium-360-light` and `webkit-360`, and skips `*.visual.spec.ts` (about 340 tests). `E2E_SCOPE=full` is the 6-project Chromium matrix (360/768/1280, light/dark) plus visual specs and the WebKit smoke; it is the default locally (`E2E_SCOPE=ship pnpm --filter @causedeck/e2e test` reproduces the gate) and what the nightly/dispatch run uses. The 6x matrix repeated functional coverage and could not finish inside the timeout.
- Pushes to `milestone/**` no longer trigger workflows: every change there arrives through a PR that already ran CI (this removed the duplicate push + PR runs).
- Pushes to `staging` no longer re-run e2e: the ship PR already ran it.
- Pushes to ForgeDock lane branches (`feat/issue-*-lean`) run CI (full, not change-aware: a push has no base) so lanes verify on GitHub runners before review (`forge.yaml` `verify.mode: ci`) instead of type-checking and testing on the shared lane host. The lane PR then runs CI again; the repo is public, so standard runners cost nothing.
- Visual baselines are regenerated on demand (`visual:update` label), not on every ship.
- To run the full suite on a lane PR, add the `full-ci` label; other label events do not re-run anything.
- `codeql` and `dependency-review` stay opt-in behind `ENABLE_GHAS` (D-043).

## Required status checks

Configure branch protection (or a ruleset) on `main`, `staging` and `milestone/**` to require exactly these checks:

- `lint`
- `typecheck`
- `test`
- `build`
- `tenancy` (must finish in under 4 minutes; a failure is a release blocker)

The job ids and names in `ci.yml` are these exact strings; renaming one silently drops it from protection. Security jobs are not required checks: CodeQL and dependency review need GitHub Advanced Security on this private repository (see below).

## Change-aware filtering

`infra/scripts/ci-affected.sh <task> [-- <script args>]`:

- `pull_request` and `merge_group`: `turbo run <task> --filter=...[origin/<base>]`, i.e. the packages changed since the base branch plus their dependents. The base is the PR's base branch (`main`, `staging` or a `milestone/**` branch), falling back to `main`. Checkouts use `fetch-depth: 0` so the base is available.
- Any other event (pushes to protected branches) and local runs: the full `turbo run <task>`.

A PR touching only `packages/ui` runs the four tasks for `@causedeck/ui` and its dependents (`@causedeck/web`), plus the `^lint`/`^typecheck` dependencies turbo requires. Check the set with `pnpm turbo run lint --filter='...[origin/main]' --dry`.

The resolved filter is exported as `TURBO_FILTER` (and written to `$GITHUB_ENV`) for later steps. `CI_AFFECTED_DRY_RUN=1` prints the command instead of running it.

## Caching

- pnpm store: `actions/setup-node` with `cache: pnpm`, keyed on `pnpm-lock.yaml`.
- Turborepo (`ci.yml`): the setup action input `turbo-cache: github` runs `rharkor/caching-for-turbo` (pinned by SHA). It starts a local turbo remote-cache server that stores artifacts in the GitHub Actions cache and exports `TURBO_API`, `TURBO_TOKEN` and `TURBO_TEAM` itself, so no secret or paid service is needed. `ci.yml` no longer sets `TURBO_TOKEN`/`TURBO_TEAM`. Other workflows keep the default `turbo-cache: local` (`actions/cache` on `.turbo`). `tenancy` uses `none`: its tasks are never cached.
- Scope: GitHub only lets a run read caches from its own ref, its base branch and the default branch. A re-run or a new push to the same PR hits; a brand-new lane starts cold unless the base branch or `main` has the entry.
- Cache-safe inputs (`turbo.json`): a turbo hash covers the package's own files and its internal dependencies. Several suites read outside their package (static guards that scan `apps/` and `packages/`, `docs/engineering/*.md`, `docs/adr`, the db migrations and `infra/docker/postgres/init/*.sql` for Testcontainers), so the `test` task also hashes `apps/**`, `packages/**`, `docs/adr/**`, `docs/engineering/**` and `infra/docker/**` (build output and node_modules excluded). A test result is therefore reused only when none of those files changed; anything else re-runs. `build`, `lint` and `typecheck` use turbo's default inputs plus the global dependencies (`tsconfig.base.json`, `eslint.config.js`).
- A cache hit never hides a failure: only successful task results are stored, and a failing test is never replayed as a pass.
- `turbo.json` caches `coverage/**` and `reports/**` for `test`, so JUnit reports exist on cache hits too (the zero-test guard needs them).

## Zero-test guard

`infra/scripts/check-test-reports.mjs` asks turbo which workspaces ran `test` (same `TURBO_FILTER`) and fails if any of them has no `reports/junit.xml` or reports zero tests. This catches suites that are skipped silently, for example a broken `include` glob. Do not use `--passWithNoTests`; give a new workspace at least a smoke test. Workspaces without a `test` script (`e2e` until #16) are skipped.

Unit tests for the CI scripts: `pnpm test:ci-scripts` (`node --test` over `infra/scripts/*.test.mjs` and `*.test.ts`, the latter with Node's type stripping).

## Security workflow

- `audit`: `pnpm audit:prod` (`pnpm audit --prod --audit-level high`). Fails on a high or critical advisory in production dependencies.
- `gitleaks`: scans the full git history with the gitleaks CLI image, pinned by digest. It does not use `gitleaks/gitleaks-action`, which requires a `GITLEAKS_LICENSE` secret for organisation repositories.
- `codeql`: `javascript-typescript`, `build-mode: none`. The only job with `security-events: write`.
- `dependency-review`: PRs only, `fail-on-severity: high`.

CodeQL result upload and dependency review require GitHub Advanced Security (Code Security) on a private repository. Both jobs are therefore **opt-in**: they run only when the repository variable `ENABLE_GHAS` is `true` (D-043). Until then they are skipped, and `audit` (pnpm audit, high/critical) and `gitleaks` (secret scan of full history) are the always-on free alternatives.

## Security rules for workflows

- Third-party actions and images are pinned by full commit SHA (or image digest) with a version comment, for example `actions/checkout@<sha> # v7.0.1`. Dependabot proposes updates.
- `permissions: contents: read` at workflow level; jobs widen it only where needed (`codeql`).
- Never `pull_request_target`. No secret is required: forks and fresh clones are green, because the env schema (#4) boots with mock defaults. `actions/checkout` runs with `persist-credentials: false`.
- Concurrency: one group per workflow and ref. Superseded `pull_request` runs are cancelled; runs on `main`, `staging` and `milestone/**` are never cancelled.

## Databases in tests

No `services: postgres`. Integration tests use Testcontainers (#6); `ubuntu-latest` runners provide Docker to the `test` job.

## Reproduce locally

```sh
pnpm install
pnpm format:check
pnpm turbo run lint typecheck test build
# What a PR into main would run:
GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main bash infra/scripts/ci-affected.sh test
# CI-style test run plus the zero-test guard:
pnpm turbo run test -- --coverage --reporter=default --reporter=junit --outputFile.junit=reports/junit.xml
node infra/scripts/check-test-reports.mjs
# Workflow lint (actionlint bundles shellcheck):
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
```

## Verifying the manual acceptance checks

Record these once in the PR that introduces or changes CI:

1. **Affected filter**: open a PR touching only `packages/ui`; the job logs list only `@causedeck/ui`, `@causedeck/web` and their task dependencies.
2. **Cache hit**: re-run all jobs on the same commit; each completes in under 3 minutes with `cache hit` lines from turbo. To prove a cached run still fails, push a commit that breaks a test in one package: its shard and `test` go red.
3. **Audit failure**: on a throwaway branch, add a production dependency with a known high advisory; `audit` fails.
4. **Secret scan**: on a throwaway branch, commit a dummy credential (for example a fake AWS key `AKIA` + 16 characters); `gitleaks` fails. Delete the branch afterwards.
5. **No secrets**: runs from a fork, or with `TURBO_TOKEN` unset, are green.
