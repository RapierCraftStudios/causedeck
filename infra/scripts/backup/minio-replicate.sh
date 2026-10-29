#!/bin/sh
# Nightly MinIO replication to a second India location (#101). POSIX sh, needs `mc`; run it in the
# mc image: `docker compose --profile backup run --rm minio-replicate` (02:00 IST timer).
#
# For every bucket in infra/docker/minio/replication.json (plus the app bucket $S3_BUCKET when
# includeAppBucket is true): create it on the replica with versioning and object lock, mirror new
# and changed objects, and never propagate deletes (`mc mirror` without --remove), so a delete on
# the primary cannot remove a replica copy; the replica's GOVERNANCE lock covers overwrites too.
# A canary object is written to the ops bucket and must appear on the replica before the run is
# reported ok. Status is published to status/replication.json on the primary.
#
# Env: PRIMARY_ENDPOINT, PRIMARY_ACCESS_KEY, PRIMARY_SECRET_KEY, REPLICA_ENDPOINT,
# REPLICA_ACCESS_KEY, REPLICA_SECRET_KEY, optional REPLICATION_CONFIG, S3_BUCKET, REPLICATE_WATCH=1
# (after the nightly pass, keep mirroring the WAL bucket continuously), WAL_BUCKET.
#
# S3 mode (#884): set REPLICA_BUCKET to replicate into one pre-created AWS S3 bucket (#108), e.g.
# REPLICA_ENDPOINT=https://s3.ap-south-2.amazonaws.com REPLICA_REGION=ap-south-2. Each source
# bucket lands under replica/$REPLICA_BUCKET/<bucket>/. REPLICA_REGION must be ap-south-1 or
# ap-south-2. The script does not create the bucket or its object lock/lifecycle (30 days, see
# runbooks/dr-hyderabad.md). Every upload asks for server-side encryption: SSE-S3, or SSE-KMS when
# REPLICA_SSE_KMS_KEY is set. WAL-G objects are already libsodium-encrypted before they reach the
# primary; the replica only ever copies that ciphertext.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/india-guard.sh
. "$HERE/lib/india-guard.sh"
CONFIG="${REPLICATION_CONFIG:-$HERE/../../docker/minio/replication.json}"

write_status() { # write_status <ok> <message>
  printf '{"finishedAt":"%s","ok":%s,"message":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" |
    mc pipe "primary/${OPS_BUCKET:-causedeck-ops}/status/replication.json" >/dev/null 2>&1 || true
}
die() {
  echo "minio-replicate: $1" >&2
  write_status false "$1"
  exit 1
}

assert_india_endpoint "${PRIMARY_ENDPOINT:-}" || exit 1
assert_india_endpoint "${REPLICA_ENDPOINT:-}" || exit 1
RB="${REPLICA_BUCKET:-}"
if [ -n "$RB" ]; then
  assert_india_region "${REPLICA_REGION:-}" || exit 1
  # replica_dest <bucket>: where a source bucket lands on the replica
  replica_dest() { echo "replica/$RB/$1"; }
  # replica_enc <bucket>: the server-side encryption flag and its target for mc
  replica_enc() {
    if [ -n "${REPLICA_SSE_KMS_KEY:-}" ]; then
      echo "--enc-kms=replica/$RB/$1=$REPLICA_SSE_KMS_KEY"
    else
      echo "--enc-s3=replica/$RB/$1"
    fi
  }
else
  replica_dest() { echo "replica/$1"; }
  replica_enc() { :; }
fi
[ "${PRIMARY_ENDPOINT%/}" != "${REPLICA_ENDPOINT%/}" ] || die "primary and replica endpoints must differ"

flat=$(tr -d '\n ' <"$CONFIG")
buckets=$(printf %s "$flat" | sed -n 's/.*"buckets":\[\([^]]*\)\].*/\1/p' | tr -d '"' | tr , ' ')
days=$(printf %s "$flat" | sed -n 's/.*"retentionDays":\([0-9]*\).*/\1/p')
mode=$(printf %s "$flat" | sed -n 's/.*"mode":"\([A-Z]*\)".*/\1/p')
canary_prefix=$(printf %s "$flat" | sed -n 's/.*"canaryPrefix":"\([^"]*\)".*/\1/p')
[ -n "$buckets" ] && [ -n "$days" ] && [ -n "$mode" ] || die "unreadable $CONFIG"
case "$flat" in *'"includeAppBucket":true'*) [ -z "${S3_BUCKET:-}" ] || buckets="$buckets $S3_BUCKET" ;; esac

export MC_CONFIG_DIR="${MC_CONFIG_DIR:-/tmp/.mc}"
mc alias set primary "$PRIMARY_ENDPOINT" "${PRIMARY_ACCESS_KEY:?}" "${PRIMARY_SECRET_KEY:?}" >/dev/null
mc alias set replica "$REPLICA_ENDPOINT" "${REPLICA_ACCESS_KEY:?}" "${REPLICA_SECRET_KEY:?}" >/dev/null

for b in $buckets; do
  mc version enable "primary/$b" >/dev/null 2>&1 || true
  [ -z "$RB" ] || continue
  mc mb --ignore-existing --with-lock "replica/$b" >/dev/null || die "cannot create replica bucket $b"
  mc version enable "replica/$b" >/dev/null || die "cannot enable versioning on replica/$b"
  mc retention set --default "$mode" "${days}d" "replica/$b" >/dev/null || die "cannot set object lock on replica/$b"
  mc anonymous set none "replica/$b" >/dev/null 2>&1 || true
done

ops="${OPS_BUCKET:-causedeck-ops}"
canary="${canary_prefix}$(date -u +%Y%m%dT%H%M%SZ)"
printf 'canary %s\n' "$canary" | mc pipe "primary/$ops/$canary" >/dev/null || die "cannot write canary object"

for b in $buckets; do
  mc mirror --preserve --overwrite $(replica_enc "$b") "primary/$b" "$(replica_dest "$b")" >/dev/null ||
    die "mirror of $b failed"
done

mc stat "$(replica_dest "$ops")/$canary" >/dev/null 2>&1 || die "canary $canary did not reach the replica"
write_status true "replicated $(echo "$buckets" | wc -w | tr -d ' ') buckets, canary $canary"
echo "minio-replicate: ok canary $canary"

# Continuous mode: keep copying new WAL-G objects as they arrive (no deletes), so the off-host
# copy trails the primary by seconds instead of a day. Blocks until the container stops.
if [ "${REPLICATE_WATCH:-0}" = 1 ]; then
  wal="${WAL_BUCKET:-causedeck-wal}"
  exec mc mirror --watch --preserve $(replica_enc "$wal") "primary/$wal" "$(replica_dest "$wal")"
fi
