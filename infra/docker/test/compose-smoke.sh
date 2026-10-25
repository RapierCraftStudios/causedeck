#!/usr/bin/env bash
# Boots the production stack with mock providers and checks it (#97). CI runs this in images.yml
# after building the images locally as ghcr.io/$IMAGE_ORG/causedeck-<svc>:sha-$GIT_SHA; never run
# it on a shared dev host. Asserts: all services healthy within 120 s, only caddy reachable from
# outside, RLS rejects cross-workspace reads for the app role, a missing env variable fails fast,
# and the apps still run with a read-only root filesystem (compose sets read_only: true).
#
#   IMAGE_ORG=acme GIT_SHA=abc123 bash infra/docker/test/compose-smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/compose.prod.yml"
: "${IMAGE_ORG:?set IMAGE_ORG}"
: "${GIT_SHA:?set GIT_SHA}"
WORK="$(mktemp -d)"
ENV_FILE="$WORK/smoke.env"
PROJECT="causedeck-smoke-$$"
export COMPOSE_PROJECT_NAME="$PROJECT"  # migrate.sh and compose calls below share one project

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
cleanup() { compose --profile init --profile migrate down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "SMOKE FAIL: $*" >&2; compose ps >&2 || true; exit 1; }

rand() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
OWNER_PW="$(rand)"; APP_PW="$(rand)"; PG_PW="$(rand)"; S3_KEY="smoke$(rand)"; S3_SEC="$(rand)$(rand)"

# Mock providers everywhere; real secrets are generated per run and never leave the runner.
cp "$ROOT/infra/docker/env/prod.env.example" "$ENV_FILE"
{
  echo "COMPOSE_ENV_NAME=smoke"
  echo "DOMAIN=localhost"
  echo "ADMIN_ALLOWLIST="
  echo "IMAGE_ORG=$IMAGE_ORG"
  echo "GIT_SHA=$GIT_SHA"
  echo "NODE_ENV=production"
  echo "APP_URL=http://localhost"
  echo "NEXT_PUBLIC_APP_URL=http://localhost"
  echo "API_URL=http://localhost"
  echo "ADMIN_URL=http://localhost:3200"
  echo "POSTGRES_PASSWORD=$PG_PW"
  echo "OWNER_DB_PASSWORD=$OWNER_PW"
  echo "APP_DB_PASSWORD=$APP_PW"
  echo "S3_BUCKET=causedeck-smoke"
  echo "S3_ACCESS_KEY=$S3_KEY"
  echo "S3_SECRET_KEY=$S3_SEC"
  echo "BETTER_AUTH_SECRET=$(rand)$(rand)"
  echo "KEK_BASE64=$(head -c 32 /dev/urandom | base64)"
  echo "BILLING_SUPPLIER_LEGAL_NAME=Smoke Test LLP"
  echo "BILLING_SUPPLIER_GSTIN=29ABCDE1234F1Z5"
  echo "SARVAM_NO_TRAINING_CONFIRMED=true"
  echo "CLOCK_DRIFT_REFERENCE_URL="
} >>"$ENV_FILE"
# Later assignments win when the file is sourced, but compose's env parser keeps the LAST value too.
export CAUSEDECK_ENV_FILE="$ENV_FILE"

echo "smoke: migrate (owner role, one-off container)"
bash "$ROOT/infra/scripts/migrate.sh"

echo "smoke: up, healthy within 120 s"
compose up -d --wait --wait-timeout 120 \
  || fail "stack not healthy within 120 s"
for service in caddy web api worker admin postgres minio; do
  bad="$(compose ps --format '{{.Name}} {{.Health}}' "$service" | grep -v ' healthy$' || true)"
  [ -z "$bad" ] || fail "$service not healthy: $bad"
done
[ "$(compose ps --format '{{.Name}}' web | wc -l)" -eq 2 ] || fail "expected 2 web replicas"
[ "$(compose ps --format '{{.Name}}' worker | wc -l)" -eq 2 ] || fail "expected 2 worker replicas"

