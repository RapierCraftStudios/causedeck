#!/usr/bin/env bash
# Nightly WAL-G base backup (#101). Runs in the postgres image: `docker compose --profile backup run
# --rm backup walg-basebackup.sh` from a systemd timer at 01:00 IST (see infra/runbooks/restore.md).
#
#   1. guard: the storage target must be in India (lib/india-guard.sh)
#   2. wal-g backup-push, then verify with `wal-g backup-list` that a new backup exists
#   3. Sundays (or FORCE_WEEKLY=1): mark the backup permanent = the weekly backup
#   4. retention: keep BACKUP_RETAIN_DAILY (14) full backups with their WAL (14 days of PITR) and
#      BACKUP_RETAIN_WEEKLY (8) weekly ones; older permanent backups are unmarked, then deleted
#   5. publish status JSON and the row-count manifest to the ops bucket (read by the restore drill
#      and by the system.backup.health job)
# Exits non-zero on any failure, after publishing {"ok":false}. Encryption is WAL-G libsodium:
# WALG_LIBSODIUM_KEY_PATH must point at the key file (never in the image or the data volume).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/india-guard.sh
. "$HERE/lib/india-guard.sh"

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
RETAIN_DAILY="${BACKUP_RETAIN_DAILY:-14}"
RETAIN_WEEKLY="${BACKUP_RETAIN_WEEKLY:-8}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
status() { # status <ok> <name> <message>
  printf '{"finishedAt":"%s","ok":%s,"backupName":"%s","message":"%s"}\n' \
    "$(now_iso)" "$1" "$2" "$3" >"$WORK/basebackup.json"
  put_status status/basebackup.json "$WORK/basebackup.json" || echo "could not publish status" >&2
}
fail() {
  echo "walg-basebackup: $1" >&2
  status false "" "$1"
  exit 1
}

for n in "$RETAIN_DAILY" "$RETAIN_WEEKLY"; do
  [[ "$n" =~ ^[1-9][0-9]*$ ]] || fail "retention counts must be positive integers"
done
assert_india_target "${AWS_ENDPOINT:-}" "${AWS_REGION:-}" || fail "storage target is not in India"
[[ -n "${WALG_S3_PREFIX:-}" ]] || fail "WALG_S3_PREFIX is not set"
[[ -r "${WALG_LIBSODIUM_KEY_PATH:-}" && -s "${WALG_LIBSODIUM_KEY_PATH:-}" ]] ||
  fail "WALG_LIBSODIUM_KEY_PATH is not readable: backups must be encrypted"

names() { wal-g backup-list --json | tr -d '\n' | grep -o '"backup_name": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/'; }
before="$(names || true)"
wal-g backup-push "$PGDATA" || fail "wal-g backup-push failed"
after="$(names)" || fail "wal-g backup-list failed"
name="$(comm -13 <(sort <<<"$before") <(sort <<<"$after") | tail -n1)"
[[ -n "$name" ]] || fail "new backup is missing from wal-g backup-list"

if [[ "$(date -u +%u)" == 7 || "${FORCE_WEEKLY:-0}" == 1 ]]; then
  wal-g backup-mark "$name" || fail "could not mark $name as the weekly backup"
fi

cutoff=$(($(date -u +%s) - RETAIN_WEEKLY * 7 * 86400))
for old in $(wal-g backup-list --detail --json | weekly_expired "$cutoff"); do
  wal-g backup-mark -i "$old" || fail "could not unmark expired weekly backup $old"
done
wal-g delete retain FULL "$RETAIN_DAILY" --confirm || fail "wal-g delete retain failed"

# Row-count manifest for the restore drill: exact counts of every public table at backup time.
if [[ -n "${PGHOST:-}" ]]; then
  psql -Atq -F, -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
                    from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" \
    >"$WORK/manifest.csv" || fail "could not build the row-count manifest"
  put_status manifest/latest.csv "$WORK/manifest.csv" || fail "could not publish the manifest"
fi

status true "$name" "backup verified with wal-g backup-list"
echo "walg-basebackup: ok $name"
