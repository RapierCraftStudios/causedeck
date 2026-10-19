#!/usr/bin/env bash
# Run a Turborepo task in CI, limited to what changed on pull requests.
#
#   infra/scripts/ci-affected.sh <task> [-- <args passed to each package's script>]
#
# pull_request / merge_group: `turbo run <task> --filter=...[origin/<base>]` (changed packages plus
# their dependents). The base is CI_BASE_REF, then GITHUB_BASE_REF, then `main`.
# Any other event (push to main, staging, milestone/**) or a local run: the full `turbo run <task>`.
#
# The resolved filter is exported as TURBO_FILTER (and written to $GITHUB_ENV when present) so
# later steps such as check-test-reports.mjs see the same package set.
# CI_AFFECTED_DRY_RUN=1 prints the command instead of running it.
set -euo pipefail

if [[ $# -lt 1 || $1 == -* ]]; then
  echo "usage: $0 <task> [-- <script args>]" >&2
  exit 2
fi
task=$1
shift
if [[ ${1:-} == -- ]]; then
  shift
fi

filter=''
case "${GITHUB_EVENT_NAME:-}" in
  pull_request | merge_group)
    base=${CI_BASE_REF:-${GITHUB_BASE_REF:-main}}
    base=${base#refs/heads/}
    filter="...[origin/${base}]"
    if [[ ${CI_AFFECTED_DRY_RUN:-0} != 1 ]] && ! git rev-parse --verify --quiet "origin/${base}^{commit}" >/dev/null; then
      git fetch --no-tags origin "+refs/heads/${base}:refs/remotes/origin/${base}"
    fi
    ;;
esac

export TURBO_FILTER=$filter
if [[ -n ${GITHUB_ENV:-} ]]; then
  echo "TURBO_FILTER=${filter}" >>"$GITHUB_ENV"
fi

cmd=(pnpm turbo run "$task")
if [[ -n $filter ]]; then
  cmd+=("--filter=${filter}")
fi
# CI_TURBO_CONCURRENCY caps how many packages run at once (turbo's default is 10, too many Testcontainers
# and vitest worker pools for a 4-vCPU runner: workers starve and vitest reports RPC timeouts).
if [[ -n ${CI_TURBO_CONCURRENCY:-} ]]; then
  cmd+=("--concurrency=${CI_TURBO_CONCURRENCY}")
fi
if [[ $# -gt 0 ]]; then
  cmd+=(-- "$@")
fi

if [[ ${CI_AFFECTED_DRY_RUN:-0} == 1 ]]; then
  echo "${cmd[*]}"
  exit 0
fi
echo "+ ${cmd[*]}"
exec "${cmd[@]}"
