#!/usr/bin/env bash
# Pull requests: list the files changed against the base branch and decide which lint checks must run.
#
#   infra/scripts/ci-changed-files.sh
#
# Writes the changed files (added, copied, modified, renamed) to $RUNNER_TEMP/changed-files.txt and
# these step outputs to $GITHUB_OUTPUT:
#   prettier_full  true when Prettier's own configuration or tooling changed, so every file is checked
#   docs_checks    true when a docs-check input changed (docs/, auth permissions, root tooling, workflows)
# Base: CI_BASE_REF, then GITHUB_BASE_REF, then `main`.
set -euo pipefail

base=${CI_BASE_REF:-${GITHUB_BASE_REF:-main}}
base=${base#refs/heads/}
if ! git rev-parse --verify --quiet "origin/${base}^{commit}" >/dev/null; then
  git fetch --no-tags origin "+refs/heads/${base}:refs/remotes/origin/${base}"
fi

out=${RUNNER_TEMP:-/tmp}/changed-files.txt
git diff --name-only --diff-filter=ACMRT "origin/${base}...HEAD" >"$out"
echo "Changed files: $(wc -l <"$out")"

prettier_full=false
docs_checks=false
if grep -qE '(^|/)(\.prettierrc[^/]*|\.prettierignore|prettier\.config\.[^/]*)$|^packages/config/prettier|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$|^package\.json$' "$out"; then
  prettier_full=true
fi
if grep -qE '^(docs/|packages/auth/|pnpm-lock\.yaml$|package\.json$|\.github/)' "$out"; then
  docs_checks=true
fi

echo "prettier_full=${prettier_full}"
echo "docs_checks=${docs_checks}"
if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  {
    echo "prettier_full=${prettier_full}"
    echo "docs_checks=${docs_checks}"
  } >>"$GITHUB_OUTPUT"
fi
