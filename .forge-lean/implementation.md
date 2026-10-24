### Approach
Public API keys (#624): a tenant `api_key` table (sha256 hash only, token shown once), a core `api-keys` domain, an API-key `BearerResolver`, per-key rate limit and monthly quota, and one billed `api.calls` usage unit per request.

### Changes
- packages/db: `schema/api-keys.ts`, `schema/index.ts`, migration `0080_api_keys.sql` (+ snapshot, journal) with RLS and owner-defined `app_api_key_by_hash`; registry/test lists (`index.test.ts`, `rls/sql.test.ts`, `cross-tenant-registry.ts`, `two-tenants.ts`).
- packages/core: `api-keys/index.ts` (create/list/revoke audited, authenticate, consumeApiCall), `usage/keys.ts` (`api.calls`), `package.json`, `index.ts`, audit actions `api_key.created`/`api_key.revoked` (`audit/events.ts`, docs/engineering/audit.md), cross-tenant cases, domain tests.
- apps/api: `createApiKeyResolver` (auth.ts), `Principal.apiKey` and `requireScope` (openapi.ts), `middleware/api-key.ts`, per-key rate-limit counters (rate-limit.ts), wiring (app.ts), end-to-end test.
- core-domains.js and docs/engineering/core-domains.md: `api-keys` depends on audit, usage, workspaces.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/api-keys/index.ts, packages/db/src/schema/api-keys.ts
- R2 ✅ packages/core/src/usage/keys.ts:12
- R3 ✅ apps/api/src/middleware/auth.ts (createApiKeyResolver)
- R4 ✅ cross-tenant-registry.ts, core-domains.js, index.test.ts, rls/sql.test.ts
- R5 ✅ apps/api/src/__tests__/api-keys.test.ts, packages/core/src/api-keys/__tests__/api-keys.test.ts

### Verification
Verify mode is CI: V1 to V4 were not run locally (formatter and linter only). The new tests are expected to fail without the fix (the module does not exist).

### Notes
- Quota exhaustion answers 429 with code `RATE_LIMITED` (no `QUOTA_EXCEEDED` code exists in apps/api/src/errors.ts); `x-quota-limit` and `x-quota-used` headers distinguish it.
- Added audit actions (events.ts, audit.md) to audit key issue and revoke, as the contract requires.
- Sibling-list check: apiKey/api-keys are not members of the listed apps/web and apps/admin tests (no UI, route or server action added); recorded in result.json not_members.

### CI fix (web shard)
- `apps/web/__tests__/usage-page.test.tsx` asserted `getUsage` is called once per usage key (7); the new `api.calls` key makes it 8. Updated the expectation. The usage page still shows no `api.calls` row (the table rows are hard-coded).

- CI fix: audit metadata values must be scalar; `api_key.created` now records `scopes` as a comma-joined string (packages/core/src/api-keys/index.ts).
