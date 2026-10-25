#!/usr/bin/env bash
# Synthetic alert delivery test (#102, CI): fires a P0 and a P1 alert into Alertmanager and asserts
# that the on-call webhook and the fallback receiver both get them, through the webhook mock.
#   bash infra/monitoring/test/synthetic-alert.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$here/../compose.monitoring.yml"
project=causedeck-monitoring-ci
export LOKI_S3_ACCESS_KEY=ci LOKI_S3_SECRET_KEY=ci-secret-key GRAFANA_ADMIN_PASSWORD=ci
export APP_NETWORK="${project}_app" DATA_NETWORK="${project}_data"

dc() { docker compose -p "$project" -f "$compose_file" --profile ci "$@"; }
cleanup() { dc down -v --remove-orphans >/dev/null 2>&1 || true; docker network rm "$APP_NETWORK" "$DATA_NETWORK" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$APP_NETWORK" >/dev/null
docker network create "$DATA_NETWORK" >/dev/null
dc up -d alertmanager webhook-mock

for _ in $(seq 1 30); do
  dc exec -T alertmanager wget -q -O /dev/null http://127.0.0.1:9093/-/ready 2>/dev/null && break
  sleep 2
done

for priority in P0 P1; do
  dc exec -T alertmanager amtool --alertmanager.url=http://127.0.0.1:9093 alert add \
    "alertname=Synthetic${priority}" "priority=${priority}" severity=page \
    --annotation=summary="synthetic ${priority} delivery test"
done

deliveries() { dc exec -T webhook-mock node -e "fetch('http://127.0.0.1:9095/').then(r=>r.text()).then(console.log)"; }

# group_wait is 10 s for on-call and 2 min for the fallback receiver.
for _ in $(seq 1 90); do
  seen="$(deliveries)"
  if grep -q '"/oncall"' <<<"$seen" && grep -q '"/fallback"' <<<"$seen"; then
    grep -q 'SyntheticP0' <<<"$seen" || { echo "FAIL: P0 not delivered" >&2; exit 1; }
    grep -q 'SyntheticP1' <<<"$seen" || { echo "FAIL: P1 not delivered" >&2; exit 1; }
    echo "OK: P0 and P1 reached the on-call and fallback receivers"
    exit 0
  fi
  sleep 2
done
echo "FAIL: alerts were not delivered to both receivers: $(deliveries)" >&2
exit 1
