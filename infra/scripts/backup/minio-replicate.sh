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
# Stage A target (#884): AWS S3 ap-south-2 (Hyderabad), the second India location for the OVH
# Mumbai host. Set REPLICA_ENDPOINT=https://s3.ap-south-2.amazonaws.com, REPLICA_REGION=ap-south-2
# and REPLICA_BUCKET (one pre-created bucket with versioning and Object Lock, made by the human
# step #108); each source bucket then lands under the prefix <REPLICA_BUCKET>/<bucket>/. Without
# REPLICA_BUCKET each source bucket is mirrored to a same-named replica bucket (MinIO replica, CI).
# Only ap-south-1 and ap-south-2 are accepted, and the endpoint region must match REPLICA_REGION.
# Objects are encrypted at rest on the replica (REPLICA_SSE=sse-s3 default, or sse-kms with
# REPLICA_KMS_KEY_ID). WAL and base backups are already libsodium-encrypted by WAL-G before they
# reach the primary, so the replica only ever holds ciphertext for them.
#
# Env: PRIMARY_ENDPOINT, PRIMARY_ACCESS_KEY, PRIMARY_SECRET_KEY, REPLICA_ENDPOINT, REPLICA_REGION,
# REPLICA_BUCKET, REPLICA_ACCESS_KEY, REPLICA_SECRET_KEY, REPLICA_SSE, REPLICA_KMS_KEY_ID, optional
# REPLICATION_CONFIG, S3_BUCKET, REPLICATE_WATCH=1 (after the nightly pass, keep mirroring the WAL
# bucket continuously), WAL_BUCKET.
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

REPLICA_REGION="${REPLICA_REGION:-ap-south-2}"
REPLICA_SSE="${REPLICA_SSE:-sse-s3}"
assert_india_endpoint "${PRIMARY_ENDPOINT:-}" || exit 1
assert_india_endpoint "${REPLICA_ENDPOINT:-}" || exit 1
assert_india_region "$REPLICA_REGION" || exit 1
case "$REPLICA_ENDPOINT" in
  *.amazonaws.com*)
    case "$REPLICA_ENDPOINT" in
      *".$REPLICA_REGION.amazonaws.com"*) ;;
      *) echo "minio-replicate: endpoint $REPLICA_ENDPOINT is not in REPLICA_REGION $REPLICA_REGION" >&2; exit 1 ;;
    esac
    ;;
esac
case "$REPLICA_SSE" in
  sse-s3) ;;
  sse-kms) [ -n "${REPLICA_KMS_KEY_ID:-}" ] || { echo "minio-replicate: sse-kms needs REPLICA_KMS_KEY_ID" >&2; exit 1; } ;;
  *) echo "minio-replicate: REPLICA_SSE must be sse-s3 or sse-kms" >&2; exit 1 ;;
esac
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
mc alias set replica "$REPLICA_ENDPOINT" "${REPLICA_ACCESS_KEY:?}" "${REPLICA_SECRET_KEY:?}" --api S3v4 >/dev/null

# replica_path <bucket>: where a source bucket lands on the replica.
replica_path() {
  if [ -n "${REPLICA_BUCKET:-}" ]; then echo "replica/$REPLICA_BUCKET/$1"; else echo "replica/$1"; fi
}

set_encryption() { # set_encryption <replica bucket target>
  if [ "$REPLICA_SSE" = sse-kms ]; then
    mc encrypt set sse-kms "$REPLICA_KMS_KEY_ID" "$1" >/dev/null || die "cannot enable SSE-KMS on $1"
  else
    mc encrypt set sse-s3 "$1" >/dev/null || die "cannot enable SSE-S3 on $1"
  fi
}

if [ -n "${REPLICA_BUCKET:-}" ]; then
  # One pre-created, locked S3 bucket (#108). The scoped IAM user cannot create buckets, so a
  # missing bucket is an operator error, not something to paper over.
  mc stat "replica/$REPLICA_BUCKET" >/dev/null 2>&1 || die "replica bucket $REPLICA_BUCKET does not exist or is not reachable"
  set_encryption "replica/$REPLICA_BUCKET"
  for b in $buckets; do mc version enable "primary/$b" >/dev/null 2>&1 || true; done
else
  for b in $buckets; do
    mc version enable "primary/$b" >/dev/null 2>&1 || true
    mc mb --ignore-existing --with-lock "replica/$b" >/dev/null || die "cannot create replica bucket $b"
    mc version enable "replica/$b" >/dev/null || die "cannot enable versioning on replica/$b"
    mc retention set --default "$mode" "${days}d" "replica/$b" >/dev/null || die "cannot set object lock on replica/$b"
    set_encryption "replica/$b"
    mc anonymous set none "replica/$b" >/dev/null 2>&1 || true
  done
fi

ops="${OPS_BUCKET:-causedeck-ops}"
canary="${canary_prefix}$(date -u +%Y%m%dT%H%M%SZ)"
printf 'canary %s\n' "$canary" | mc pipe "primary/$ops/$canary" >/dev/null || die "cannot write canary object"

for b in $buckets; do
  mc mirror --preserve --overwrite "primary/$b" "$(replica_path "$b")" >/dev/null || die "mirror of $b failed"
done

mc stat "$(replica_path "$ops")/$canary" >/dev/null 2>&1 || die "canary $canary did not reach the replica"
write_status true "replicated $(echo "$buckets" | wc -w | tr -d ' ') buckets, canary $canary"
echo "minio-replicate: ok canary $canary"

# Continuous mode: keep copying new WAL-G objects as they arrive (no deletes), so the off-host
# copy trails the primary by seconds instead of a day. Blocks until the container stops.
if [ "${REPLICATE_WATCH:-0}" = 1 ]; then
  wal="${WAL_BUCKET:-causedeck-wal}"
  exec mc mirror --watch --preserve "primary/$wal" "$(replica_path "$wal")"
fi
