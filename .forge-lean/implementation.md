### Approach
Drafting data layer (#766): `template` (global-or-workspace), `draft`, immutable `draft_version`, plus Zod validators for block trees.

### Changes
- packages/db/src/schema/drafting.ts, schema/index.ts: tables and barrel export
- packages/db/src/conventions.ts: `template` added to GLOBAL_OR_WORKSPACE_TABLES
- packages/db/migrations/20261025050000_drafting.sql, meta snapshot and journal: migration with RLS, scope guard, immutability trigger
- packages/db/src/index.test.ts, rls/sql.test.ts, testing/cross-tenant-registry.ts, testing/two-tenants.ts, conventions.test.ts: registrations and seeders
- packages/db/src/__tests__/drafting-schema.test.ts: regression tests (system template read-only, scope guard, immutability, cascade)
- packages/validators/src/drafting.ts (+ test, index.ts, package.json export): Template/Block/Draft/FormatPreset/ExportRequest schemas
- packages/core lifecycle erase.ts, exporters.ts: purge order and export for the new tables

### Acceptance Criteria Status
- R1 ✅ packages/db/src/schema/drafting.ts:44-117
- R2 ✅ packages/db/migrations/20261025050000_drafting.sql, schema/index.ts:132
- R3 ✅ packages/validators/src/drafting.ts, index.ts:9
- R4 ✅ index.test.ts, rls/sql.test.ts, cross-tenant-registry.ts, two-tenants.ts
- R5 ✅ drafting-schema.test.ts, rls sql.test.ts

### Verification
- V1, V2, V3: exit 0.
- V4 (check-rls.ts): exits 1 in the engine environment because no DATABASE_URL(_OWNER) is set (the query fails with no connection). Run with `--url` against a freshly migrated test container it prints "Row-level security: every tenant table is isolated." and exits 0.
- V5: exit 0.
- New tests fail without the fix (tables and exports do not exist).

### Notes
No env vars. Expand-only migration.

### Sibling-list follow-up
Checked the 9 flagged tests: none enumerate @causedeck/db schema exports at the flagged lines (hoisted state, unrelated mocks, fixtures), so every symbol is recorded under not_members in result.json. No test edits needed.
