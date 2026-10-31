#!/bin/sh
# Stage B document move (#106): MinIO to AWS S3 in an India region with rclone. POSIX sh, needs
# `rclone`. Objects are copied as stored (client-side encrypted ciphertext), so no key is needed.
#
#   migrate-minio-to-s3.sh                 dry run: rclone sync --dry-run --checksum (default)
#   migrate-minio-to-s3.sh --execute       rclone sync --checksum, then the verify step
#   migrate-minio-to-s3.sh --verify        rclone check --one-way (size and checksum), no writes
#
# Env: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET, S3_BUCKET, S3_REGION
# (default ap-south-1), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. Run it again after the final
# freeze for the delta; sync is idempotent. Rehearsal: point S3_BUCKET at a scratch bucket.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../backup/lib/india-guard.sh
. "$HERE/../backup/lib/india-guard.sh"

mode=dry-run
for arg in "$@"; do
  case "$arg" in
    --execute) mode=execute ;;
    --verify) mode=verify ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "migrate-minio-to-s3: unknown argument '$arg'" >&2
      exit 2
      ;;
  esac
done

die() {
  echo "migrate-minio-to-s3: $1" >&2
  exit 1
}

: "${MINIO_ENDPOINT:?set MINIO_ENDPOINT}"
: "${MINIO_BUCKET:?set MINIO_BUCKET}"
: "${S3_BUCKET:?set S3_BUCKET}"
S3_REGION=${S3_REGION:-ap-south-1}

# India guard: the destination region and the MinIO endpoint (local only with ALLOW_LOCAL_ENDPOINTS=1).
assert_india_region "$S3_REGION" || exit 1
assert_india_endpoint "$MINIO_ENDPOINT" || exit 1

export RCLONE_CONFIG_SRC_TYPE=s3
export RCLONE_CONFIG_SRC_PROVIDER=Minio
export RCLONE_CONFIG_SRC_ENDPOINT="$MINIO_ENDPOINT"
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="${MINIO_ACCESS_KEY:-}"
export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="${MINIO_SECRET_KEY:-}"
export RCLONE_CONFIG_DST_TYPE=s3
export RCLONE_CONFIG_DST_PROVIDER=AWS
export RCLONE_CONFIG_DST_REGION="$S3_REGION"
export RCLONE_CONFIG_DST_ENV_AUTH=true

src="src:$MINIO_BUCKET"
dst="dst:$S3_BUCKET"

verify() {
  rclone check "$src" "$dst" --one-way --checksum || die "checksum verification failed"
  echo "verify: every source object exists on the target with a matching checksum"
}

case "$mode" in
  dry-run)
    echo "dry run (no objects are written); add --execute to sync, --verify to compare"
    rclone sync "$src" "$dst" --checksum --dry-run
    ;;
  execute)
    rclone sync "$src" "$dst" --checksum
    verify
    ;;
  verify)
    verify
    ;;
esac
