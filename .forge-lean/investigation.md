**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield enterprise feature, part 2 of #508; adds a dependency and a sign-in path)
**Task Type**: feature

### What Was Claimed
Add the better-auth SSO plugin (new catalog dependency in `pnpm-workspace.yaml` and `packages/auth/package.json`), organisation-scoped provider config on `sso_provider`, an SSO sign-in entry on the web sign-in page, an owner settings page to configure it, rate limits and audit rows. Acceptance: an organisation can sign in through SSO. [type:integration]. Depends on #682 (merged).

### What We Found
- No SSO anywhere: `packages/auth/src/server.ts:208-247` plugins are magicLink, passkey, organization, twoFactor only; `packages/auth/package.json:29-38` has no SSO dep; `pnpm-workspace.yaml:48-111` catalog has `@better-auth/passkey` (:55) and `better-auth` 1.7.10 (:111) but no `@better-auth/sso`; `node_modules/.pnpm` has no sso/saml package (must be installed; lockfile changes).
- Schema exists (#682): `packages/db/src/schema/enterprise.ts:45-70` `ssoProvider` (tenant table, FORCE RLS): `protocol` saml|oidc, `issuer`, `domain` (globally unique, `sso_provider_domain_uq`), `config` jsonb (secret), `enabled` default false, `createdBy`. Header comment (:6-7) says the sign-in lookup by domain before a workspace is known belongs to this issue. Registered `DB_TABLES_TEST` at `packages/db/src/testing/cross-tenant-registry.ts:150`.
- Shape mismatch: the plugin owns a model also named `ssoProvider` (providerId, issuer, oidcConfig, samlConfig, domain, userId, organizationId). The drizzle adapter at `server.ts:269` is given the whole `schema`, so the plugin will resolve `schema.ssoProvider` (our table) and its writes/reads will not match columns. Must be reconciled (see Recommendation) after reading the installed plugin's schema.
- RLS: sign-in resolves a provider by email domain with no workspace context, but `sso_provider` is FORCE RLS; `config` holds client secrets so it must not be broadly readable.
- Rate limit pattern: `packages/auth/src/rate-limit.ts:9-50` (`consumeRateLimit`, `rate_limit` table) and `server.ts:297-305` customRules + `hooks.before` (:318-330); documented `docs/engineering/auth.md:148-158`.
- Audit pattern: auth security events `packages/core/src/audit/events.ts:65-78`, recorder `packages/core/src/audit/security-events.ts:82-88`, injected via `SecurityEventRecorder` (`server.ts:55-77`, hook `:176-210`); sign-in method union `SignInMethod` (:44) and `signInMethod()` (:121-131) map `/callback/` to google. SSO needs its own method (`sso`) and callback paths. Workspace-scoped settings audit rows go through core audit (see `settings/danger/actions.ts` pattern, `workspaceAction`).
- Web: sign-in page `apps/web/app/(public)/sign-in/page.tsx:84-120` (`SignInForm`, `googleEnabled`); client `packages/auth/src/client.ts:9-19` needs `ssoClient()`. Owner settings pages live under `apps/web/app/(app)/w/[slug]/settings/*` (e.g. `integrations`, `danger`) with `actions.ts`, `loading.tsx`, `error.tsx`; owner-only policy via `packages/auth/src/policy/matrix.ts:10` and `actions.ts:5`.

### Root Cause
Missing feature. #682 laid the tables only; no plugin, config service, lookup, UI or limits exist.

### Affected Files
- `pnpm-workspace.yaml`, `packages/auth/package.json`, `pnpm-lock.yaml` (new `@better-auth/sso` catalog pin matching better-auth 1.7.10).
- `packages/auth/src/server.ts` (plugin, SignInMethod `sso`, rate limit rule, hook), `src/client.ts` (`ssoClient`), `src/rate-limit.ts`, new `src/sso.ts`, tests in `src/__tests__/`.
- `packages/db/src/schema/enterprise.ts` + migration (only if column reconciliation needs it), plus RLS/lookup function for domain resolution.
- `packages/core/src/audit/events.ts` (+ `security-events.ts`) for `sso.*` / `auth.sign_in` method, `packages/core/src/workspaces/` or new service for provider CRUD (owner-only, registry entries in `packages/db/src/testing/cross-tenant-registry.ts` and `packages/core/src/__tests__/cross-tenant/services.test.ts`).
- Web: `apps/web/app/(public)/sign-in/{page,sign-in-form}.tsx` + new `sso-form.tsx`; new `apps/web/app/(app)/w/[slug]/settings/sso/{page,actions,loading,error}.tsx`; `ACTIONS`/probes in `apps/web/__tests__/cross-tenant-actions.test.ts`; settings nav; i18n JSON in `packages/i18n/src/messages/{en,kn,ta}` (+ catalog test if a namespace is added); `docs/engineering/auth.md`.

### Sibling Sweep
Same registration hazards as every enterprise slice: new core runtime exports (SERVICE_TESTS/NOT_A_SERVICE), each `'use server'` action (cross-tenant-actions), i18n namespace, core-domain imports (`CORE_DOMAIN_DEPENDENCIES`, `docs/engineering/core-domains.md`). Siblings #684 (SCIM/CSV) and #685 (migration) are separate; SCIM tokens/provisioning must not be built here. Auth `Auth` type consumers (`apps/web/lib/auth.ts`, admin console `disableSignUp`) must still typecheck.

### History
`ssoProvider` table added by be0f4b12 (#682, merged in 887c58e5 lineage). `server.ts` last touched by step-up (#304) and the admin console session work (#309). No prior SSO attempt.

### Recommendation
1. Add `@better-auth/sso` to the catalog (version = better-auth 1.7.10) and to `packages/auth` deps; install; read the installed plugin's `schema` and endpoints before designing.
2. Reconcile the model: prefer mapping the plugin onto our table via the plugin `schema.ssoProvider.fields` mapping, adding nullable additive columns by migration (next free number) only for what cannot map (providerId, oidc/saml config); keep `workspace_id`/RLS. Provider writes go through our owner-only core service (not the plugin's registerSSOProvider endpoint), which sets `workspace_id` and writes an audit row; disable plugin self-registration for non-owners.
3. Domain lookup before workspace is known: a narrow SECURITY DEFINER SQL function (or auth-db role) returning only `id, protocol, enabled` by domain; never `config`. Only `enabled` providers sign in.
4. Wire sign-in: sso plugin in `createAuth`, `ssoClient` in client, `sso` SignInMethod + callback path mapping, join the user to the workspace as the default member role (never owner) through `organizationProvisioning`/hook using `roles.ts`.
5. Rate limit SSO sign-in start and callback per IP (customRules) and per domain (`consumeRateLimit` key `sso:domain:<sha256>`), 429 with `RATE_LIMIT_MESSAGE`; document in `docs/engineering/auth.md`.
6. Audit rows: `sso.provider_created|updated|deleted|enabled` (workspace-scoped) and `auth.sign_in` with method `sso`; failed SSO sign-in as `auth.sign_in_failed`.
7. UI: "Sign in with SSO" email/domain entry on the sign-in page (no enumeration: same response for unknown domain), owner settings page (step-up not required unless a policy exists), i18n in en/kn/ta.
8. Integration test: with a mocked OIDC IdP, a user at a configured domain signs in and lands as a member of the organisation. Never run Playwright locally.

### Related Issues
#508 (parent), #682 (schema, merged), #684, #685, #686 (siblings).
