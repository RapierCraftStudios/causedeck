#!/usr/bin/env bash
# Run a Turborepo task in CI, limited to what changed on pull requests.
#
#   infra/scripts/ci-affected.sh <task> [-- <args passed to each package's script>]
#
# pull_request / merge_group: `turbo run <task> --filter=...[origin/<base>]` (changed packages plus
# their dependents). The base is CI_BASE_REF, then GITHUB_BASE_REF, then `main`.
# Any other event (push to main, staging, milestone/**) or a local run: the full `turbo run <task>`.
#
# CI_TEST_SHARD=<db|core|web|services|rest> (task `test` only) narrows the run to one package group of
# the CI test matrix (infra/scripts/ci-test-shard.mjs), intersected with the change-aware filter above.
# TURBO_FILTER is then the space-separated list of packages in the shard; when the shard has none,
# CI_TEST_SHARD_EMPTY=1 is exported instead and the script exits 0.
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

filter_args=()
if [[ -n $filter ]]; then
  filter_args=("--filter=${filter}")
fi

if [[ $task == test && -n ${CI_TEST_SHARD:-} ]]; then
  if [[ ${CI_AFFECTED_DRY_RUN:-0} == 1 ]]; then
    shard_args=("--filter=<packages of shard ${CI_TEST_SHARD}>")
  else
    mapfile -t shard_args < <(node "$(dirname "$0")/ci-test-shard.mjs" "$CI_TEST_SHARD" "$filter")
  fi
  if [[ ${#shard_args[@]} -eq 0 ]]; then
    echo "Test shard '${CI_TEST_SHARD}': no affected packages, nothing to run."
    if [[ -n ${GITHUB_ENV:-} ]]; then
      echo "CI_TEST_SHARD_EMPTY=1" >>"$GITHUB_ENV"
    fi
    exit 0
  fi
  filter_args=("${shard_args[@]}")
  filter=''
  for arg in "${shard_args[@]}"; do
    filter+="${filter:+ }${arg#--filter=}"
  done
fi

export TURBO_FILTER=$filter
if [[ -n ${GITHUB_ENV:-} ]]; then
  echo "TURBO_FILTER=${filter}" >>"$GITHUB_ENV"
fi

cmd=(pnpm turbo run "$task" "${filter_args[@]}")
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
