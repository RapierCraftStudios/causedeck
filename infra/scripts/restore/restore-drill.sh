#!/usr/bin/env bash
# Automated restore drill (#101): restore the latest WAL-G base backup plus WAL into an isolated,
# throwaway container on a fresh volume, verify it, write a JSON report, tear everything down.
#
#   restore-drill.sh [--target-time <ISO8601 UTC>|latest] [--report <file>] [--manifest <csv>]
#
# Env: WALG_S3_PREFIX, AWS_ENDPOINT/AWS_REGION, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (READ-ONLY
# restore credentials), WALG_LIBSODIUM_KEY_PATH (host path of the key file), DRILL_IMAGE (the
# causedeck-postgres image), optional DRILL_DOCKER_NETWORK (join the network that reaches the
# storage endpoint), DRILL_ROWCOUNT_TOLERANCE (default 0), DRILL_TIMEOUT_SECONDS (default 14400),
# OPS_* (publish reports), FORGE_DOCKER_LABELS (labels for every docker object).
# Report: {startedAt,target,rtoSeconds,rpoSeconds,checks[],ok}. ok is false when any check fails,
# RPO > 900 s (15 min) or RTO > 14400 s (4 h, PRD §8). A failed or breaching drill exits 1; the
# job system.backup.health turns the published report into the alert signal.
# Never run against production data directories: the target is always a new volume.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../backup/lib/india-guard.sh
. "$HERE/../backup/lib/india-guard.sh"

TARGET="latest"
REPORT="${TMPDIR:-/tmp}/restore-drill-report.json"
MANIFEST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-time) TARGET="${2:?--target-time needs a value}"; shift 2 ;;
    --report) REPORT="${2:?--report needs a file}"; shift 2 ;;
    --manifest) MANIFEST="${2:?--manifest needs a file}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

RPO_TARGET=900
RTO_TARGET=14400
TIMEOUT="${DRILL_TIMEOUT_SECONDS:-$RTO_TARGET}"
IMAGE="${DRILL_IMAGE:?set DRILL_IMAGE}"
TOL="${DRILL_ROWCOUNT_TOLERANCE:-0}"
ID="drill-$$"
START_EPOCH="$(date -u +%s)"
STARTED_AT="$(date -u -d "@$START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"
LABELS=()
for l in ${FORGE_DOCKER_LABELS:-}; do LABELS+=(--label "$l"); done
CHECKS="$WORK/checks.ndjson"
: >"$CHECKS"
OWN_NET=0
RPO=-1
RTO=-1

