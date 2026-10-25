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
- V4 (check-rls.ts): exit 0 when DATABASE_URL_OWNER points at a migrated Postgres (it needs a live DB; none is configured by default).
- V5: exit 0. `forgedock check` reports PASS for V1-V5 with that env.
- New tests fail without the fix (tables and exports do not exist).

### Notes
No env vars. Expand-only migration.

### Sibling-list follow-up
Checked the 9 flagged tests: none enumerate @causedeck/db schema exports at the flagged lines (hoisted state, unrelated mocks, fixtures), so every symbol is recorded under not_members in result.json. No test edits needed.

### CI failure follow-up (test job, no log available)
Could not reproduce. Run locally with one worker and no file parallelism: packages/db (60 files), packages/core cross-tenant + lifecycle/export + receipt/memory-erasure/step-up, packages/validators, and two apps/web action tests all pass; tsc --noEmit is clean for db, core and validators. With parallel files, core lifecycle tests hit Postgres deadlocks (40P01) in the shared `seedTwoTenants` plan/organization inserts, which look like an existing cross-file race rather than something this branch changed. No code change made.

### CI follow-up
The CI `test` job log was not available. I could not reproduce a failure locally. These pass on the branch: core `src/lifecycle` (15 files) and `src/__tests__` (13 files), db drafting-schema, conventions, migrate, lint-migrations, cross-tenant and rls (15 files), `tsc --noEmit` for validators, db, core, web and worker, and `drizzle-kit generate` (no schema changes). No code change was made. If the failure is outside these, the CI log is needed.

## Merge follow-up
The reported `turbo: command not found` (exit 127) was an environment failure, not a code conflict. Ran scoped `tsc --noEmit` for db, validators and core (clean) plus the V1-V3 validate commands (pass). Fixed the migration header comment to name 20261025060000_drafting.
