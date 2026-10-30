#!/usr/bin/env bash
# WAL archive freshness check (#101), run every minute by a systemd timer through
# `docker compose --profile backup run --rm backup walg-wal-push-check.sh`.
# Writes a heartbeat WAL record first (an idle database writes no WAL, so archive_timeout would
# never switch a segment), then reads pg_stat_archiver. Publishes status/archive.json with
# {checkedAt,lastArchivedAt,ageSeconds,failedCount,ok}; the job reports it as the metric
# walg_last_archive_age_seconds. Prints ALERT and exits 1 when the age exceeds
# WAL_MAX_AGE_SECONDS (default 300, the 5 minute SLO) or archiving has never succeeded.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/india-guard.sh
. "$HERE/lib/india-guard.sh"

MAX_AGE="${WAL_MAX_AGE_SECONDS:-300}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

psql -qAt -c "select pg_logical_emit_message(true, 'causedeck.heartbeat', '')" >/dev/null
IFS='|' read -r age last failed < <(psql -qAt -F'|' -c \
  "select coalesce(extract(epoch from now() - last_archived_time)::bigint, -1),
          coalesce(to_char(last_archived_time at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), ''),
          failed_count
     from pg_stat_archiver")

ok=true
[[ "$age" -ge 0 && "$age" -le "$MAX_AGE" ]] || ok=false
printf '{"checkedAt":"%s","lastArchivedAt":"%s","ageSeconds":%s,"failedCount":%s,"ok":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$last" "$age" "$failed" "$ok" >"$WORK/archive.json"
put_status status/archive.json "$WORK/archive.json" || echo "could not publish status" >&2

if [[ "$ok" != true ]]; then
  echo "ALERT walg_last_archive_age_seconds=$age exceeds $MAX_AGE (failed_count=$failed)" >&2
  exit 1
fi
echo "ok walg_last_archive_age_seconds=$age"
