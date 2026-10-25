### Approach
Lawyer memory domain (#72): proposals are written to `memory_proposal` only; `confirmMemory` and `createMemoryNote` are the only writers of `memory_item`. Scope is enforced by RLS plus matching query predicates, with a column-scoped clerk view.

### Changes
- packages/validators/src/memory.ts (+test, index): layers, scopes, key registry, judge/bench guard.
- packages/db: schema/memory.ts, migration 20261025110852_memory.sql (RLS, clerk view, checks), seeds, registries.
- packages/core/src/memory/*: scope, propose, confirm, read, review, embedding.
- automation handler `memory-item`, jobs `memory.purge` and `memory.review-prepare`, registries.
- ADR 0037, core-domains docs and eslint domain edges.

### Acceptance Criteria Status
- R1–R17 ✅ (packages/core/src/memory/*, packages/core/src/memory/__tests__/*, packages/core/src/__tests__/cross-tenant/memory.test.ts)

### Verification
- V1 core vitest (memory, domains, automation, erasure, jobs, cross-tenant): pass. Under host load, memory-erasure and automation.bench timed out once, and both pass when rerun alone.
- V2 validators vitest: pass.
- V3 db vitest (index, rls): pass.
- V4 worker vitest (registry, schedules): pass.
- V5 checks.mjs widened to the full monorepo (core package.json is a build-config change), so I ran `tsc --noEmit` for validators, db, core and worker instead: clean.
- The new tests fail without the fix because the memory services do not exist.

### Notes
No env vars. `apps/worker/src/schedules.ts` is unchanged because schedules come from the job registry. The cross-tenant cases live in cross-tenant/memory.test.ts, which the registry points at.

## Follow-up: stale-list check
The admin tests at the cited lines (headers, server-actions-audit, sources-actions) mock core modules; none lists db schema exports, so the memory schema symbols are recorded as not_members in result.json.

### Sibling lists
The three admin tests (headers, server-actions-audit, sources-actions) do not enumerate `@causedeck/db` schema exports, so the ten new memory symbols are recorded as `not_members` in result.json and no test changed. Targeted rerun below.

## Follow-up: duplicate export
Renamed `parseInput` in packages/core/src/memory/propose.ts to `parseMemoryInput` (it collided with matter-graph/context.ts); updated read.ts and confirm.ts. It is not re-exported from the memory index. tsc and memory vitest pass.

## Merge-fix note
The reported `turbo: command not found` was a PATH problem, not a code conflict. Running `node_modules/.bin/turbo run typecheck --filter='...[origin/milestone/follow-up-continuity-memory]'` passes (24/24). No source change was needed.

## Merge-fix recheck
Second report of `turbo: command not found` (exit 127): host PATH only. With `node_modules/.bin` on PATH, turbo typecheck for validators, db and core passes (16/16). No source change.

### Post-merge typecheck
`turbo: command not found` is a PATH problem: turbo is only at `node_modules/.bin/turbo`. It is not a code conflict. After the merge, `tsc --noEmit` is clean for validators, db, core and worker, so no source change was needed. I did not run a monorepo-wide turbo typecheck, because the host rules forbid it.

## CI lint fix

`pnpm adr:lint` failed: ADR 0038 lacked the required `## Revisit when` section. Added it. ESLint on changed files in core, db, validators, worker and config, and prettier, are clean.

## CI tenancy fix

`packages/db` cross-tenant `tables.test.ts` failed for `memory_item`: the seeded row was user-scope, so the restrictive `memory_item_owner_scope` policy hid it from the second actor (`uboth`), and the "A can read its own row" count was 0. The seed (`packages/db/src/seed/memory-fixtures.ts`) now writes a workspace-scope item. No policy change. `src/__tests__/cross-tenant` passes for the memory tables.

## CI tenancy fix (2)

The `tenancy` job's last step, `pnpm test:export-coverage`, failed: the five new memory tables (`memory_item`, `memory_proposal`, `memory_embedding`, `memory_usage`, `memory_pause`) had neither an exporter nor an exclusion. They are now in `EXPORT_EXCLUSIONS` (`packages/core/src/lifecycle/export/registry.ts`), each with a reason: the values are sealed and role-scoped, so the decrypted export is `exportMemory`; the rest are derived or content-free. `export-coverage.test.ts`, the db cross-tenant and rls suites pass.

## Rerun verification
V1 (17 files, 398 passed), V2, V3, V4 pass; V5 widened to full monorepo, so tsc --noEmit for validators, db, core, worker is clean. forgedock check passes.

## Stale-list follow-up
The 30 memory schema symbols flagged against three admin tests are not members of any list there (those tests mock modules, not schema exports); recorded in result.json not_members. No code change.

## CI purge-coverage fix
`purge-coverage.test.ts` failed: the five memory tables were in neither `PURGE_ORDER` nor `FINALIZE_TABLES`, so workspace erasure would have skipped them. Added `memory_usage`, `memory_embedding`, `memory_proposal`, `memory_item`, `memory_pause` to `PURGE_ORDER` (`packages/core/src/lifecycle/deletion/erase.ts`), embeddings before items (FK). `src/lifecycle` tests pass (15 files).

## CI memory-erasure seed fix
`memory-erasure.test.ts` seedMemory's "extra embeddings" insert picked `(select id from memory_item limit 1)` without a workspace filter, so it could take another workspace's item (FK violation on `memory_embedding_item_fk`). It now filters by `workspace_id`. Test-only change; the file passes (4 tests).
