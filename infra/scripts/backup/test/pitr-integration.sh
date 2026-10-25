#!/usr/bin/env bash
# Backup -> PITR -> restore integration run (#101), CI only (restore-drill.yml and images.yml): it
# boots Docker containers, so never run it on the shared dev host. Uses a throwaway Postgres and
# MinIO, a generated libsodium key and the real scripts:
#   1. base backup (walg-basebackup.sh) + a marker row + WAL push
#   2. restore with a WRONG key must fail (R3)
#   3. restore-drill.sh to the marker timestamp must pass with RPO/RTO in the report (R6)
#   4. replication to a second MinIO delivers the canary (R5)
#
#   IMAGE_ORG=acme GIT_SHA=abc123 bash infra/scripts/backup/test/pitr-integration.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
: "${IMAGE_ORG:?set IMAGE_ORG}"
: "${GIT_SHA:?set GIT_SHA}"
IMAGE="ghcr.io/$IMAGE_ORG/causedeck-postgres:sha-$GIT_SHA"
WORK="$(mktemp -d)"
ID="pitr-$$"
LABELS=()
for l in ${FORGE_DOCKER_LABELS:-}; do LABELS+=(--label "$l"); done
cleanup() {
  docker rm -f "$ID-pg" "$ID-minio" "$ID-minio2" >/dev/null 2>&1 || true
  docker volume rm -f "$ID-pgdata" "$ID-m1" "$ID-m2" >/dev/null 2>&1 || true
  docker network rm "$ID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "PITR FAIL: $*" >&2; exit 1; }

head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$WORK/key"
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$WORK/wrong-key"
chmod 0444 "$WORK/key" "$WORK/wrong-key"
docker network create "${LABELS[@]}" "$ID" >/dev/null
for n in minio minio2; do
  docker run -d --name "$ID-$n" "${LABELS[@]}" --network "$ID" --network-alias "${n/minio2/minio-replica}" \
    -e MINIO_ROOT_USER=itest -e MINIO_ROOT_PASSWORD=itest-secret-1 \
    -v "$ID-${n/minio/m}:/data" quay.io/minio/minio server /data >/dev/null
done
sleep 5

export WALG_S3_PREFIX=s3://causedeck-wal AWS_ENDPOINT=http://minio:9000 AWS_REGION=ap-south-1
export AWS_ACCESS_KEY_ID=itest AWS_SECRET_ACCESS_KEY=itest-secret-1 ALLOW_LOCAL_ENDPOINTS=1
MC=(docker run --rm "${LABELS[@]}" --network "$ID" --entrypoint sh pgsty/mc:RELEASE.2026-10-18T00-00-00Z -c)
"${MC[@]}" 'mc alias set l http://minio:9000 itest itest-secret-1 && mc mb --ignore-existing l/causedeck-wal l/causedeck-ops' >/dev/null

WALG_ENV=(-e WALG_S3_PREFIX -e AWS_ENDPOINT -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY
  -e AWS_S3_FORCE_PATH_STYLE=true -e WALG_LIBSODIUM_KEY_PATH=/run/walg.key -e WALG_LIBSODIUM_KEY_TRANSFORM=hex)
docker run -d --name "$ID-pg" "${LABELS[@]}" --network "$ID" "${WALG_ENV[@]}" \
  -e POSTGRES_USER=causedeck -e POSTGRES_PASSWORD=itest -e POSTGRES_DB=causedeck \
  -v "$WORK/key:/run/walg.key:ro" -v "$ID-pgdata:/var/lib/postgresql/data" "$IMAGE" \
  postgres -c config_file=/etc/postgresql/postgresql.conf >/dev/null
for _ in $(seq 60); do docker exec "$ID-pg" pg_isready -q -U causedeck && break; sleep 2; done
psql_pg() { docker exec -i "$ID-pg" psql -U causedeck -d causedeck -qAt "$@"; }
psql_pg -c "create table pitr_marker(id int primary key, note text); insert into pitr_marker values (1, 'before-backup')" >/dev/null

# 1. Base backup with the real script (publishes its status to the ops bucket).
docker exec -u postgres "${WALG_ENV[@]}" -e PGHOST= -e BACKUP_RETAIN_DAILY=14 -e BACKUP_RETAIN_WEEKLY=8 \
  "$ID-pg" bash -c "FORCE_WEEKLY=1 bash /dev/stdin" <"$ROOT/infra/scripts/backup/walg-basebackup.sh" ||
  fail "walg-basebackup.sh failed"
psql_pg -c "insert into pitr_marker values (2, 'after-backup')" >/dev/null
psql_pg -c "select pg_switch_wal()" >/dev/null
sleep 5
target="$(psql_pg -c "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")"
psql_pg -c "insert into pitr_marker values (3, 'after-target'); select pg_switch_wal()" >/dev/null
sleep 5

# 2. Restoring without the key must fail (R3).
if DRILL_IMAGE="$IMAGE" DRILL_DOCKER_NETWORK="$ID" WALG_LIBSODIUM_KEY_PATH="$WORK/wrong-key" \
  bash "$ROOT/infra/scripts/restore/restore-drill.sh" --target-time "$target" --report "$WORK/wrong.json"; then
  fail "a drill with the wrong key passed"
fi

# 3. Drill to the marker timestamp: report must be ok, rows 1 and 2 present, row 3 absent.
DRILL_IMAGE="$IMAGE" DRILL_DOCKER_NETWORK="$ID" WALG_LIBSODIUM_KEY_PATH="$WORK/key" \
  bash "$ROOT/infra/scripts/restore/restore-drill.sh" --target-time "$target" --report "$WORK/report.json" ||
  fail "drill failed: $(cat "$WORK/report.json" 2>/dev/null)"
jq -e '.ok == true and (.rtoSeconds >= 0) and (.rpoSeconds >= 0) and ([.checks[].name] | index("rls_enabled"))' \
  "$WORK/report.json" >/dev/null || fail "drill report is incomplete"

# 4. Replication to the second location delivers the canary within the run.
PRIMARY_ENDPOINT=http://minio:9000 PRIMARY_ACCESS_KEY=itest PRIMARY_SECRET_KEY=itest-secret-1 \
  REPLICA_ENDPOINT=http://minio-replica:9000 REPLICA_ACCESS_KEY=itest REPLICA_SECRET_KEY=itest-secret-1 \
  docker run --rm "${LABELS[@]}" --network "$ID" \
  -e PRIMARY_ENDPOINT -e PRIMARY_ACCESS_KEY -e PRIMARY_SECRET_KEY -e REPLICA_ENDPOINT \
  -e REPLICA_ACCESS_KEY -e REPLICA_SECRET_KEY -e ALLOW_LOCAL_ENDPOINTS -e MC_CONFIG_DIR=/tmp/.mc \
  -e REPLICATION_CONFIG=/opt/minio/replication.json \
  -v "$ROOT/infra/scripts/backup:/opt/backup:ro" -v "$ROOT/infra/docker/minio/replication.json:/opt/minio/replication.json:ro" \
  --entrypoint sh pgsty/mc:RELEASE.2026-10-18T00-00-00Z /opt/backup/minio-replicate.sh ||
  fail "minio-replicate.sh failed"
echo "PITR ok"
