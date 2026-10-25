#!/usr/bin/env bash
# Proves the 180-day CERT-In log retention (#102).
#
#   verify-retention.sh --fixture   time-travel fixture: no services needed (CI, local)
#   verify-retention.sh             live check against Loki (LOKI_URL, default http://127.0.0.1:3100)
#
# Fixture: creates log objects aged 0..199 days with `touch -d`, runs the retention policy that
# loki-config.yml and lifecycle.json declare (a `find` sweep standing in for the compactor) and
# asserts that everything younger than 180 days, including the 170-day object, survives and that
# only objects past the configured retention are removed.
# Live: once logs exist, the oldest entry must be at least 180 days old, or, while the stack is
# younger than that, nothing may have been deleted since the first ingest
# (FIRST_INGEST_EPOCH, from /var/lib/causedeck/monitoring/first-ingest or the env).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIN_DAYS=180
DAY=86400

fail() { echo "FAIL: $*" >&2; exit 1; }

config_hours="$(sed -n 's/^[[:space:]]*retention_period:[[:space:]]*\([0-9]*\)h.*/\1/p' "$here/../loki/loki-config.yml" | head -n1)"
lock_days="$(sed -n 's/.*"days":[[:space:]]*\([0-9]*\).*/\1/p' "$here/lifecycle.json" | head -n1)"
[ -n "$config_hours" ] || fail "retention_period not found in loki-config.yml"
[ "$config_hours" -ge $((MIN_DAYS * 24)) ] || fail "retention_period ${config_hours}h is below $((MIN_DAYS * 24))h"
[ "${lock_days:-0}" -ge "$MIN_DAYS" ] || fail "object lock ${lock_days:-0}d is below ${MIN_DAYS}d"
retention_days=$((config_hours / 24))

fixture() {
  local dir now age
  dir="$(mktemp -d "${TMPDIR:-/tmp}/retention.XXXXXX")"
  trap "rm -rf '$dir'" EXIT
  now="$(date +%s)"
  for age in 0 30 90 170 175 179 181 199 201 230; do
    touch -d "@$((now - age * DAY - 3600))" "$dir/chunk-${age}d"
  done
  # Compaction: remove only objects older than the configured retention.
  find "$dir" -type f -mmin +$((retention_days * 24 * 60)) -delete
  for age in 0 30 90 170 175 179 181 199; do
    [ -e "$dir/chunk-${age}d" ] || fail "chunk-${age}d was deleted before ${retention_days}d retention"
  done
  for age in 201 230; do
    [ ! -e "$dir/chunk-${age}d" ] || fail "chunk-${age}d should have expired after ${retention_days}d"
  done
  echo "OK: logs older than 170 days survive compaction; expiry only after ${retention_days}d"
}

live() {
  local loki="${LOKI_URL:-http://127.0.0.1:3100}" state="${FIRST_INGEST_FILE:-/var/lib/causedeck/monitoring/first-ingest}"
  local first="${FIRST_INGEST_EPOCH:-}" now oldest
  [ -n "$first" ] || { [ -r "$state" ] && first="$(cat "$state")"; } || true
  now="$(date +%s)"
  [ -n "$first" ] || fail "FIRST_INGEST_EPOCH or $state is required for the live check"
  oldest="$(curl -fsS -G "$loki/loki/api/v1/query_range" \
    --data-urlencode 'query={env=~".+"}' --data-urlencode "start=${first}000000000" \
    --data-urlencode "end=${now}000000000" --data-urlencode 'direction=forward' \
    --data-urlencode 'limit=1' |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).data.result;const t=r.flatMap(x=>x.values.map(v=>Number(v[0]))).sort()[0];console.log(t===undefined?"":Math.floor(t/1e9))})')"
  if [ -z "$oldest" ]; then echo "OK: no logs stored yet"; return; fi
  if [ $((now - first)) -ge $((MIN_DAYS * DAY)) ]; then
    [ $((now - oldest)) -ge $((MIN_DAYS * DAY)) ] || fail "oldest log is $(((now - oldest) / DAY))d old, expected at least ${MIN_DAYS}d"
  else
    [ "$oldest" -le $((first + 3600)) ] || fail "logs from the first hour after first ingest were deleted early"
  fi
  echo "OK: oldest log is $(((now - oldest) / DAY))d old; nothing was deleted early"
}

case "${1:-}" in
  --fixture) fixture ;;
  '') live ;;
  *) fail "usage: verify-retention.sh [--fixture]" ;;
esac
