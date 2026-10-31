#!/usr/bin/env bash
# Readiness aggregator for deploys (#97, used by #100): polls /readyz of web, api and worker and
# /healthz of admin (it has no /readyz) from inside their containers, so it works while nothing is
# published. Exits 0 only when every replica is ready within TIMEOUT seconds.
#
#   CAUSEDECK_ENV_FILE=/etc/causedeck/prod.env infra/scripts/healthcheck.sh [timeout-seconds]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/compose.prod.yml}"
TIMEOUT="${1:-${TIMEOUT:-120}}"
: "${CAUSEDECK_ENV_FILE:?set CAUSEDECK_ENV_FILE}"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$CAUSEDECK_ENV_FILE" "$@"; }

# service:port:path
TARGETS=("web:3000:/readyz" "api:3001:/readyz" "worker:3003:/readyz" "admin:3200:/healthz")

probe() {
  local service="$1" port="$2" path="$3"
  compose exec -T "$service" node -e \
    "fetch('http://127.0.0.1:${port}${path}').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
    >/dev/null 2>&1
}

deadline=$((SECONDS + TIMEOUT))
failed=()
while :; do
  failed=()
  for target in "${TARGETS[@]}"; do
    IFS=: read -r service port path <<<"$target"
    probe "$service" "$port" "$path" || failed+=("$service$path")
  done
  if [ "${#failed[@]}" -eq 0 ]; then
    echo "healthcheck: all services ready"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "healthcheck: not ready after ${TIMEOUT}s: ${failed[*]}" >&2
    exit 1
  fi
  sleep 3
done
