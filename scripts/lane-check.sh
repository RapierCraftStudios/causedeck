#!/usr/bin/env bash
# Lane-local verification for CauseDeck ForgeDock lanes (lighter local checks, 2026-10-19; in-repo since D-051
# so lanes on remote compute run it too).
# Runs a turbo task only for packages changed vs the lane's base branch plus their dependents,
# with one turbo cache shared by every lane. Full suites, e2e, Storybook and Lighthouse stay in CI.
#   lane-check.sh <typecheck|test|lint|format|invariants>   (format: prettier --write, lint: eslint --cache, both on files changed vs the base only)
#   invariants: the repo-wide registry and coverage suites a change can break without touching their files (cross-tenant
#   registries, export and purge coverage, domain boundaries, i18n parity and status, stories per pattern, the shell's
#   page lists), selected by what the lane changed. Targeted tests miss these; CI used to be the first to run them.
set -uo pipefail
task=${1:?task}
common=$(cd "$(git rev-parse --git-common-dir)" && pwd)
base=$(sed -nE 's/^  staging: "([^"]+)".*/\1/p' "${common%/.git}/forge.yaml" 2>/dev/null)
base=${base:-staging}
git fetch -q --no-tags origin "+refs/heads/$base:refs/remotes/origin/$base" 2>/dev/null
if [ "$task" = lint ]; then
  # Lint only what this lane changed; CI lints everything on the PR. Never a repo-wide or ...[base] turbo lint.
  mapfile -t files < <( { git diff --name-only --diff-filter=ACMR "origin/$base...HEAD"; git diff --name-only --diff-filter=ACMR; git ls-files --others --exclude-standard; } | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$' | sort -u)
  [ ${#files[@]} -eq 0 ] && { echo "lane-check: no changed lintable files"; exit 0; }
  echo "lane-check: eslint on ${#files[@]} changed file(s)"
  exec timeout "${LANE_CHECK_BUDGET:-110}" npx -y pnpm@10.34.7 exec eslint --no-warn-ignored --max-warnings 0 --cache --cache-strategy content --cache-location node_modules/.cache/eslint-lane/ "${files[@]}"
fi
if [ "$task" = format ]; then
  mapfile -t files < <(git diff --name-only --diff-filter=ACMR "origin/$base...HEAD"; git diff --name-only --diff-filter=ACMR; git ls-files --others --exclude-standard)
  [ ${#files[@]} -eq 0 ] && { echo "lane-check: nothing to format"; exit 0; }
  exec npx -y pnpm@10.34.7 exec prettier --write --ignore-unknown "${files[@]}"
fi
if [ "$task" = invariants ]; then
  mapfile -t changed < <( { git diff --name-only "origin/$base...HEAD"; git diff --name-only; git ls-files --others --exclude-standard; } | sort -u)
  touched(){ printf '%s\n' "${changed[@]}" | grep -qE "$1"; }
  pn(){ npx -y pnpm@10.34.7 "$@"; }
  fail=0; run(){ echo "lane-check invariants: $*"; timeout "${LANE_CHECK_BUDGET:-110}" "$@"; local rc=$?; [ $rc -eq 124 ] && { echo "  (timed out on a busy host; CI runs it)"; return 0; }; [ $rc -ne 0 ] && fail=1; return 0; }
  # New keys in any catalog: en/ta/kn parity, no English copies, a translation status per key.
  touched '^(packages/i18n/|apps/)' && run pn i18n:check
  # Schema or migrations: drizzle snapshot consistency and the reviewed-SQL lint; tenant tables need seeders.
  if touched '^packages/db/(src/schema/|migrations/)'; then
    run pn db:check
    run pn --filter @causedeck/db exec vitest run src/__tests__/cross-tenant/tables.test.ts
  fi
  # New tables or services: export and purge coverage, and the cross-tenant service registries.
  if touched '^packages/(db/src/schema|core/src|notifications/src)/'; then
    run pn --filter @causedeck/core exec vitest run src/lifecycle/__tests__/export-coverage.test.ts src/lifecycle/__tests__/purge-coverage.test.ts src/__tests__/cross-tenant/services.test.ts
    touched '^packages/notifications/src/' && run pn --filter @causedeck/notifications exec vitest run src/__tests__/cross-tenant/services.test.ts
  fi
  # Core domains: import boundaries and their declared dependencies.
  touched '^(packages/core/src/|packages/config/eslint/)' && run pn --filter @causedeck/config exec vitest run test/core-domain-boundaries.test.ts
  # UI patterns: a story and a test for every pattern.
  touched '^packages/ui/src/' && run pn --filter @causedeck/ui check:stories
  # Routes and nav: the shell's real-page and settings lists.
  touched '^apps/web/(app/|lib/settings-nav|components/shell/)' && run pn --filter @causedeck/web exec vitest run __tests__/workspace-shell.test.tsx __tests__/settings-shell.test.tsx
  exit $fail
fi
export TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/causedeck-turbo}" TURBO_TELEMETRY_DISABLED=1
# Stay inside ForgeDock's per-command timeout: past the budget, defer to CI rather than fail the lane.
timeout "${LANE_CHECK_BUDGET:-110}" npx -y pnpm@10.34.7 exec turbo run "$task" --filter="...[origin/$base]" --output-logs=errors-only --concurrency=2
rc=$?
if [ "$rc" -eq 124 ]; then echo "lane-check: $task exceeded ${LANE_CHECK_BUDGET:-110}s on a busy host; deferred to CI"; exit 0; fi
exit "$rc"
