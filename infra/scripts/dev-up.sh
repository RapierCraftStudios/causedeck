#!/usr/bin/env bash
# Start the local dev stack (infra/docker/compose.dev.yml) and return once every service is healthy.
# Idempotent: safe to run again on a running stack or after `pnpm stack:reset`.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
compose=(docker compose -f "$root/infra/docker/compose.dev.yml")
# CI only (GitHub sets CI=true): throwaway-database Postgres settings (compose.ci.yml).
if [ "${CI:-}" = true ]; then compose+=(-f "$root/infra/docker/compose.ci.yml"); fi

"${compose[@]}" up -d --wait postgres minio mailpit
# One-shot bucket setup runs separately: `up --wait` treats an exited container as a failure.
"${compose[@]}" run --rm minio-init >/dev/null

cat <<'URLS'
Dev stack is up (local-only credentials, see infra/docker/README.md):
  Postgres (app)    postgres://causedeck_app:causedeck_app@127.0.0.1:5432/causedeck
  Postgres (owner)  postgres://causedeck_owner:causedeck_owner@127.0.0.1:5432/causedeck
  MinIO API         http://127.0.0.1:9000  (bucket causedeck-dev, minioadmin/minioadmin)
  MinIO console     http://127.0.0.1:9001
  Mailpit SMTP      smtp://127.0.0.1:1025
  Mailpit UI        http://127.0.0.1:8025
URLS
