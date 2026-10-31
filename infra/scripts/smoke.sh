#!/usr/bin/env bash
# Post-deploy smoke test, run on the VPS by deploy-staging/deploy-prod.yml (#100):
#   CAUSEDECK_ENV_FILE=/etc/causedeck/prod.env infra/scripts/smoke.sh <gitsha>
# Requests go to Caddy on 127.0.0.1 with --resolve, so the TLS hostnames are exercised without
# depending on DNS. Checks: /readyz of web and api report the running sha, the sign-in page renders,
# the API answers /healthz, Caddy sends the security headers, and the app role sees no foreign rows.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/compose.prod.yml}"
SHA="${1:?usage: smoke.sh <gitsha>}"
: "${CAUSEDECK_ENV_FILE:?set CAUSEDECK_ENV_FILE}"
RELEASES_DIR="${RELEASES_DIR:-/opt/causedeck/releases}"
ENV_FILE="$RELEASES_DIR/$SHA/release.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$CAUSEDECK_ENV_FILE"
DOMAIN="${DOMAIN:-$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tail -n 1)}"
: "${DOMAIN:?DOMAIN is not set}"

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
compose() { GIT_SHA="$SHA" CAUSEDECK_ENV_FILE="$ENV_FILE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
req() { # req <host> <curl args...>; -k only because Caddy may hold an internal CA on staging
  local host="$1"; shift
  curl -sS --max-time 20 ${SMOKE_INSECURE:+-k} \
    --resolve "$host.$DOMAIN:443:127.0.0.1" "$@"
}

echo "smoke: web and api report the running sha"
for host in app api; do
  body="$(req "$host" "https://$host.$DOMAIN/readyz")" || fail "$host /readyz unreachable"
  echo "$body" | grep -q "\"version\": *\"$SHA\"" || fail "$host /readyz does not report $SHA: $body"
done

echo "smoke: sign-in page"
code="$(req app -o /dev/null -w '%{http_code}' "https://app.$DOMAIN/sign-in")" || fail "sign-in unreachable"
[ "$code" = 200 ] || fail "sign-in returned $code"

echo "smoke: API health"
code="$(req api -o /dev/null -w '%{http_code}' "https://api.$DOMAIN/healthz")" || fail "API /healthz unreachable"
[ "$code" = 200 ] || fail "API /healthz returned $code"

echo "smoke: Caddy routing and security headers"
headers="$(req app -D - -o /dev/null "https://app.$DOMAIN/sign-in")" || fail "header probe failed"
for header in strict-transport-security x-content-type-options; do
  echo "$headers" | grep -qi "^$header:" || fail "missing $header header"
done
echo "$headers" | grep -qi '^content-security-policy' || fail "missing content-security-policy header"

echo "smoke: RLS (app role sees nothing under a foreign workspace id)"
psql_su() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -U causedeck -d causedeck -tA "$@"; }
[ "$(psql_su -c "select rolsuper or rolbypassrls from pg_roles where rolname='causedeck_app'")" = f ] \
  || fail "app role can bypass RLS"
leaked="$(compose exec -T postgres psql -v ON_ERROR_STOP=1 -U causedeck -d causedeck -tA <<'SQL' | tail -n 1
begin;
set local role causedeck_app;
select set_config('app.workspace_id', '00000000-0000-4000-8000-000000000000', true);
select count(*) from "matter";
rollback;
SQL
)"
[ "$leaked" = 0 ] || fail "app role read $leaked matter rows from a foreign workspace"

echo "smoke: ok ($SHA)"
