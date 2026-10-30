#!/usr/bin/env bash
# Production promotion gate (#100): the same image sha must have a successful staging deployment
# (deploy-staging.yml only reports success after smoke.sh passed) within MAX_AGE_HOURS (default 24).
#
#   GH_TOKEN=... GITHUB_REPOSITORY=org/repo SHA=<gitsha> check-promotion.sh
set -euo pipefail

: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${SHA:?}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "promotion: SHA must be a full 40-character commit sha" >&2; exit 1; }
max_age=$(( ${MAX_AGE_HOURS:-24} * 3600 ))
now="$(date -u +%s)"

for id in $(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=staging&sha=$SHA&per_page=30" --jq '.[].id'); do
  # Statuses are newest first; only the latest one counts (a later failure voids an earlier success).
  read -r state created < <(gh api "repos/$GITHUB_REPOSITORY/deployments/$id/statuses?per_page=1" \
    --jq '.[0] | "\(.state) \(.created_at)"' 2>/dev/null || echo "none 1970-01-01T00:00:00Z")
  [ "$state" = success ] || continue
  age=$(( now - $(date -u -d "$created" +%s) ))
  if [ "$age" -le "$max_age" ]; then
    echo "promotion: $SHA deployed to staging with a green smoke $((age / 60)) min ago"
    exit 0
  fi
done
echo "::error title=Not promotable::$SHA has no successful staging deployment in the last $((max_age / 3600)) h; merge it to staging first" >&2
exit 1
