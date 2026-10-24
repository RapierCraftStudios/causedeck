**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield; part 1 of 4 of #487, blocks #625/#626; nothing is exposed publicly yet)
**Task Type**: feature

### What Was Claimed
Part of #487: per-workspace API keys (hashed at rest, shown once), scopes, per-key quotas and rate limits, a usage key for billed calls through the #30 usage service, and a `BearerResolver` (`apps/api/src/middleware/auth.ts`) that resolves keys to a principal. Register in cross-tenant, core-domains and db test lists. Acceptance: keys, scopes and quotas enforced and usage billed per call [integration].
Note: the "Investigation Report" comment already on #624 is for #586 (notices poll), not this issue; ignored.

### What We Found
- `apps/api/src/middleware/auth.ts:12-14` defines `BearerResolver` and `rejectAllBearerTokens`; `principalFrom` (:25-38) calls it and stamps `via:'bearer'`. `apps/api/src/app.ts:42,111` takes an optional `bearer` dep; nothing supplies one (the comment at auth.ts:3 says "API keys arrive later").
- `Principal` (`apps/api/src/lib/openapi.ts:12-16`) is `{user, via}` only: no workspace, scopes or key id. `requireWorkspace` (`middleware/workspace.ts:34-68`) derives workspace from path/header and checks `memberRole`.
- No API key table: `packages/db/src/schema/` has none (`auth.ts` has only user/session/org). Latest migration is `0079_source_data_class.sql`.
- Usage: `packages/core/src/usage/keys.ts:4-12,16-24` lists `USAGE_KEYS` and counter/gauge kinds; `meter.ts` `increment(ctx,key,amount,{idempotencyKey})` is idempotent per workspace. Key pattern `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$` (`packages/db/src/schema/usage.ts:26`). `packages/core/src/runtime/index.ts:233` iterates `USAGE_KEYS` (new key shows up automatically); `fair-use.ts:20` and `billing/src/entitlements.ts` are plan caps, not needed for a billed-per-call key.
- Rate limiting: `middleware/rate-limit.ts` is per user / IP with prefix groups (`RateLimitOptions.groups`, :48-55); in-memory store. No per-key limit.
- Token hashing precedent: `packages/core/src/workspaces/invitations.ts:4,40-41` (`randomBytes` + sha256 hex).
- Registries: `config/eslint/core-domains.js:55` (`usage: ['audit','billing']`), `packages/db/src/index.test.ts:69` and `__tests__/rls/sql.test.ts:41` (table lists, e.g. `budget_override`), `db/src/testing/cross-tenant-registry.ts:181` (`SERVICE_TESTS`) with `core/src/__tests__/cross-tenant/services.test.ts`; `apps/api/src/__tests__/cross-tenant.test.ts:89` lists /v1 routes.

### Root Cause
Greenfield: the bearer seam was left open (#14) and there is no key store, scope model, per-key limit or `api.*` usage key.

### Affected Files
- `packages/db/src/schema/api-keys.ts` (new), `schema/index.ts`, migration `0080_api_keys.sql` + `meta` snapshot/journal
- `packages/core/src/api-keys/{index,keys,scopes,authenticate,quota}.ts` (new domain) + tests; `packages/core/package.json` `./api-keys` export (mirror `./usage`); `packages/core/src/index.ts`
- `packages/core/src/usage/keys.ts` (`api.calls`)
- `apps/api/src/middleware/auth.ts`, `lib/openapi.ts` (Principal), `middleware/api-key.ts` (new: scope check, per-key rate limit, quota + metering), `app.ts` wiring
- Registries: `config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `db/src/testing/cross-tenant-registry.ts`, `core/src/__tests__/cross-tenant/services.test.ts`, `db/src/index.test.ts`, `db/src/__tests__/rls/sql.test.ts` (+ seeders if required)

### Sibling Sweep
Other hashed one-time secrets: invitation tokens (`workspaces/invitations.ts`) and whatsapp tokens; reuse the sha256 + `timingSafeEqual` pattern. Bearer consumers: only `app.ts`. Existing cookie/session callers of `Principal` must keep working (new fields optional).

### History
Seam introduced by #14 (`auth.ts` header comment). Usage service by #30. No prior API key attempt; #487 was closed not_planned and split into #624-#627.

### Recommendation
New workspace-scoped table `api_key` (id, workspace_id, created_by user id, name, prefix, token_hash unique, scopes text[], monthly_quota int null, rate_limit_per_minute int, expires_at, revoked_at, last_used_at; tenant RLS like other workspace tables). Token format `cdk_<prefix>_<secret>`; only sha256 stored; plaintext returned once by `createApiKey`. Core `api-keys` domain: create/list/revoke (owner/admin via workspaces `requireCan`-style check, audited through `audit`), `authenticateApiKey(db, token)` using an owner-defined SECURITY DEFINER lookup by hash (tenant table is FORCE RLS and workspace is unknown at that point), scope vocabulary (`cases:read`, `causelists:read`, `orders:read`, `notices:read`, `webhooks:write`), `consumeApiCall(ctx,key)` which checks the monthly quota against `getUsage` and bills via `increment('api.calls',1,{idempotencyKey:requestId})`. API: `bearer` resolver returns a Principal with `apiKey:{id,workspaceId,scopes,rateLimitPerMinute,quota}` and `user` = the key creator (so `requireWorkspace` membership still gates revoked/removed creators; header workspace must equal key workspace); new `requireScope(scope)` and a per-key rate-limit key (`key:<id>`) in `rate-limit.ts`; quota exhaustion -> 429 `QUOTA_EXCEEDED`; metering after successful auth. Register everything in the lists above.

### Related Issues
#487 (parent, closed not_planned), #625 (endpoints use `requireScope`), #626 (webhooks), #627 (docs), #30 (usage service), #14 (API), #486 (posture doc).