add_check() { # add_check <name> <ok:true|false> <detail>
  jq -cn --arg n "$1" --argjson ok "$2" --arg d "$3" '{name:$n,ok:$ok,detail:$d}' >>"$CHECKS"
}
cleanup() {
  docker rm -f "$ID" >/dev/null 2>&1 || true
  docker volume rm -f "$ID" >/dev/null 2>&1 || true
  [[ "$OWN_NET" == 1 ]] && docker network rm "$ID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

finish() {
  local ok=true
  jq -e -s 'all(.[]; .ok)' "$CHECKS" >/dev/null || ok=false
  jq -s --arg s "$STARTED_AT" --arg t "$TARGET" --argjson rto "$RTO" --argjson rpo "$RPO" \
    --argjson ok "$ok" '{startedAt:$s,target:$t,rtoSeconds:$rto,rpoSeconds:$rpo,checks:.,ok:$ok}' \
    "$CHECKS" >"$REPORT"
  put_status drills/latest.json "$REPORT" || echo "could not publish the report" >&2
  if [[ "$ok" == true ]]; then
    put_status drills/last-success.json "$REPORT" || true
    echo "restore drill ok: rto=${RTO}s rpo=${RPO}s"
    exit 0
  fi
  echo "restore drill FAILED, see $REPORT" >&2
  exit 1
}

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
if ! assert_india_target "${AWS_ENDPOINT:-}" "${AWS_REGION:-}"; then
  add_check storage_in_india false "storage target is not in India"
  finish
fi
[[ "$TARGET" == latest || "$TARGET" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[T\ ][0-9:]{8}(Z|\+00)?$ ]] ||
  { echo "--target-time must be 'latest' or a UTC timestamp" >&2; exit 2; }
[[ -r "${WALG_LIBSODIUM_KEY_PATH:-}" ]] || { add_check restore false "encryption key file is not readable"; finish; }

NET="${DRILL_DOCKER_NETWORK:-}"
if [[ -z "$NET" ]]; then
  docker network create "${LABELS[@]}" "$ID" >/dev/null
  NET="$ID"
  OWN_NET=1
fi
docker volume create "${LABELS[@]}" "$ID" >/dev/null

WALG_ENV=(-e WALG_S3_PREFIX -e AWS_ENDPOINT -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY
  -e AWS_S3_FORCE_PATH_STYLE=true -e WALG_LIBSODIUM_KEY_PATH=/run/walg.key -e WALG_LIBSODIUM_KEY_TRANSFORM=hex)
KEY_MOUNT=(-v "$WALG_LIBSODIUM_KEY_PATH:/run/walg.key:ro")

# 1. Base backup + recovery settings. The drill instance never archives.
if ! docker run --rm "${LABELS[@]}" --network "$NET" --user postgres "${WALG_ENV[@]}" "${KEY_MOUNT[@]}" \
  -v "$ID:/var/lib/postgresql/data" "$IMAGE" bash -euc '
    cd /var/lib/postgresql/data
    wal-g backup-fetch . LATEST
    { echo "restore_command = '"'"'wal-g wal-fetch %f %p'"'"'"
      echo "archive_mode = off"
      if [ "$0" = latest ]; then touch standby.signal
      else echo "recovery_target_time = '"'"'$0'"'"'"; echo "recovery_target_action = '"'"'pause'"'"'"; touch recovery.signal; fi
    } >> postgresql.auto.conf
    chmod 0700 .' "$TARGET"; then
  add_check restore false "wal-g backup-fetch failed (missing backup, wrong key or unreachable storage)"
  finish
fi

docker run -d --name "$ID" "${LABELS[@]}" --network "$NET" --user postgres --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --tmpfs /tmp --tmpfs /var/run/postgresql:mode=1777 \
  "${WALG_ENV[@]}" "${KEY_MOUNT[@]}" -v "$ID:/var/lib/postgresql/data" "$IMAGE" \
  postgres -c config_file=/etc/postgresql/postgresql.conf -c archive_mode=off >/dev/null

psqlq() { docker exec -i "$ID" psql -U causedeck -d causedeck -qAt "$@"; }

# 2. Wait for recovery: paused at the target time, or (latest) replay stable for 3 polls.
deadline=$((START_EPOCH + TIMEOUT))
last_lsn=""
stable=0
reached=false
while [[ "$(date -u +%s)" -lt "$deadline" ]]; do
  sleep 5
  docker exec "$ID" pg_isready -q -U causedeck -d causedeck || continue
  if [[ "$TARGET" == latest ]]; then
    lsn="$(psqlq -c 'select pg_last_wal_replay_lsn()' 2>/dev/null || true)"
    if [[ -n "$lsn" && "$lsn" == "$last_lsn" ]]; then stable=$((stable + 1)); else stable=0; fi
    last_lsn="$lsn"
    [[ "$stable" -ge 3 ]] && { reached=true; break; }
  else
    state="$(psqlq -c 'select pg_get_wal_replay_pause_state()' 2>/dev/null || true)"
    [[ "$state" == paused ]] && { reached=true; break; }
  fi
done
if [[ "$reached" != true ]]; then
  add_check restore false "recovery did not reach its target within ${TIMEOUT}s"
  finish
fi
replay_epoch="$(psqlq -c 'select coalesce(extract(epoch from pg_last_xact_replay_timestamp())::bigint, 0)')"
psqlq -c 'select pg_promote(true, 120)' >/dev/null
if [[ "$(psqlq -c 'select pg_is_in_recovery()')" != f ]]; then
  add_check restore false "instance did not leave recovery"
  finish
fi
add_check restore true "base backup and WAL restored to $TARGET"

# 3. Verification: manifest + verify.sql, evaluated by the restored instance itself.
{
  echo "create temp table drill_manifest(tbl text, rows bigint);"
  echo "copy drill_manifest from stdin with (format csv);"
  if [[ -n "$MANIFEST" ]]; then cat "$MANIFEST"; fi
  echo '\.'
  echo "\\set tolerance $TOL"
  cat "$HERE/verify.sql"
} | psqlq -F'|' -f - >"$WORK/verify.out" 2>"$WORK/verify.err" || true
while IFS='|' read -r tag name ok detail; do
  [[ "$tag" == CHECK ]] || continue
  add_check "$name" "$([[ "$ok" == t ]] && echo true || echo false)" "$detail"
done <"$WORK/verify.out"
if ! grep -q '^CHECK|crypto_erase|' "$WORK/verify.out"; then
  add_check verify_sql false "verify.sql did not complete: $(tail -n1 "$WORK/verify.err")"
fi

# 4. RPO and RTO.
END_EPOCH="$(date -u +%s)"
RTO=$((END_EPOCH - START_EPOCH))
if [[ "$replay_epoch" -gt 0 ]]; then
  ref="$START_EPOCH"
  [[ "$TARGET" == latest ]] || ref="$(date -u -d "${TARGET%Z}Z" +%s)"
  RPO=$((ref - replay_epoch))
  [[ "$RPO" -ge 0 ]] || RPO=0
  add_check rpo "$([[ "$RPO" -le "$RPO_TARGET" ]] && echo true || echo false)" "rpo ${RPO}s, target ${RPO_TARGET}s"
else
  add_check rpo false "no transaction was replayed: RPO cannot be measured"
fi
add_check rto "$([[ "$RTO" -le "$RTO_TARGET" ]] && echo true || echo false)" "rto ${RTO}s, target ${RTO_TARGET}s"
finish
