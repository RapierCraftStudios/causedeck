# Auth

`packages/auth` configures Better Auth 1.7.10 (ADR 0004, spike §1, §4.2, §6) over the Drizzle
adapter and the tables from #151 (`packages/db/src/schema/auth.ts`). Sign-in methods are email
magic link, passkeys (WebAuthn) and Google OAuth (off by default). Organizations are workspaces,
using the five roles in `roles.ts`. Dev and CI never need credentials: they use the console mailer
and the dev sign-in provider.

apps/web wires it in (#153); see [apps/web](#appsweb) below. Browser flows (Playwright, virtual
authenticator) belong to #16.
2FA enforcement and the settings UI belong to #25, and the SES email transport to #23.

## Entry points

| Import | What |
|---|---|
| `@causedeck/auth` | `ROLES`, `isRole`, `atLeast`, `ac`, `roles`, `UnauthenticatedError`, `SessionUser`. Safe in client components |
| `@causedeck/auth/server` | `createAuth({ db, env, mailer, logger? })`, `Auth`, `AuthEnv`, limit and lifetime constants. Server-only |
| `@causedeck/auth/session` | `createSessionHelpers({ auth, headers })` returns `getSession`, `requireSession` and `requireUser`; also exports `UnauthenticatedError` and `SessionUser` |
| `@causedeck/auth/client` | `createCauseDeckAuthClient({ baseURL? })` with the organization, passkey, magicLink and twoFactor client plugins |
| `@causedeck/auth/mailer` | `Mailer`, `AuthEmail`, `consoleMailer`, `smtpMailer`, `createMailer(env, logger?)` |
| `@causedeck/auth/dev-provider` | `devSignIn()` plugin and `DEV_SIGN_IN_PATH` |

Wiring in a server (apps/web does this lazily in `apps/web/lib/auth.ts`):

```ts
import { serverEnv } from '@causedeck/config/env';
import { db } from '@causedeck/db';
import { createMailer } from '@causedeck/auth/mailer';
import { createAuth } from '@causedeck/auth/server';
import { createSessionHelpers } from '@causedeck/auth/session';
import { headers } from 'next/headers';

const env = serverEnv();
export const auth = createAuth({ db, env, mailer: createMailer(env) });
export const { getSession, requireSession, requireUser } = createSessionHelpers({ auth, headers });
```

`requireSession()` throws `UnauthenticatedError` (`code: 'UNAUTHENTICATED'`) when there is no
valid session. `SessionUser` is `{ id, email, name: string | null, image: string | null, locale:
'en' | 'ta' | 'kn' }`.

## apps/web

- **`lib/auth.ts`** (server-only) builds `auth` on first use with `createAuth({ db, env:
  serverEnv(), mailer: createMailer(env, logger), logger })`. Building it at import would make
  `next build` need runtime secrets. It also exports `getSession`, `requireSession` and
  `requireUser` over `next/headers`.
- **`app/api/auth/[...all]/route.ts`** serves every Better Auth endpoint via `toNextJsHandler`.
- **`proxy.ts`** redirects `/w/**` and `/account` to `/sign-in?next=<path+query>` when no session
  cookie is present (`getSessionCookie`, which also reads the `__Secure-` name). It never validates
  the session, and it keeps the CSP nonce and `NEXT_LOCALE` cookie on the redirect. It forwards
  `x-pathname` for server components.
