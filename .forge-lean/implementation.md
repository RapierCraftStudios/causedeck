### Approach
SSO is already implemented on the branch (better-auth sso plugin on the organisation-scoped sso_provider, DNS-verified domains, sealed secrets). This session re-validated against `origin/milestone/instant-gtm-adoption` and recorded amendments for files beyond the original deliverable list.

### Changes
- packages/auth: sso.ts, server.ts, client.ts, rate-limit.ts, package.json: plugin, `sso` sign-in method, rate limits, audit.
- packages/core: workspaces/sso.ts, audit/events.ts: provider CRUD and audit events.
- packages/db: migrations 20261025020000/20261025020100, schema/enterprise.ts, cross-tenant registry.
- apps/web: sign-in SSO entry; owner settings/sso page with actions, loading, error.
- packages/i18n: en/kn/ta copy; docs/engineering/auth.md.

### Acceptance Criteria Status
- R1 ✅ packages/auth/package.json
- R2 ✅ packages/auth/src/sso.ts
- R3 ✅ apps/web/app/(public)/sign-in/sso-form.tsx
- R4 ✅ apps/web/app/(app)/w/[slug]/settings/sso/page.tsx
- R5 ✅ packages/auth/src/rate-limit.ts, packages/auth/src/server.ts
- R6 ✅ packages/auth/src/__tests__/sso-sign-in.test.ts

### Verification
- V1 auth vitest: exit 0. V2 core vitest: exit 0 (276 passed). V3 web vitest: exit 0 (49 passed). V4 db vitest: exit 0. V5 i18n vitest: exit 0.
- V6 checks.mjs widened to full turbo (auth package.json changed); not run in full per host rules. Scoped `tsc --noEmit` for auth, core, web: exit 0. Prettier --check on changed files: clean. lane-check.sh is absent on this host so lint was not run locally.
- New tests fail-without-fix: not re-measured this session.

### Notes
No new env vars beyond the auth secret used for SSO sealing (already in the cross-tenant env mock). No code changes this session, so nothing new to commit.
