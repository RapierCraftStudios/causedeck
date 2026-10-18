#!/usr/bin/env bash
# Stop the local dev stack. Volumes (database, object storage) are kept; see dev-reset.sh.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
docker compose -f "$root/infra/docker/compose.dev.yml" down --remove-orphans
