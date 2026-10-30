#!/usr/bin/env bash
# Edge checks against a running production stack (#98). compose-smoke.sh calls this in CI with
# DOMAIN=localhost (Caddy issues internal certificates for it); never run it against production.
# Asserts: HTTP redirects to HTTPS, HTTP/3 is advertised, security headers on every host, no-store
# on app and API, the admin host answers 403, static serves immutable assets without cookies, and
# sign-in is rate limited (429 with Retry-After).
#
#   CADDY_SMOKE_DOMAIN=localhost bash infra/caddy/test/smoke.sh
set -euo pipefail

DOMAIN="${CADDY_SMOKE_DOMAIN:-localhost}"
fail() { echo "CADDY SMOKE FAIL: $*" >&2; exit 1; }
resolve=()
for host in app api admin static; do
  resolve+=(--resolve "$host.$DOMAIN:443:127.0.0.1" --resolve "$host.$DOMAIN:80:127.0.0.1")
done
req() { curl -sk --max-time 20 "${resolve[@]}" "$@"; }
header() { grep -i "^$1:" <<<"$2" | head -n 1 | tr -d '\r'; }

echo "caddy smoke: HTTP redirects to HTTPS"
for host in app api admin static; do
  head="$(req -o /dev/null -D - "http://$host.$DOMAIN/")"
  head -n 1 <<<"$head" | grep -Eq ' 30[78] ' || fail "$host: http is not redirected"
  header location "$head" | grep -qi '^location: https://' || fail "$host: redirect is not to https"
done

echo "caddy smoke: headers on every host, h3 advertised"
for host in app api admin static; do
  head="$(req -o /dev/null -D - "https://$host.$DOMAIN/nonexistent")"
  for name in strict-transport-security referrer-policy permissions-policy cross-origin-opener-policy \
    cross-origin-resource-policy x-content-type-options alt-svc; do
    header "$name" "$head" | grep -q . || fail "$host: missing $name"
  done
  header strict-transport-security "$head" | grep -qi 'includeSubDomains' || fail "$host: HSTS lacks includeSubDomains"
  header alt-svc "$head" | grep -q 'h3' || fail "$host: alt-svc does not advertise h3"
  ! header server "$head" | grep -q . || fail "$host: Server header is set"
done

echo "caddy smoke: app and API are never CDN-cacheable"
for host in app api; do
  head="$(req -o /dev/null -D - "https://$host.$DOMAIN/healthz")"
  header cache-control "$head" | grep -qi 'no-store' || fail "$host: Cache-Control is not no-store"
  ! header cache-control "$head" | grep -qiE 'public|s-maxage' || fail "$host: cacheable"
done

echo "caddy smoke: admin host is closed to non-allow-listed sources"
code="$(req -o /dev/null -w '%{http_code}' "https://admin.$DOMAIN/")"
[ "$code" = "403" ] || fail "admin answered $code, expected 403"

echo "caddy smoke: static serves immutable assets without cookies"
asset="$(req -L "https://app.$DOMAIN/" | grep -o '/_next/static/[^"]*\.js' | head -n 1 || true)"
if [ -n "$asset" ]; then
  head="$(req -o /dev/null -D - "https://static.$DOMAIN$asset")"
  header cache-control "$head" | grep -qi 'public, max-age=31536000, immutable' || fail "static: asset is not immutable"
  ! header set-cookie "$head" | grep -q . || fail "static: sets a cookie"
else
  echo "caddy smoke: no build asset found on the app page, skipped" >&2
fi
code="$(req -o /dev/null -w '%{http_code}' "https://static.$DOMAIN/api/auth/session")"
[ "$code" = "404" ] || fail "static serves non-asset paths ($code)"

echo "caddy smoke: sign-in is rate limited (10/min/IP)"
limited=""
for _ in $(seq 1 14); do
  head="$(req -o /dev/null -D - -X POST -H 'content-type: application/json' -d '{}' \
    "https://app.$DOMAIN/api/auth/sign-in/magic-link")"
  if head -n 1 <<<"$head" | grep -q ' 429'; then limited="$head"; break; fi
done
[ -n "$limited" ] || fail "no 429 after 14 sign-in requests"
header retry-after "$limited" | grep -q . || fail "429 lacks Retry-After"

echo "caddy smoke: ok"
