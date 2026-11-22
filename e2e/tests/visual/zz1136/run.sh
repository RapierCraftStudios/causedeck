#!/usr/bin/env bash
# Scratch (#1136): lane-scoped dev stack + e2e build + the visual check; tears everything down.
set -uo pipefail
root=$(pwd); P=forgedock-lane-1136
ovr=$(mktemp --suffix=.yml)
labels=""; for l in $(cat "$root/e2e/tests/visual/zz1136/labels.txt"); do labels+="      ${l%%=*}: '${l#*=}'"$'\n'; done
cat > "$ovr" <<YML
services:
  postgres:
    labels:
$labels  minio:
    labels:
$labels  minio-init:
    labels:
$labels  mailpit:
    ports: !override
      - '127.0.0.1:11025:1025'
      - '127.0.0.1:18025:8025'
    labels:
$labels
volumes:
  pgdata:
    labels:
$labels  miniodata:
    labels:
$labels
YML
compose=(docker compose -p "$P" -f "$root/infra/docker/compose.dev.yml" -f "$ovr")
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1; rm -f "$ovr"; }
trap cleanup EXIT
"${compose[@]}" up -d --wait postgres minio mailpit || { echo "STACK FAILED"; exit 1; }
"${compose[@]}" run --rm minio-init >/dev/null
PNPM="npx -y pnpm@10.34.7"
$PNPM install --frozen-lockfile >/tmp/1136-install.log 2>&1 || { tail -20 /tmp/1136-install.log; exit 1; }
export E2E_MAILPIT_URL=http://127.0.0.1:18025 E2E_SMTP_URL=smtp://127.0.0.1:11025 E2E_PORT=3150
export NODE_OPTIONS=--max-old-space-size=8192 SHOT_DIR=/tmp/1136-shots-${SHOT_LABEL:-after}; rm -rf "/tmp/1136-shots-${SHOT_LABEL:-after}" SHOT_LABEL="${SHOT_LABEL:-after}"
mkdir -p "$SHOT_DIR"
cd e2e && $PNPM exec playwright test tests/visual/zz1136 --project=chromium-1280-light --workers=1 --reporter=line > /tmp/1136-pw.log 2>&1
rc=$?
grep -E "SHOT|passed|failed|Error|✘|›" /tmp/1136-pw.log | tail -40
echo "PW EXIT $rc"
cd "$SHOT_DIR" && ls && tar czf - *.png | base64 -w0 > /tmp/1136-shots.b64; echo; echo "B64BEGIN"; cat /tmp/1136-shots.b64; echo; echo "B64END"
