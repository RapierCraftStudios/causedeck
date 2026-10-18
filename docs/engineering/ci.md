# Continuous integration

CI is GitHub Actions. It gates every pull request, and the ForgeDock pipeline merges only on green checks. Spec: technical spike (#1) §1 (Testing), §2 (`.github/workflows`), §10. Issue #3.

## Workflows

| Workflow | File | Triggers | Jobs |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | `pull_request`, `push` to `main`, `staging`, `milestone/**`, `merge_group` | `lint`, `typecheck`, `test`, `build` |
| Security | `.github/workflows/security.yml` | `pull_request`, `push` to `main`, `staging`, `milestone/**`, weekly cron (Mon 02:30 UTC), manual | `audit`, `gitleaks`, `codeql`, `dependency-review` (PRs only) |
| Lint workflows | `.github/workflows/lint-workflows.yml` | `pull_request` and `push` touching `.github/**` | `actionlint` |
| Dependabot | `.github/dependabot.yml` | weekly | npm (one grouped `catalog` PR), github-actions (workflows and `.github/actions/*`) |

Every job bootstraps with the composite action `.github/actions/setup` (pnpm from `packageManager`, Node from `.nvmrc` with the pnpm store cache, `pnpm install --frozen-lockfile`, `.turbo` cache). Later workflows (e2e #16, Storybook #8, deploys) reuse it after `actions/checkout`.

### CI jobs

Each job is matrix-free, runs on `ubuntu-latest` with `timeout-minutes: 15`, and calls `infra/scripts/ci-affected.sh <task>`.

| Job | Runs |
|---|---|
| `lint` | `pnpm format:check`, then ESLint (`turbo run lint`) |
| `typecheck` | `tsc --noEmit` (`turbo run typecheck`) |
| `test` | Vitest with coverage and JUnit reports, then the zero-test guard, then uploads the `test-reports` artifact (`coverage/` and `reports/junit.xml` per package) |
| `build` | `turbo run build` |

## Required status checks

Configure branch protection (or a ruleset) on `main`, `staging` and `milestone/**` to require exactly these checks:

- `lint`
- `typecheck`
- `test`
- `build`

The job ids and names in `ci.yml` are these exact strings; renaming one silently drops it from protection. Security jobs are not required checks: CodeQL and dependency review need GitHub Advanced Security on this private repository (see below).

## Change-aware filtering

`infra/scripts/ci-affected.sh <task> [-- <script args>]`:

- `pull_request` and `merge_group`: `turbo run <task> --filter=...[origin/<base>]`, i.e. the packages changed since the base branch plus their dependents. The base is the PR's base branch (`main`, `staging` or a `milestone/**` branch), falling back to `main`. Checkouts use `fetch-depth: 0` so the base is available.
- Any other event (pushes to protected branches) and local runs: the full `turbo run <task>`.

A PR touching only `packages/ui` runs the four tasks for `@causedeck/ui` and its dependents (`@causedeck/web`), plus the `^lint`/`^typecheck` dependencies turbo requires. Check the set with `pnpm turbo run lint --filter='...[origin/main]' --dry`.

The resolved filter is exported as `TURBO_FILTER` (and written to `$GITHUB_ENV`) for later steps. `CI_AFFECTED_DRY_RUN=1` prints the command instead of running it.

## Caching

- pnpm store: `actions/setup-node` with `cache: pnpm`, keyed on `pnpm-lock.yaml`.
- Turborepo: `actions/cache` on `.turbo`, key `${{ runner.os }}-turbo-${{ github.sha }}`, restore-keys `${{ runner.os }}-turbo-`. Re-running CI on an unchanged commit restores every task from cache (turbo logs `cache hit, replaying logs`), so the four jobs finish in about a minute each.
- Remote cache (optional): set the `TURBO_TOKEN` secret and `TURBO_TEAM` variable. When unset they are empty and turbo uses only the local cache. `turbo.json` passes them through without hashing them.
- `turbo.json` caches `coverage/**` and `reports/**` for `test`, so JUnit reports exist on cache hits too.

## Zero-test guard

`infra/scripts/check-test-reports.mjs` asks turbo which workspaces ran `test` (same `TURBO_FILTER`) and fails if any of them has no `reports/junit.xml` or reports zero tests. This catches suites that are skipped silently, for example a broken `include` glob. Do not use `--passWithNoTests`; give a new workspace at least a smoke test. Workspaces without a `test` script (`e2e` until #16) are skipped.

Unit tests for the CI scripts: `pnpm test:ci-scripts` (`node --test infra/scripts/`).

## Security workflow

- `audit`: `pnpm audit:prod` (`pnpm audit --prod --audit-level high`). Fails on a high or critical advisory in production dependencies.
- `gitleaks`: scans the full git history with the gitleaks CLI image, pinned by digest. It does not use `gitleaks/gitleaks-action`, which requires a `GITLEAKS_LICENSE` secret for organisation repositories.
- `codeql`: `javascript-typescript`, `build-mode: none`. The only job with `security-events: write`.
- `dependency-review`: PRs only, `fail-on-severity: high`.

CodeQL result upload and dependency review require GitHub Advanced Security (Code Security) on a private repository. Until it is enabled those two jobs fail; `audit` and `gitleaks` work without it.

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
2. **Cache hit**: re-run all jobs on the same commit; each completes in under 3 minutes with `cache hit` lines from turbo.
3. **Audit failure**: on a throwaway branch, add a production dependency with a known high advisory; `audit` fails.
4. **Secret scan**: on a throwaway branch, commit a dummy credential (for example a fake AWS key `AKIA` + 16 characters); `gitleaks` fails. Delete the branch afterwards.
5. **No secrets**: runs from a fork, or with `TURBO_TOKEN` unset, are green.
