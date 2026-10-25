#!/usr/bin/env bash
# KEK rotation (#103, runbook infra/runbooks/key-rotation.md): re-wrap every workspace DEK under
# the new KEK. Objects and fields are untouched; reads work throughout. Resumable and idempotent.
#
#   rotate-kek.sh [--dry-run]
#
# Env: DATABASE_URL (app role), KEK_NEW_BASE64, KEK_OLD_BASE64 (32 bytes each, base64),
#      KEK_NEW_ID (default kek-2), KEK_OLD_ID (default kek-1). Keys are read from the environment
#      only (load them from the secret manager; never put them on a command line).
# Exit 0 only when no DEK remains under another KEK, so the old KEK can be retired.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for v in DATABASE_URL KEK_NEW_BASE64 KEK_OLD_BASE64; do
  [ -n "${!v:-}" ] || { echo "rotate-kek: $v is not set" >&2; exit 2; }
done
for arg in "$@"; do
  case "$arg" in
    --dry-run) ;;
    *) echo "usage: rotate-kek.sh [--dry-run]" >&2; exit 2 ;;
  esac
done
[ "${KEK_NEW_BASE64}" != "${KEK_OLD_BASE64}" ] || { echo "rotate-kek: the new and old KEK are identical" >&2; exit 2; }

# tsx is a devDependency of @causedeck/db; the entry imports the packages by relative path.
exec pnpm --filter @causedeck/db exec tsx "$here/rotate-kek.ts" "$@"
