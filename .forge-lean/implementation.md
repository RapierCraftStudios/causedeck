### Approach
Followed the frozen contract: `template` is a global-or-workspace table (system rows readable by members, written only by the owner role), `draft` and `draft_version` are tenant tables. A trigger makes `draft_version` immutable. The block, resolver and preset lists live only in `@causedeck/validators`, so db takes no new dependency on it.

### Changes
- packages/db/src/schema/drafting.ts: `template`, `draft` (composite FK to `matter`, scope-guarded FK to `template`), `draft_version` (composite FK to `draft`, sha256 check).
- packages/db/src/schema/index.ts, conventions.ts: barrel export; `template` added to `GLOBAL_OR_WORKSPACE_TABLES`.
- packages/db/migrations/20261025050000_drafting.sql (+ journal idx 99, snapshot): generated DDL plus forced RLS, `global_read` and `owner_catalogue` on `template`, the scope-guard trigger, and the `draft_version` immutability trigger. The trigger allows only nulling `created_by` (user erasure) and the cascade from a deleted draft.
- packages/db/src/index.test.ts, __tests__/rls/sql.test.ts, __tests__/conventions.test.ts: registered the new tables in the root list, RLS catalog, policy test and the expected global-or-workspace list.
- packages/db/src/testing/cross-tenant-registry.ts, two-tenants.ts: `TABLE_TESTS` entries and seeders.
- packages/db/src/__tests__/drafting-schema.test.ts (new): regression tests for system-template access, the scope guard, `draft_version` immutability and cascade, and nullability of `workspace_id`.
- packages/validators/src/drafting.ts (+ test), index.ts, package.json: `BlockSchema`, `TemplateSchema`, `FormatPresetSchema`, `DraftSchema`, `DraftVersionSchema`, `ExportRequestSchema`, with the `./drafting` subpath export.
- packages/core/src/lifecycle/deletion/erase.ts, export/exporters.ts: registered the new tenant tables for workspace erasure and export (guard tests require it). Both files are amendments.

### Acceptance Criteria Status
- R1 ✅ packages/db/src/schema/drafting.ts:33,60,94
- R2 ✅ packages/db/migrations/20261025050000_drafting.sql, packages/db/src/schema/index.ts:132
- R3 ✅ packages/validators/src/drafting.ts:81,148,172, index.ts
- R4 ✅ packages/db/src/index.test.ts, __tests__/rls/sql.test.ts, testing/cross-tenant-registry.ts, testing/two-tenants.ts
- R5 ✅ migration RLS statements; __tests__/drafting-schema.test.ts; validators/src/drafting.test.ts

### Verification
- V1 `pnpm --filter @causedeck/validators exec vitest run src/drafting.test.ts src/index.test.ts`: pass (9 tests).
- V2 `pnpm --filter @causedeck/db exec vitest run src/index.test.ts src/__tests__/rls/sql.test.ts`: pass after fixing the table order in index.test.ts (the check-rls CLI test runs inside it).
- V3 check-schema-conventions, lint-migrations and drizzle-kit check: pass.
- V4 `tsx scripts/check-rls.ts` run standalone: exit 1 because it has no database URL outside vitest; the same check passes in `sql.test.ts` ("db:check-rls CLI" test), which provides one.
- V5 checks.mjs: ran, printed turbo scoped commands; I ran the equivalent package-scoped tsc (db, validators, core), eslint on changed files, and vitest for db (cross-tenant tables, conventions, lint-migrations, drafting-schema) and core (export-coverage, deletion, cross-tenant, account-deletion, court-data): all pass. `--publish` reported "no local cache".
- New tests fail without the fix: yes. The drafting tables and the validators module do not exist on the base.

### Notes
- No env vars. Migration is expand-only.
- `lane-check.sh` does not exist on this host, so lint ran as eslint on the changed files per package.
- `draft_version` direct DELETE is rejected while the draft exists, so erasure deletes `draft` first (cascade).