echo "smoke: port scan (only 80 and 443 reachable from outside the compose network)"
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-127.0.0.1}"
open_port() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }
for port in 5432 9000 9001 3000 3001 3003 3200; do
  for ip in 127.0.0.1 "$HOST_IP"; do
    ! open_port "$ip" "$port" || fail "port $port is reachable on $ip"
  done
done
open_port 127.0.0.1 80 || fail "caddy is not listening on 80"

echo "smoke: archive_mode and WAL-G"
psql_su() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -U causedeck -d causedeck -tA "$@"; }
[ "$(psql_su -c 'show archive_mode')" = "on" ] || fail "archive_mode is not on"
psql_su -c 'show archive_command' | grep -q 'wal-g wal-push' || fail "archive_command is not WAL-G"
compose exec -T postgres wal-g --version >/dev/null || fail "wal-g binary missing"
compose exec -T postgres psql -U causedeck -d causedeck -tA -c 'create extension if not exists vector' >/dev/null

echo "smoke: RLS (app role is not the owner and sees nothing across workspaces)"
[ "$(psql_su -c "select rolsuper or rolbypassrls from pg_roles where rolname='causedeck_app'")" = "f" ] \
  || fail "app role can bypass RLS"
[ "$(psql_su -c "select count(*) from pg_tables where schemaname='public' and tableowner='causedeck_app'")" = "0" ] \
  || fail "app role owns tables"
echo "smoke: seeding demo workspace as owner (non-production mode)"
compose --profile migrate run --rm -e NODE_ENV=development migrate \
  node --import tsx node_modules/@causedeck/db/scripts/seed-demo.ts >/dev/null || fail "demo seed failed"
# Count rows per forced-RLS table as the superuser (sees all), then as the app role under a random
# workspace id (must see none). Seeded demo data guarantees the superuser count is above zero.
tables="$(psql_su -c "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' join pg_attribute a on a.attrelid=c.oid and a.attname='workspace_id' and not a.attisdropped where c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity")"
[ -n "$tables" ] || fail "no forced-RLS workspace tables found"
total=0; leaked=0
for table in $tables; do
  all="$(psql_su -c "select count(*) from \"$table\"")"
  other="$(compose exec -T postgres psql -v ON_ERROR_STOP=1 -U causedeck -d causedeck -tA <<SQL
begin;
set local role causedeck_app;
select set_config('app.workspace_id', '00000000-0000-4000-8000-000000000000', true);
select count(*) from "$table";
rollback;
SQL
  )"
  other="$(echo "$other" | tail -n 1)"
  total=$((total + all)); leaked=$((leaked + other))
done
[ "$total" -gt 0 ] || fail "no seeded rows to prove isolation against"
[ "$leaked" -eq 0 ] || fail "app role read $leaked rows from a foreign workspace"

echo "smoke: missing required variable fails fast with a message"
if out="$(compose --profile migrate run --rm -e BETTER_AUTH_SECRET= migrate 2>&1)"; then
  fail "service booted without BETTER_AUTH_SECRET"
fi
echo "$out" | grep -qi "BETTER_AUTH_SECRET" || fail "missing-variable error does not name the variable"

echo "smoke: no writes outside tmpfs and volumes (root filesystems are read-only)"
for service in web api worker admin; do
  ro="$(compose exec -T "$service" sh -c 'touch /smoke-write 2>&1 || echo READONLY' | tail -n 1)"
  [ "$ro" = "READONLY" ] || fail "$service root filesystem is writable"
done

echo "smoke: edge (redirects, h3, headers, admin gate, rate limits)"
CADDY_SMOKE_DOMAIN=localhost bash "$ROOT/infra/caddy/test/smoke.sh" || fail "caddy edge checks failed"

echo "smoke: ok"
