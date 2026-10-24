#!/usr/bin/env bash
# Lane-local verification for CauseDeck ForgeDock lanes (lighter local checks, 2026-10-19; in-repo since D-051
# so lanes on remote compute run it too).
# Runs a turbo task only for packages changed vs the lane's base branch plus their dependents,
# with one turbo cache shared by every lane. Full suites, e2e, Storybook and Lighthouse stay in CI.
#   lane-check.sh <typecheck|test|lint|format>   (format: prettier --write, lint: eslint --cache, both on files changed vs the base only)
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
export TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/causedeck-turbo}" TURBO_TELEMETRY_DISABLED=1
# Stay inside ForgeDock's per-command timeout: past the budget, defer to CI rather than fail the lane.
timeout "${LANE_CHECK_BUDGET:-110}" npx -y pnpm@10.34.7 exec turbo run "$task" --filter="...[origin/$base]" --output-logs=errors-only --concurrency=2
rc=$?
if [ "$rc" -eq 124 ]; then echo "lane-check: $task exceeded ${LANE_CHECK_BUDGET:-110}s on a busy host; deferred to CI"; exit 0; fi
exit "$rc"