- **`app/(app)/layout.tsx`** is the real check: no valid session means `redirect('/sign-in?next=')`.
  The onboarding and last-workspace redirects arrive with workspaces (#18).
- **`lib/safe-next.ts`** `safeNextPath(raw, fallback)` keeps only same-origin relative paths. It
  rejects `//host`, `/\host`, backslashes, whitespace and control characters, and schemes.
  `signInPathFor(path)` builds `/sign-in?next=`.
- **`lib/safe-action.ts`** resolves `ctx.session` (`AuthSession | null`) through `getSession`, or
  through `safeAction(schema, handler, { getSession })` in tests. It maps `UnauthenticatedError`
  (thrown by the handler or by `requireSession()`) to `{ code: 'UNAUTHENTICATED' }` without
  logging it.
- **`/sign-in`** (`app/(public)/sign-in/`). The RSC page reads `next`, `error` and
  `AUTH_GOOGLE_ENABLED`, and sends a signed-in visitor straight to `next`. The client components:
  - Google (only when enabled);
  - passkey (disabled with a reason without WebAuthn, plus conditional UI through
    `autocomplete="username webauthn"` on the email field);
  - the magic-link form;
  - check-email (address, 10-minute expiry, resend after 30 s).

  `?error=EXPIRED_TOKEN|INVALID_TOKEN|ATTEMPTS_EXCEEDED` shows the expired-link copy,
  `?error=access_denied` shows "Access was not granted.", and any other code shows a generic error.
  Offline is detected live from `navigator.onLine`. The Better Auth browser client
  (`lib/auth-client.ts`) is loaded with `import()` on first use, so it stays out of first-load JS.
  All copy is under `auth.*` in `messages/{en,ta,kn}.json`, together with the magic-link email
  keys `auth.email.magicLink.*`.
- **`app/(public)/invite/[token]`** is a placeholder until invitations land (#18).

## Flows

- **Magic link.** `POST /api/auth/sign-in/magic-link { email, callbackURL?, metadata?: { locale } }`
  always answers `{ status: true }`. The mailer receives a link to `/api/auth/magic-link/verify`.
  Opening the link creates the user on first use (email verified), starts a session and redirects
  to `callbackURL`. Links expire in 10 minutes, work once, and the token is stored as a SHA-256
  hash (`storeToken: 'hashed'`), never in plaintext.
- **Passkeys.** The `@better-auth/passkey` plugin. A signed-in user registers a passkey, then signs
  in with it, including through browser conditional UI.
- **Google.** Shown only when `AUTH_GOOGLE_ENABLED=true` (see below).
- **Email and password** are disabled.
- **2FA.** The `twoFactor` plugin (TOTP, issuer `CauseDeck`) is installed. Enforcement for owners
  arrives with #25.
- **Dev sign-in.** `POST /api/auth/dev/sign-in { email, name? }` finds or creates the user and sets
  a session cookie, for local use and the #16 e2e harness. It is registered only behind a literal
  `process.env.NODE_ENV !== 'production'` check, so production bundles drop it entirely (a test
  bundles `server.ts` with esbuild to prove it). It also answers 404 if it is ever reached under
  `NODE_ENV=production`.

## Sessions and cookies

| Setting | Value |
|---|---|
| Cookie | `better-auth.session_token`, or `__Secure-better-auth.session_token` in production |
| Attributes | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when `NODE_ENV=production` |
| Lifetime | 30 days (`Max-Age=2592000`), sliding: a session used more than 1 day after its last refresh is extended to a full 30 days again |
| Admin console | `createAuth({ sessionExpiresInSeconds })` shortens the lifetime; the refresh age becomes a quarter of it (at most 1 day). apps/admin passes 8 hours and `disableSignUp: true`, so its magic links never create users (#309, [admin-console.md](admin-console.md)) |
| Sign-out | `POST /api/auth/sign-out` deletes the session row and expires the cookie (`Max-Age=0`) |
| CSRF | Better Auth origin checks against `trustedOrigins` (the origin of `APP_URL`), plus `SameSite=Lax` |
| IDs | `advanced.database.generateId: 'uuid'`, matching the uuid primary keys |

## Organizations and roles

`organization({ ac, roles, creatorRole: 'owner' })` uses `roles.ts` as the single role list:
owner, advocate, junior, clerk and viewer. Better Auth would otherwise also accept its built-in
`admin` and `member` roles. To prevent that, the plugin's `beforeAddMember`,
`beforeUpdateMemberRole` and `beforeCreateInvitation` hooks reject any role outside `ROLES` with
`400 ROLE_NOT_FOUND`. This applies to HTTP calls and to server-only `auth.api` calls such as
`addMember`. The `member_role_chk` and `invitation_role_chk` CHECK constraints are the backstop,
and a test keeps them equal to `ROLES`.

## Passkey relying party

Everything is derived from `APP_URL`: `rpID` is its hostname (`localhost` in dev, the registrable
production domain in prod), `origin` is its origin, and `rpName` is `CauseDeck`. Changing the
production domain invalidates existing passkeys, because WebAuthn binds each credential to its
RP ID.

## Enabling Google

1. Create an OAuth client (web application). The redirect URI is
   `${APP_URL}/api/auth/callback/google`. The real credentials are tracked in #109.
2. Set `AUTH_GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Env validation
   (#4) fails at boot if either credential is missing while the switch is on.
3. With the switch off, `socialProviders` is empty and `/sign-in` renders no Google button.

## Email

`createMailer(env)` picks the transport from `EMAIL_PROVIDER`:

- `console` (default): logs the recipient, the i18n keys, and the link on its own line so terminals
  make it clickable.
- `smtp`: sends plain text through `SMTP_URL` (Mailpit at `smtp://localhost:1025`, UI on `:8025`,
  from #5).
- `ses`: falls back to the console mailer with a warning until #23.

Auth emails carry i18n keys (`auth.email.magicLink.subject`, `auth.email.magicLink.body`) and the
recipient's locale, never English prose. The templated transport in #23 resolves the keys.

## Phone OTP (#503)

Phone-first sign-in: a +91 mobile number and a six-digit code by SMS (Better Auth `phoneNumber`
plugin, mounted only when `createAuth` gets an `sms` sender). Codes expire after 5 minutes and allow
3 wrong attempts. The first verification creates the account (never when `disableSignUp`, as in the
admin console) with the placeholder email `<digits>@phone.causedeck.invalid`; `user.email` stays
required and unique.

`createSmsSender(env)` (`@causedeck/auth/sms`) picks the transport from `SMS_PROVIDER`:

- `console` (default): logs the message; the code is logged only outside production, and the number
  is masked to its last four digits in production.
- `msg91`: MSG91 Flow API with the DLT-registered OTP template. Needs `SMS_AUTH_KEY`,
  `SMS_SENDER_ID`, `SMS_DLT_ENTITY_ID` and `SMS_OTP_TEMPLATE_ID` (DLT template registration is a
  human step with the operator).

| Limit | Where |
|---|---|
| OTP send: 5 per phone number per 15 minutes | `hooks.before` counter under `phone-otp:phone:<sha256(number)>` |
| OTP send: 20 per IP per hour; verify: 30 per IP per hour | Better Auth `customRules` |
| Wrong codes: 3 per code | plugin `allowedAttempts` |

Linking: a phone-only account can add an email on `/account` (`/change-email`, refused for accounts
that already have a real email) and link Google (`account.accountLinking`, Google trusted). Security
events record the method `phone_otp`.

## Rate limits

Rate limiting is always on, with storage `database` (the `rate_limit` table).

| Limit | Where |
|---|---|
| Magic link: 20 requests per IP per hour | Better Auth `customRules['/sign-in/magic-link']` |
| Magic link: 5 requests per email per 15 minutes | a `hooks.before` counter in `rate_limit` under `magic-link:email:<sha256(lowercased email)>` |
| Everything else | Better Auth defaults (100 per 10 s; 3 per 10 s on other `/sign-in*` paths) |

Both magic-link limits answer `429 { "message": "Too many requests. Please try again later." }`.
The client IP comes from `x-forwarded-for`, which must be set by our own proxy.

## Threat notes

- **Enumeration.** The magic-link request takes the same code path and returns the same body
  whether or not an account exists. The email is sent without awaiting the transport, so delivery
  time cannot leak, and the rate limits respond identically for known and unknown addresses.
- **Secrets.** `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET` and `SMTP_URL` arrive as #4 `Secret`
  values and are revealed only at the call that needs them; `createAuth` rejects plain strings.
  Better Auth's logger is bridged to ours with the message only (no request arguments), and tests
  assert that neither secret appears in log output.
- **Tokens.** Magic-link tokens are hashed at rest and consumed on first use. Session tokens are
  random, held in httpOnly cookies, and deleted on sign-out.
- **Dev sign-in** cannot ship: it is excluded from production bundles and answers 404 under
  production at runtime.
- **Open redirects** on `next`/`callbackURL` are rejected by Better Auth's origin check, and the
  app only ever passes on a `?next=` that `safeNextPath` accepted (`apps/web/lib/safe-next.ts`,
  tested in `apps/web/__tests__/safe-next.test.ts`).
