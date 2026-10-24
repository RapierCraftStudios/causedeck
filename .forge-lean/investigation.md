**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P1 feature; GTM onboarding)
**Task Type**: feature

### What Was Claimed
Phone-number OTP sign-up/sign-in (India-first, DLT SMS provider) alongside email: Better Auth phone plugin in `packages/auth`, phone-first sign-in UI in `apps/web`, SMS env/processor entries with mock-safe defaults, rate-limited expiring OTPs, and a phone account that can later link email and Google.
Note: the earlier "Investigation Report" comment on the issue describes a portfolio UI (a different issue); it does not apply and was ignored. The issue body is the source of truth. Base ref: `origin/milestone/instant-gtm-adoption`.

### What We Found
- No phone support anywhere: `git grep -i phone` in `packages/auth`, `packages/db/src/schema/auth.ts`, `apps/web/app/(public)/sign-in` is empty at base.
- `packages/auth/src/server.ts:272-321` plugins are magicLink, passkey, organization, twoFactor only; no `phoneNumber`. `server.ts:328-` betterAuth config has no `account.accountLinking`.
- `packages/auth/src/server.ts:38` `SignInMethod` has no phone value; `signInMethod()` (`:121-130`) maps paths to methods; `securityEventHook` (`:194`) records only magic-link/passkey/2FA events.
- Rate limiting: per-IP Better Auth `customRules` (`server.ts:~357`) and per-email DB counter `consumeRateLimit` (`rate-limit.ts:12-60`) used in `hooks.before` (`server.ts:~366`). Reuse this pattern for per-phone-hash and per-IP OTP limits.
- `packages/db/src/schema/auth.ts:57-67` `user` has `email notNull unique` and no `phoneNumber`/`phoneNumberVerified` columns. Better Auth's phone plugin needs both fields and, with `signUpOnVerification`, a `getTempEmail` for phone-only users. Latest migration is `20261024182641_activation_event` (journal idx 90) so the next migration needs a later timestamp (`packages/db/migrations/meta/_journal.json`).
- Delivery abstraction is email-only: `packages/auth/src/mailer.ts` (`Mailer`, `createMailer`, EMAIL_PROVIDER console/smtp/ses). No SMS sender. Env registry is `packages/config/src/env/providers.ts:221-245` (pattern: `AUTH_GOOGLE_ENABLED`, `requiredWhen`, `secret`), documented in `docs/engineering/env.md:111-137`, `.env.example:182-293`, `.env.ci`.
- Client: `packages/auth/src/client.ts:9-19` has no `phoneNumberClient`.
- UI: `apps/web/app/(public)/sign-in/sign-in-form.tsx:55-` stacks Google, passkey, "or", `MagicLinkForm`; strings in `packages/i18n/src/messages/en/auth.json` (+kn/ta). `apps/web/lib/auth.ts:19-30` wires `createAuth` with `createMailer`.
- `better-auth` ships `plugins/phone-number` (present in node_modules), so no new dependency is needed.
- E2E sign-in spec exists: `e2e/tests/auth/sign-in.spec.ts` (magic link via Mailpit); e2e runs only in CI.

### Root Cause
Feature not built: auth only supports magic link, passkey and Google; no phone identity column, SMS transport, OTP limits, or UI.

### Affected Files
- `packages/db/src/schema/auth.ts` (+ new migration SQL, snapshot, `_journal.json`)
- `packages/config/src/env/providers.ts`, `docs/engineering/env.md`, `.env.example`, `.env.ci`
- New `packages/auth/src/sms.ts` (SmsSender interface, console/mock sender, DLT provider sender), `packages/auth/package.json` exports (`./sms`)
- `packages/auth/src/server.ts`, `client.ts`, `rate-limit.ts`; tests in `packages/auth/src/__tests__/`
- `apps/web/lib/auth.ts`, sign-in components, `apps/web/app/(app)/account` linking UI, `packages/i18n/src/messages/{en,kn,ta}/auth.json`
- `docs/engineering/auth.md`, `e2e/tests/auth/` (new phone spec; CI-only)
- Possibly `apps/admin` auth wiring if `createAuth` deps change (keep `sms` optional).

### Sibling Sweep
- `createAuth` callers (`apps/web/lib/auth.ts`, `apps/admin`, `packages/auth/src/__tests__/helpers.ts`, `apps/api/src/__tests__/helpers.ts`): the SMS dep must be optional so they compile. Admin console passes `disableSignUp`: phone sign-up must honour it too (`signUpOnVerification` off).
- Security events: add phone method to `SignInMethod` and failure paths (`/phone-number/verify`), plus core recorder in `@causedeck/core/audit` if it enumerates methods.
- Never log or store raw phone numbers in events; hash like email.

### History
Greenfield. Auth stack: #152 (Better Auth), #228 (security events), #304 (step-up), #309 (admin disableSignUp). No prior phone attempt.

### Recommendation
1. DB: add nullable unique `phone_number` and `phone_number_verified` (default false) to `user`; migration with next timestamp; regenerate snapshot.
2. Config: `SMS_PROVIDER` enum (`console` default, `msg91`), with `SMS_AUTH_KEY` (secret), `SMS_SENDER_ID`, `SMS_DLT_ENTITY_ID`, `SMS_OTP_TEMPLATE_ID` required when provider=msg91; update docs/.env files.
3. Auth: `sms.ts` sender (console logs OTP only in non-prod, never in production); `phoneNumber({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, sendOTP, signUpOnVerification: { getTempEmail: p => `${p}@phone.invalid`, getTempName }})`; sendOTP not awaited-latency-leaky; per-phone-hash and per-IP limits via `hooks.before`; enable `account.accountLinking` (trusted: google; allow linking while signed in) so a phone user can link Google (`linkSocial`) and add an email (magic link or change-email while signed in, treating `*@phone.invalid` as unset).
4. Web: phone-first sign-in (country code +91 default, send OTP, verify, resend with cooldown), email options kept below; account page section to add email/Google. i18n en/kn/ta.
5. Tests: unit/integration in `packages/auth` (OTP expiry, rate limit, attempts, sign-up via verify, linking) using existing helpers; web sign-in component test; e2e spec added but not run locally.

### Related Issues
#152, #228, #304, #309 (auth foundations); parent theme "instant GTM adoption" milestone.
