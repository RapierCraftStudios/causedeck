#!/bin/sh
# Shared helpers for the backup, replication and restore scripts (#101). POSIX sh: the scripts run
# in the postgres image, the mc image and CI. Source it: `. "$(dirname "$0")/lib/india-guard.sh"`.
# Run directly (`india-guard.sh <endpoint> [region]`) it checks one target, for tests and operators.
#
# Backup storage and every replica stay in India (PRD §8, spike §3). Only a short allow-list of
# India endpoints passes; INDIA_ENDPOINT_ALLOWLIST (comma-separated host suffixes) replaces it when
# a provider is added. Plain-http, in-network hosts pass only with ALLOW_LOCAL_ENDPOINTS=1 (CI/dev).

INDIA_REGIONS="ap-south-1 ap-south-2"
INDIA_DEFAULT_SUFFIXES=".ap-south-1.amazonaws.com,.ap-south-2.amazonaws.com,.e2enetworks.net"

guard_fail() {
  echo "india-guard: $1" >&2
  return 1
}

assert_india_region() {
  for r in $INDIA_REGIONS; do
    [ "$1" = "$r" ] && return 0
  done
  guard_fail "region '$1' is outside India ($INDIA_REGIONS)"
}

assert_india_endpoint() {
  url=${1:-}
  [ -n "$url" ] || guard_fail "empty endpoint" || return 1
  case "$url" in
    http://* | https://*) ;;
    *) guard_fail "'$url' is not an http(s) URL" || return 1 ;;
  esac
  scheme=${url%%://*}
  rest=${url#*://}
  hostport=${rest%%/*}
  hostport=${hostport##*@}
  host=$(printf %s "${hostport%%:*}" | tr 'A-Z' 'a-z')
  if [ "${ALLOW_LOCAL_ENDPOINTS:-0}" = 1 ]; then
    case "$host" in
      localhost | 127.0.0.1 | minio | minio-replica | minio-dr) return 0 ;;
    esac
  fi
  [ "$scheme" = https ] || guard_fail "'$url' must use https" || return 1
  suffixes=${INDIA_ENDPOINT_ALLOWLIST:-$INDIA_DEFAULT_SUFFIXES}
  old_ifs=$IFS
  IFS=,
  for suffix in $suffixes; do
    case "$host" in
      *"$suffix")
        IFS=$old_ifs
        return 0
        ;;
    esac
  done
  IFS=$old_ifs
  guard_fail "endpoint host '$host' is not an allowed India endpoint"
}

# An empty endpoint means AWS S3, so the region must be an India region; otherwise check the host.
assert_india_target() {
  if [ -z "${1:-}" ]; then
    assert_india_region "${2:-}"
  else
    assert_india_endpoint "$1"
  fi
}

# `put_status <key> <file>`: upload a status JSON to the ops bucket with a SigV4 PUT. Needs
# OPS_ENDPOINT, OPS_BUCKET, OPS_ACCESS_KEY, OPS_SECRET_KEY and OPS_REGION (default ap-south-1).
# Skips quietly when the ops bucket is not configured, so scripts stay usable by hand.
put_status() {
  [ -n "${OPS_ENDPOINT:-}" ] && [ -n "${OPS_BUCKET:-}" ] || return 0
  assert_india_endpoint "$OPS_ENDPOINT" || return 1
  curl -fsS --retry 2 --max-time 30 \
    --aws-sigv4 "aws:amz:${OPS_REGION:-ap-south-1}:s3" \
    --user "${OPS_ACCESS_KEY:?set OPS_ACCESS_KEY}:${OPS_SECRET_KEY:?set OPS_SECRET_KEY}" \
    -H 'Content-Type: application/json' -T "$2" \
    "${OPS_ENDPOINT%/}/${OPS_BUCKET}/$1" >/dev/null
}

# Reads `wal-g backup-list --detail --json` on stdin and prints the names of permanent (weekly)
# backups whose start time is older than the cutoff (epoch seconds, argument 1).
weekly_expired() {
  tr -d '\n' | sed 's/},[[:space:]]*{/}\n{/g' | while IFS= read -r obj; do
    case "$obj" in *'"is_permanent": true'* | *'"is_permanent":true'*) ;; *) continue ;; esac
    name=$(printf %s "$obj" | sed -n 's/.*"backup_name": *"\([^"]*\)".*/\1/p')
    when=$(printf %s "$obj" | sed -n 's/.*"start_time": *"\([^"]*\)".*/\1/p')
    [ -n "$name" ] && [ -n "$when" ] || continue
    epoch=$(date -u -d "$when" +%s 2>/dev/null) || continue
    [ "$epoch" -lt "$1" ] && echo "$name"
  done
  return 0
}

case "$0" in
  *india-guard.sh)
    [ $# -ge 1 ] || { echo "usage: india-guard.sh <endpoint> [region]" >&2; exit 2; }
    assert_india_target "$@"
    ;;
esac
