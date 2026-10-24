**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature, part of #508; no regression)
**Task Type**: feature

### What Was Claimed
#685: a core migration domain on top of `packages/core/src/import` (upload a portfolio file, column mapping, dry-run reporting mapping issues for 5,000 matters without writing, resumable chunked import with progress, rollback via `undoImportBatch`) plus an `apps/admin` console section. Acceptance: a 5,000-matter dry-run writes nothing; the real import is resumable. Depends on #682 (merged).

### What We Found
- The schema exists (merged #682): `packages/db/src/schema/enterprise.ts:37-41` (`MIGRATION_MODES` dry_run|import, row states pending|ok|skipped|error|rolled_back), `:129-163` `migration_run` (status, totalRows, processedRows, errorRows, `resumeFrom`, `report` jsonb, rolledBackAt), `:165-192` `migration_run_row` (rowIndex, state, entityKind/entityId, error). Registered in `packages/db/src/testing/cross-tenant-registry.ts:153-154`.
- No migration domain: `packages/core/src` has no `migration/` folder; `CORE_DOMAINS` and `CORE_DOMAIN_DEPENDENCIES` in `packages/config/eslint/core-domains.js` have no entry (`import` is at :124).
- Import domain pieces to reuse (`packages/core/src/import/index.ts`): `createImportBatch`/`finishImportBatch` (`batch.ts:155,653`), `buildPlanFromDrafts` (`bootstrap.ts:164`, pure, takes `PlanDraftInput[]`, `bootstrap.ts:50`), `applyImportPlan` (`apply.ts:122`, one transaction over a `ready` batch with a stored `import_plan`; writes in CHUNK=25 savepoints, `apply.ts:43,278`; idempotent by plan hash), `undoImportBatch` (`undo.ts:33`, applied batch only, 7-day window `apply.ts:42`). Core exposes it as `@causedeck/core/import`, not the root (`package.json:19`).
- `applyImportPlan` is not resumable across a failure, and it only takes a batch built from captures/proposals. Resume and per-row state must come from the new run tables, so a run is split into chunks, each applied as its own import batch. Chunk size is about 250 matters.
- Admin app: pages under `apps/admin/app/(console)/*` call `requireStaff(<capability>)` (`data-ops/page.tsx:~57`). Capabilities and roles are in `apps/admin/lib/roles.ts:18-31`, nav in `components/console-nav.tsx:29-50`. Reads go through `lib/data/index.ts` and `staffCall`/`staffQuery` (`lib/data/scope.ts`); admin never value-imports `@causedeck/db`. Every `'use server'` export is listed in `apps/admin/__tests__/server-actions-audit.test.ts` (`ACTIONS`); `no-content-fields.test.ts` and `server-component-imports.test.ts` also guard pages. Staff action precedent: `workspaces/[id]/actions.ts`.
- Staff have no tenant-write path today: support sessions are `view` or `usage` scope only (`packages/core/src/support/sessions.ts:129-137`). The concierge needs to write matters in a customer workspace, so the run executes as a workspace owner actor through the core service, audited with the staff id.
- Stale `.forge-lean/*` files from a different issue (portfolio UI) were present and are overwritten.

### Root Cause
Missing feature. Parts of #508 (schema #682, plans #686) landed. Nothing orchestrates a validated, chunked, resumable, reversible bulk matter import, and the admin console has no surface for it.

### Affected Files
- New domain `packages/core/src/migration/{index.ts,csv.ts,run.ts}`; register in `packages/config/eslint/core-domains.js` (deps: `import`, `matter-graph`, `workspaces`, `audit` as needed) and `docs/engineering/core-domains.md`; `packages/core/package.json` subpath `./migration`.
- `packages/db/src/testing/cross-tenant-registry.ts` `SERVICE_TESTS` and `packages/core/src/__tests__/cross-tenant/services.test.ts` (only if a root export is added; the import domain is a subpath, so probably `NOT_A_SERVICE` or nothing).
- `apps/admin`: `lib/roles.ts`, `components/console-nav.tsx`, new `app/(console)/migrations/{page.tsx,[id]/page.tsx,actions.ts}`, `lib/data/index.ts`, plus guard tests.

### Sibling Sweep
Same registries as every new feature: admin `ACTIONS` audit test, `no-content-fields` (the admin report must show counts, row numbers and issue codes, never row content), core-domain boundaries, i18n is not needed (admin is English-only, as the other console pages). Siblings #683 (SSO) and #684 (provisioning) share `enterprise.ts` and the admin nav, so expect merge conflicts in `roles.ts` and `console-nav.tsx`.

### History
Schema foundation #682 (be0f4b12), seat plans #686 (f2ee4075). Import engine #548-#551. Parent #508 closed as not_planned (umbrella).

### Recommendation
1. Core `migration` domain. `parseMigrationCsv(text, mapping)`: pure; accepts header-to-field mapping (title, case type, number, year, forum code, CNR, parties, stage, next date); rows over 5,000 are rejected; returns rows plus per-row issue codes.
2. `startMigrationRun`: dry_run does validation only (mapping issues, bad dates, unknown forum, duplicate CNR vs existing proceedings) into `migration_run.report` and row states, and writes no matter, proceeding or import batch. An import run stores rows as `pending`.
3. `runMigrationChunk`/`resumeMigrationRun`: processes `resumeFrom..+250`, builds drafts to a plan (`buildPlanFromDrafts`), stores one `import_batch` per chunk and applies it via `applyImportPlan`. It marks rows ok/error, advances `resume_from` and `processed_rows` in the same transaction, and is safe to re-call after a crash (idempotent by plan hash). `getMigrationProgress` returns counts.
4. `rollbackMigrationRun`: `undoImportBatch` for each chunk batch (chunk batch ids kept in `report`), rows to `rolled_back`, `rolled_back_at` set; refuse after the 7-day window.
5. Admin section with upload, mapping, dry-run report, import with progress, resume, rollback; staff-only, audited actions.
6. Tests: a 5,000-row dry-run asserts zero rows in matter/proceeding/import_batch; an import interrupted mid-way then resumed ends with exactly 5,000 and no duplicates; rollback.
Medium confidence: the exact way to store chunk plans (import_plan without captures) and the staff-as-owner actor need verification while implementing.

### Related Issues
#508 (parent), #682 (schema, done), #683 and #684 (siblings, nav/roles overlap), #686.
