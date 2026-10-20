# Admin console (apps/admin)

The staff-only ops console (#27; shell, gate, headers and image in #309). Staff see platform
metadata only; workspace content is reachable only through a consented support session (#308,
[support-sessions](../../packages/core/src/support/index.ts)). Flags are managed on `/flags`
(#311, [below](#flags)). The other pages beyond the shell arrive with #310 (workspaces, audit), #312
(adapters) and #314 (support sessions).

| | |
|---|---|
| App | `apps/admin`, Next.js 16, Node runtime, `output: 'standalone'` |
| Port | 3200 (`pnpm --filter @causedeck/admin dev`) |
| Deployment | its own container and subdomain (spike §3.1), `infra/docker/admin.Dockerfile` |
| Sessions | its own Better Auth instance on `ADMIN_URL`: 8 h sessions, magic-link sign-in, sign-up closed |
| Language | English only (staff tool) |

## The staff gate

`apps/admin/proxy.ts` (Next.js 16's renamed `middleware.ts`) runs `decide` from `lib/gate.ts` on
every request except `/healthz`. It denies by default. The checks run in order, and the first one
that fails ends the request:

1. **Cloudflare Access**, when `CF_ACCESS_AUD` is set: the `Cf-Access-Jwt-Assertion` header must
   be an RS256 JWT signed by `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, issued by
   `https://<CF_ACCESS_TEAM_DOMAIN>`, for audience `CF_ACCESS_AUD`, and unexpired (`lib/cf-access.ts`).
2. **IP allowlist**, when `ADMIN_IP_ALLOWLIST` is set: the client IP (first `X-Forwarded-For` hop,
   else `X-Real-IP`, as set by Caddy) must match an address or CIDR in the list (`lib/ip-allowlist.ts`).
3. **Session**: validated against the database through Better Auth, not just a cookie check.
4. **Staff**: an enabled `staff_user` row (`isActiveStaff`).
5. **2FA**: the user has TOTP enrolled (`user.two_factor_enabled`), and this session passed the
   console's TOTP step.

Static assets (`/_next/*`) need checks 1-2 only. The sign-in page and the Better Auth endpoints it
calls (`/api/auth/sign-in/magic-link`, `/api/auth/magic-link/verify`, `/api/auth/sign-out`,
`/api/auth/get-session`, plus `/api/auth/dev/sign-in` outside production) are open to anyone who
passed 1-2 and is signed out. A signed-in non-staff user gets the 404 there too. Every other
`/api/auth/*` path is closed.

Any failure returns **the generic 404** (`lib/not-found-response.ts`): the same status, headers and
body for every reason, for real and unknown routes, pages and APIs alike. Probing reveals neither
which routes exist nor why a request was refused. The one exception is enrolled staff who have not
passed the TOTP step yet: page requests redirect to `/verify-2fa` (API calls still get the 404).

`(console)/layout.tsx` and every page call `requireStaff()` (`lib/staff.ts`) as a second line of
defence. It re-validates the session and the staff row, and answers `notFound()` for a role that
may not reach the page.

### 2FA step

Staff sign in by magic link, which Better Auth's `twoFactor` plugin does not intercept (it only
covers password sign-ins), so the console adds its own step. On `/verify-2fa` the staff member
enters a TOTP code, and Better Auth's `verifyTOTP` checks it for the current session. The
`staff.two_factor_verified` audit event is recorded, and the `cd_admin_2fa` cookie is set:

- an HMAC-SHA256 over the session id and the verification time, keyed with `BETTER_AUTH_SECRET`;
- `HttpOnly`, `SameSite=Strict`, `Secure` in production, at most 8 h;
- valid for that session only.

Attempts are limited to 5 per user per 15 minutes. Enrolment itself happens in the product's
account security page (#289). #304's step-up primitive may replace the cookie later.

## Staff roles

Staff accounts exist only through the operator CLI (#308):
`pnpm --filter @causedeck/admin staff:add <email> --role support|ops|admin`. The matrix lives in
`apps/admin/lib/roles.ts` and filters the nav and the pages:

| Role | Overview | Adapters | Flags | Workspaces | Support sessions | Audit |
|---|---|---|---|---|---|---|
| `support` | yes | | | metadata | yes | yes |
| `ops` | yes | yes | yes | | | yes |
| `admin` | yes | yes | yes | yes | yes | yes |

Sessions last 8 hours (`STAFF_SESSION_SECONDS`), then staff sign in and pass the TOTP step again.

## Response headers

Every response, the 404 included:

- `X-Robots-Tag: noindex, nofollow` (and `<meta name="robots" content="noindex, nofollow">`);
- `Cache-Control: no-store`;
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`
  (`next.config.ts` and `lib/csp.ts`);
- `Content-Security-Policy`. Pages get a per-request nonce policy with `frame-ancestors 'none'`,
  `object-src 'none'` and `base-uri 'none'`. The 404 gets a static policy with `default-src 'none'`.

`apps/admin/__tests__/headers.test.ts` covers all of these.

## Flags

`/flags` (`app/(console)/flags/`) is open to the `ops` and `admin` roles only (`requireStaff('flags')`
on the page and on every action). Everyone else gets the generic 404. It shows:

- **Global flags.** Every registered flag, with its global row, its effective value and a toggle.
- **Workspace overrides.** The same table for one workspace, picked by workspace id (a UUID). This
  lasts until the staff workspace lookup (#310) lands.
- **Pending approvals.** Legal-gated enables waiting for a second admin.

Every change opens a confirmation that restates the diff (`<key> · <Global|Workspace id> · Off →
On`) before it is applied. A flag whose `KILL_<KEY>` env kill switch is set shows `Forced off by
environment` with the variable name. Its toggle is disabled, since the kill switch wins over every
row.

Enabling a **legal-gated (⚖)** flag takes two people:

1. A staff member with `flags` writes the legal note, ticks `I confirm counsel has approved enabling
   this flag` and enters a fresh TOTP code. That creates a pending `flag_change_request` (one per
   key and workspace), and nothing turns on yet.
2. A different, enabled `admin` approves it with their own fresh TOTP code. The flag row is written
   with `legal_ack_by` = the requester and `updated_by` = the approver. An admin may reject the
   request instead, or its requester may withdraw it.

The TOTP re-verify (`reverifyTotp` in `lib/flags.ts`) asks Better Auth's `verifyTOTP` for the
current session, under the same 5-per-15-minutes limit as the TOTP step. It does not change the
`cd_admin_2fa` cookie. #304's step-up primitive may replace it later. The dev staff account skips
it outside production, as it skips the TOTP step.

All writes go through `@causedeck/flags`, which writes each audit event in the same transaction as
the change:

- `flag.changed` (actor, old and new value);
- `flag.change_requested`, `flag.change_approved` and `flag.change_rejected`.

`lib/flags.ts` installs `flagChangeAuditSink` from `@causedeck/core/audit` as the flag audit
writer. Reads record a fail-closed `staff.read` (`flags.list`, `flags.workspace_overrides`)
first. Rows, notes and actors stay on the server, apart from a pending request's note, which the
approver needs to see.

## Data layer

`withoutWorkspace` (unscoped access to `GLOBAL_TABLES`) may be imported in apps/admin only under
`apps/admin/lib/data`. Like every app (#299), apps/admin imports no other `@causedeck/db` value:
the staff-table queries (`staffMember`, `countActiveStaff`) and the operator CLI's owner-role
writes (`addStaff`, `disableStaff`, `seedDevStaff`, `withOwnerDb`) live in
`@causedeck/core/support`. The ESLint app→db blocks enforce both
(`packages/config/eslint/base.js`: `appDbImportBlocks` for `apps/admin` with the `withoutWorkspace`
ban, and for `apps/admin/lib/data` without it), and
`__tests__/no-without-workspace-outside-data.test.ts` scans for both.

Pages call `staffQuery(staff, { purpose, capability, tables }, fn)`, which:

1. checks the role may reach `capability`;
2. records `staff.read` (actor kind `staff`, no workspace, with purpose, capability, tables and
   role). This is fail-closed: a read that cannot be audited does not run;
3. runs `fn` in `withoutWorkspace` on the listed global tables only.

Callers pass a fixed query function from `@causedeck/core` (e.g. `countActiveStaff`), never SQL
text.

## Exposure (per deployment, never hard-coded)

The console must never be reachable from the open internet with only the app's own checks. Put
it behind at least one network control, configured through the environment of the admin
container:

- **Cloudflare Access (recommended):** create an Access application for the admin hostname, then
  set `CF_ACCESS_AUD` to its audience tag and `CF_ACCESS_TEAM_DOMAIN` to
  `<team>.cloudflareaccess.com`. Requests without a valid assertion get the 404, even if they
  reach the origin directly. Account and domain setup belong to #109 and Production Infra.
- **IP allowlist:** set `ADMIN_IP_ALLOWLIST` to the office or VPN egress addresses, e.g.
  `203.0.113.0/24,2001:db8::/32`. Caddy must set `X-Forwarded-For`, and the admin port must not
  be reachable except through Caddy.

Both are optional, so local development works without them; the image and the code contain no
addresses, teams or audiences. Env keys: see [env.md](env.md) (`ADMIN_URL`, `ADMIN_IP_ALLOWLIST`,
`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`, `ADMIN_ENV_LABEL`).

## Environment tag

The topbar strip (`--surface-sunken`, `STAFF CONSOLE` eyebrow, `STAFF` label) shows the
environment, so staff always know where they are. It reads `ADMIN_ENV_LABEL`
(`development|staging|production`), defaulting to `production` under `NODE_ENV=production` and
`development` otherwise. `staging` is amber, `production` red-tinted.

## Local development

```sh
pnpm stack:up
pnpm --filter @causedeck/admin staff:seed-dev   # staff@causedeck.local as admin; refuses in production
pnpm --filter @causedeck/admin dev              # http://localhost:3200/sign-in, use the dev sign-in
```

Outside production, and only for the seeded `staff@causedeck.local` account, the gate skips the
IP allowlist and the 2FA step. Every other account goes through every check in every environment,
which is what the e2e gate suite relies on.

## Image

`infra/docker/admin.Dockerfile` builds the standalone server. It runs as the non-root `node` user,
listens on 3200 and has a `HEALTHCHECK` on `/healthz`, which bypasses the gate and touches no
dependency. `ADMIN_URL` is a build argument, used for the Server Actions allowed origins.
