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
