#!/usr/bin/env bash
# Stop the local dev stack and delete its volumes, after explicit confirmation.
#
#   infra/scripts/dev-reset.sh [--yes]
#
# Without --yes it asks for the word `yes` and refuses when stdin is not a terminal.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

if [[ ${1:-} != --yes ]]; then
  if [[ ! -t 0 ]]; then
    echo 'stack:reset: refusing to delete volumes without confirmation (no terminal); pass --yes.' >&2
    exit 1
  fi
  echo 'This deletes ALL local dev data: the Postgres database and every MinIO object.'
  read -r -p 'Type "yes" to continue: ' answer
  if [[ $answer != yes ]]; then
    echo 'stack:reset: aborted, nothing was deleted.' >&2
    exit 1
  fi
fi

docker compose -f "$root/infra/docker/compose.dev.yml" --profile init down -v --remove-orphans
echo "Volumes removed. Run 'pnpm stack:up' to recreate the stack."
