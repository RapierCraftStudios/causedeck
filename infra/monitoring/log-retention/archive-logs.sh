#!/usr/bin/env bash
# Lean 180-day log archive (#886): the `core` monitoring profile has no Loki, so the daily gzip of
# Docker's JSON logs (logrotate-docker.conf) is uploaded to an India object bucket instead, either
# MinIO on this host (http://minio:9000) or the Hyderabad off-host bucket (#884, ap-south-2).
#
#   archive-logs.sh --check-config   validate env only (region, endpoint, credentials), no network
#   archive-logs.sh --init           create the bucket with object lock and import the lifecycle
#   archive-logs.sh [--dry-run]      upload rotated logs, delete each local file after its upload
#
# Env (placeholders only, set in /etc/causedeck/prod.env or the systemd unit's EnvironmentFile):
#   LOG_ARCHIVE_REGION     ap-south-2 by default; only ap-south-1 and ap-south-2 are accepted
#   LOG_ARCHIVE_ENDPOINT   https://s3.ap-south-2.amazonaws.com, or http://minio:9000 with
#                          ALLOW_LOCAL_ENDPOINTS=1 (checked by backup/lib/india-guard.sh)
#   LOG_ARCHIVE_BUCKET     bucket name (default causedeck-logs-archive)
#   LOG_ARCHIVE_ACCESS_KEY, LOG_ARCHIVE_SECRET_KEY   write-only credentials for that bucket
#   LOG_ARCHIVE_HOST_ID    key prefix for this host (default: hostname)
#   DOCKER_LOG_DIR         default /var/lib/docker/containers
#   MC_BIN                 MinIO client binary (default mc)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../scripts/backup/lib/india-guard.sh
. "$here/../../scripts/backup/lib/india-guard.sh"

region="${LOG_ARCHIVE_REGION:-ap-south-2}"
endpoint="${LOG_ARCHIVE_ENDPOINT:-}"
bucket="${LOG_ARCHIVE_BUCKET:-causedeck-logs-archive}"
host_id="${LOG_ARCHIVE_HOST_ID:-$(uname -n)}"
log_dir="${DOCKER_LOG_DIR:-/var/lib/docker/containers}"
mc_bin="${MC_BIN:-mc}"
MIN_DAYS=180

fail() { echo "archive-logs: $*" >&2; exit 1; }

check_config() {
  # Region first: a non-India region is rejected even when the endpoint looks fine.
  assert_india_region "$region" || exit 1
  [ -n "$endpoint" ] || fail "LOG_ARCHIVE_ENDPOINT is required (https://s3.${region}.amazonaws.com or http://minio:9000)"
  assert_india_endpoint "$endpoint" || exit 1
  [ -n "${LOG_ARCHIVE_ACCESS_KEY:-}" ] || fail "LOG_ARCHIVE_ACCESS_KEY is required"
  [ -n "${LOG_ARCHIVE_SECRET_KEY:-}" ] || fail "LOG_ARCHIVE_SECRET_KEY is required"
  case "$bucket" in *[!a-z0-9.-]* | '') fail "invalid bucket name '$bucket'" ;; esac
  case "$host_id" in *[!A-Za-z0-9._-]* | '') fail "invalid LOG_ARCHIVE_HOST_ID '$host_id'" ;; esac
}

mc_env() {
  local scheme="${endpoint%%://*}" rest="${endpoint#*://}"
  export MC_HOST_archive="${scheme}://${LOG_ARCHIVE_ACCESS_KEY}:${LOG_ARCHIVE_SECRET_KEY}@${rest%/}"
}

init() {
  check_config
  mc_env
  "$mc_bin" mb --with-lock --ignore-existing --region "$region" "archive/$bucket"
  "$mc_bin" retention set --default COMPLIANCE "${MIN_DAYS}d" "archive/$bucket"
  "$mc_bin" ilm import "archive/$bucket" <"$here/archive-lifecycle.json"
  echo "archive-logs: bucket $bucket ready: ${MIN_DAYS}-day COMPLIANCE lock, expiry per archive-lifecycle.json"
}

upload() {
  local dry="$1" file name id day key count=0
  check_config
  [ "$dry" = 1 ] || mc_env
  # logrotate dateext names: <container-id>-json.log-YYYYMMDD.gz
  while IFS= read -r -d '' file; do
    name="$(basename "$file")"
    id="${name%%-json.log-*}"
    day="${name##*-json.log-}"; day="${day%.gz}"
    [[ "$day" =~ ^[0-9]{8}$ ]] || { echo "skip $file (no date in name)"; continue; }
    key="docker/${host_id}/${day:0:4}-${day:4:2}-${day:6:2}/${id:0:12}.json.log.gz"
    if [ "$dry" = 1 ]; then
      echo "would upload $file -> archive/$bucket/$key"
    else
      "$mc_bin" cp --quiet "$file" "archive/$bucket/$key" >/dev/null
      rm -f -- "$file"
      echo "uploaded $key"
    fi
    count=$((count + 1))
  done < <(find "$log_dir" -mindepth 2 -maxdepth 2 -type f -name '*-json.log-????????.gz' -print0 2>/dev/null)
  echo "archive-logs: $count file(s) $([ "$dry" = 1 ] && echo 'listed' || echo 'archived')"
}

case "${1:-}" in
  --check-config) check_config; echo "OK: $endpoint, region $region, bucket $bucket" ;;
  --init) init ;;
  --dry-run) upload 1 ;;
  '') upload 0 ;;
  *) fail "usage: archive-logs.sh [--check-config|--init|--dry-run]" ;;
esac
