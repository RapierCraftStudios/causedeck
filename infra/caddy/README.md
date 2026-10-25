# Caddy edge (#98)

Caddy terminates TLS for every public hostname on the India VPS and is the only service that
publishes ports (80, 443, 443/udp for HTTP/3). The image is built from `Dockerfile` (pinned Caddy
and a pinned `mholt/caddy-ratelimit` commit) and wired in `infra/docker/compose.prod.yml`.

| Host            | Upstream     | Notes                                                               |
| --------------- | ------------ | ------------------------------------------------------------------- |
| `app.<tld>`     | `web:3000`   | DNS-only. CSP is the per-request nonce CSP from `apps/web/proxy.ts` |
| `api.<tld>`     | `api:3001`   | DNS-only. Strict CSP (`default-src 'none'`)                         |
| `admin.<tld>`   | `admin:3200` | DNS-only. 403 unless the client is in `ADMIN_ALLOWLIST`             |
| `static.<tld>`  | `web:3000`   | The only proxied, CDN-cached host: `/_next/static/*` only, no cookies |

Configuration: `Caddyfile` (sites, transport, timeouts) and `snippets/` (`security-headers`,
`rate-limits` with body limits, `logging`, `admin-gate`). Variables: `DOMAIN`, `ADMIN_ALLOWLIST`
(space-separated IPs or CIDRs; default admits nobody), `UPLOAD_MAX_BODY` (default 25MB).

## Residency rules

App and API are DNS-only (grey cloud) so TLS terminates on the VPS and matter data never transits
Cloudflare edges (D-037). Only the marketing site (Pages) and `static.<tld>` (no tenant data) are
proxied. Caddy and fail2ban are the protection layer until the founder accepts a Cloudflare WAF
trade-off. To proxy `app.<tld>`, record that decision, then set the Terraform variable
`app_proxied=true` (default `false`); Terraform and its guard that fails a proxied app hostname
without that variable belong to #99. If you do proxy, add Cloudflare's ranges to `trusted_proxies`
in the Caddyfile so rate limits see real client IPs. The admin host can alternatively sit behind
Cloudflare Access (proxy it and drop `admin_gate`); the allowlist is the default.

## Headers and caching

HSTS (one year, includeSubDomains), Referrer-Policy, Permissions-Policy (camera and microphone
`self` on the app host only), COOP, CORP and `nosniff` are set on every response. Caddy never sets a
CSP on the app and admin hosts: Next.js mints a nonce per request and Caddy cannot. App, API and
admin default to `Cache-Control: private, no-store`; static serves `public, max-age=31536000,
immutable`. CSP report collection is #104.

## Limits

Sign-in and magic link: 10 requests/minute/IP. Webhooks (`/v1/webhooks`, `/v1/inbound`,
`/api/captures/whatsapp`): 1200/minute. Uploads: 60/minute and `UPLOAD_MAX_BODY`. Everything else:
600/minute and 1 MB bodies. Over the limit the module returns 429 with `Retry-After`. Header, body,
write and idle timeouts are in the global `servers` block.

## Logs

Access logs are JSON on stdout (collected from the container by the log pipeline, #102). Bodies are
not logged, cookies are dropped, `Authorization` and token-like query parameters are redacted.

## fail2ban

Copy `fail2ban/filter.d/causedeck-caddy.conf` and `fail2ban/jail.d/causedeck-caddy.local` into
`/etc/fail2ban/`, then `systemctl reload fail2ban`. The jail bans clients with 30 responses of 401
or 429 in 10 minutes for an hour, through the `DOCKER-USER` chain. Manual drill (from a host that is
not allow-listed anywhere): send 40 bad sign-ins,
`for i in $(seq 40); do curl -s -o /dev/null -X POST https://app.<tld>/api/auth/sign-in/magic-link -d '{}'; done`,
then `fail2ban-client status causedeck-caddy` must list your IP and further requests time out;
`fail2ban-client set causedeck-caddy unbanip <ip>` lifts it.

## Rotating TLS

Certificates are issued and renewed automatically (ACME) once DNS points to the VPS; they live in
the `caddy_data` volume. To force a reissue: stop Caddy, remove the host's folder under
`certificates/` in that volume, start Caddy.

## Tests

`node --test infra/caddy/test/` lints the config locally. CI runs `caddy validate` and
`caddy adapt` (images.yml) and `test/smoke.sh` from the compose smoke (redirects, h3 `alt-svc`,
headers, admin 403, static cache, 429 with `Retry-After`).
