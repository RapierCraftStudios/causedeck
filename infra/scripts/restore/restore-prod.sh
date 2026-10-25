#!/usr/bin/env bash
# Point-in-time restore of the production database from WAL-G (#101). Documented in
# infra/runbooks/restore.md. It NEVER touches the running stack or the live data volume: it
# restores into a new, empty Docker volume that you then promote on purpose (runbook step 6).
#
#   restore-prod.sh --i-understand --target-volume <new-volume> [--target-time <UTC ISO8601>|latest]
#
# Refuses unless: --i-understand is given, the target volume does not exist yet (or is empty) and
# is not the production data volume, the key file and READ-ONLY credentials are present, the storage
# target is in India, and the operator types the target name back. Env as restore-drill.sh plus
# RESTORE_IMAGE (the causedeck-postgres image) and PROD_DATA_VOLUME (default causedeck_pgdata).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../backup/lib/india-guard.sh
. "$HERE/../backup/lib/india-guard.sh"

die() { echo "restore-prod: refusing: $1" >&2; exit 1; }

CONFIRMED=0
TARGET_VOLUME=""
TARGET_TIME="latest"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --i-understand) CONFIRMED=1; shift ;;
    --target-volume) TARGET_VOLUME="${2:-}"; shift 2 ;;
    --target-time) TARGET_TIME="${2:-}"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done

[[ "$CONFIRMED" == 1 ]] || die "pass --i-understand: this replaces a database with a restore of an older state"
[[ -n "$TARGET_VOLUME" ]] || die "--target-volume <new volume> is required"
[[ "$TARGET_VOLUME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die "invalid volume name"
PROD_VOLUME="${PROD_DATA_VOLUME:-causedeck_pgdata}"
[[ "$TARGET_VOLUME" != "$PROD_VOLUME" && "$TARGET_VOLUME" != *pgdata ]] ||
  die "the target must be a fresh volume, never the production data volume ($PROD_VOLUME)"
[[ "$TARGET_TIME" == latest || "$TARGET_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[T\ ][0-9:]{8}(Z|\+00)?$ ]] ||
  die "--target-time must be 'latest' or a UTC timestamp"
[[ -r "${WALG_LIBSODIUM_KEY_PATH:-}" ]] || die "WALG_LIBSODIUM_KEY_PATH is not readable (restoring without the key fails)"
: "${WALG_S3_PREFIX:?set WALG_S3_PREFIX}" "${AWS_ACCESS_KEY_ID:?set the read-only restore credentials}"
assert_india_target "${AWS_ENDPOINT:-}" "${AWS_REGION:-}" || die "storage target is not in India"
IMAGE="${RESTORE_IMAGE:?set RESTORE_IMAGE}"

if docker volume inspect "$TARGET_VOLUME" >/dev/null 2>&1; then
  in_use="$(docker ps -aq --filter "volume=$TARGET_VOLUME")"
  [[ -z "$in_use" ]] || die "volume $TARGET_VOLUME is attached to a container"
  entries="$(docker run --rm -v "$TARGET_VOLUME:/t:ro" --entrypoint sh "$IMAGE" -c 'ls -A /t | wc -l')"
  [[ "$entries" == 0 ]] || die "volume $TARGET_VOLUME is not empty: use a fresh volume"
fi

echo "Restore plan: WAL-G backup LATEST + WAL up to '$TARGET_TIME' from $WALG_S3_PREFIX"
echo "into the NEW volume '$TARGET_VOLUME'. The running stack and '$PROD_VOLUME' are not modified."
read -r -p "Type the target volume name to continue: " typed
[[ "$typed" == "$TARGET_VOLUME" ]] || die "confirmation did not match"

docker volume create "$TARGET_VOLUME" >/dev/null
docker run --rm --user postgres \
  -e WALG_S3_PREFIX -e AWS_ENDPOINT -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  -e AWS_S3_FORCE_PATH_STYLE=true -e WALG_LIBSODIUM_KEY_PATH=/run/walg.key \
  -v "$WALG_LIBSODIUM_KEY_PATH:/run/walg.key:ro" -v "$TARGET_VOLUME:/var/lib/postgresql/data" \
  "$IMAGE" bash -euc '
    cd /var/lib/postgresql/data
    wal-g backup-fetch . LATEST
    { echo "restore_command = '"'"'wal-g wal-fetch %f %p'"'"'"
      if [ "$0" != latest ]; then echo "recovery_target_time = '"'"'$0'"'"'"; echo "recovery_target_action = '"'"'promote'"'"'"; fi
    } >> postgresql.auto.conf
    touch recovery.signal
    chmod 0700 .' "$TARGET_TIME"
echo "Restored into volume $TARGET_VOLUME. Next: runbook step 6 (verify, then switch the stack to it)."
