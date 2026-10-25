#!/usr/bin/env bash
# Apply database migrations before `docker compose up -d` (#97). Starts only Postgres and MinIO,
# creates the buckets, sets the database role passwords from the env file (the init SQL ships dev
# passwords), then runs the owner-role migration in a one-off container. Any failure stops the
# deploy: nothing else is started.
#
#   CAUSEDECK_ENV_FILE=/etc/causedeck/prod.env infra/scripts/migrate.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/compose.prod.yml}"
: "${CAUSEDECK_ENV_FILE:?set CAUSEDECK_ENV_FILE to the env file (see infra/docker/env/prod.env.example)}"

set -a
# shellcheck disable=SC1090
. "$CAUSEDECK_ENV_FILE"
set +a
: "${OWNER_DB_PASSWORD:?OWNER_DB_PASSWORD is not set}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is not set}"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$CAUSEDECK_ENV_FILE" "$@"; }

echo "migrate: starting postgres and minio"
compose up -d --wait postgres minio

echo "migrate: creating buckets"
compose --profile init run --rm minio-init

echo "migrate: setting role passwords"
# Passwords travel on stdin as psql variables, never on a command line; quotes are doubled.
sq="'"
owner_pw="${OWNER_DB_PASSWORD//$sq/$sq$sq}"
app_pw="${APP_DB_PASSWORD//$sq/$sq$sq}"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U causedeck -d causedeck -q >/dev/null <<SQL
\set owner_pw '$owner_pw'
\set app_pw '$app_pw'
ALTER ROLE causedeck_owner PASSWORD :'owner_pw';
ALTER ROLE causedeck_app PASSWORD :'app_pw';
SQL

echo "migrate: applying migrations as causedeck_owner"
compose --profile migrate run --rm migrate
echo "migrate: done"
