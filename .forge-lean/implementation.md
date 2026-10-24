### Approach
Recovery pass for ci.red: fix the two causes found in the CI log of 9b92edd7.

### Changes
- packages/core/src/api-keys/index.ts: period call count uses drizzle `gte(usageEvent.createdAt, start)` instead of a raw sql template with a Date param (ERR_INVALID_ARG_TYPE, also the API 500s).
- packages/core/src/lifecycle/export/exporters.ts: export `api_key` without `token_hash`.
- packages/core/src/lifecycle/deletion/erase.ts: `api_key` in PURGE_ORDER.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/api-keys/index.ts
- R2 ✅ packages/core/src/usage/keys.ts
- R3 ✅ apps/api/src/middleware/auth.ts
- R4 ✅ lifecycle exporters.ts, erase.ts, cross-tenant-registry.ts
- R5 ✅ packages/core/src/api-keys/index.ts, apps/api/src/__tests__/api-keys.test.ts

### Verification
Only prettier and eslint (lane-check lint, 22 files) were run on this host. All validate commands run in CI. The existing export-coverage, purge-coverage, core api-keys and API api-keys tests are the regression tests that failed before this fix.

### Notes
No behaviour change beyond the fix; api_key rows are now exported (minus hash) and purged on erase.
