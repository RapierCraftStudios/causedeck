**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield P1 feature; no live defect)
**Task Type**: feature

### What Was Claimed
Build the lawyer memory engine in `packages/core` (PRD ME-1..ME-4): layers M1, M2, M3, M4, M6, M7 with confirm-before-save, scope enforced in SQL (RLS plus predicates, clerk column-scoped view), usage citations, per-item edit/delete/pause, a per-member pause-all switch, a judge/bench denylist, envelope-encrypted values, tenure metrics, matter-scoped embeddings with 24 h purge, and cross-tenant coverage. Spec is in the spike §5 and PRD ME-1..ME-4.

### What We Found
Verified against `origin/milestone/follow-up-continuity-memory` (216c5d7b).
- Nothing exists yet: no `packages/core/src/memory/`, no `packages/validators/src/memory.ts`, no `packages/db/src/schema/memory.ts`, no memory migration. `apps/web/app/(app)/w/[slug]/memory/page.tsx:3` is a placeholder (UI is #73, out of scope).
- Dependencies are in place: the automation engine exists (`packages/core/src/automation/`), and `memory_item` is a registered proposal kind at L2 (`packages/core/src/automation/matrix.ts:89`). Its handler is disabled: `packages/core/src/automation/handlers/disabled.ts:17`. The matter-graph domain exists (`packages/core/src/matter-graph/`). The issue text calls #33 and #47 closed "not_planned" or "invalid", but the code is on the base, so neither blocks.
- Erasure already assumes these tables. `packages/core/src/lifecycle/deletion/memory.ts` has `MEMORY_TABLES = ['memory_embedding','memory_item']` (deleted by `workspace_id`, skipped if missing), and the job `packages/core/src/jobs/definitions/memory-erase.ts` exists. The real tables must keep `workspace_id` and be deletable children-first.
- Fixture collision: `packages/core/src/lifecycle/__tests__/memory-erasure.test.ts:62-71` and `packages/db/src/__tests__/rls/vector.test.ts:47-57` run `create table memory_item` and `create table memory_embedding`. They will fail once the real migration creates those tables. Both must be changed to use the real tables or to drop the fixtures first.
- Field encryption exists: `packages/storage/src/field-crypto.ts` `encryptField(dek, workspaceId, plaintext)` and `decryptField` (AAD = workspace id), described there as being for "memory values". It is the "storage package crypto helper" fallback the issue names.
- Table conventions: `tenantTable()` from `packages/db/src/schema-helpers/tenant-table.ts` (FORCE RLS, `workspace_id`). Example: `packages/db/src/schema/whatsapp-link.ts`. The vector helper is `packages/db/src/vector.ts`. The clerk-view precedent is `packages/db/src/__tests__/rls/clerk-view.test.ts`, `packages/db/src/rls.ts` and migration `0022_matter_restriction.sql`.
- Migrations are in `packages/db/migrations/` (not `drizzle/`). The newest is `20261025040000_whatsapp_inbound.sql`, and recent ones are timestamp-named.
- `packages/core/src/automation/read-models.ts:155` already hides `memory_item` proposals from non-strategy viewers (clerks).
- Domain registry: a new `memory` folder under `packages/core/src` needs an `index.ts`, an entry in `CORE_DOMAIN_DEPENDENCIES` (`packages/config/eslint/core-domains.js`), and a row in `docs/engineering/core-domains.md`, all asserted by `packages/core/src/domains.test.ts`.

### Root Cause
Greenfield: the memory engine was never built. Automation, erasure and the UI were all written against its future tables.

### Affected Files
Listed as deliverables in `contract.json`:
- `packages/validators/src/memory.ts`
- `packages/db/src/schema/memory.ts`, `packages/db/src/schema/index.ts`, and a new migration
- `packages/core/src/memory/*`
- the memory handler in `packages/core/src/automation/handlers/`
- the job, the registries and the guard tests
- an ADR and the docs

### Sibling Sweep
- Other tenant tables follow the registry rules in CLAUDE.md: the root table list in `packages/db/src/index.test.ts`, the RLS catalog in `rls/sql.test.ts`, and the cross-tenant registry `packages/db/src/testing/cross-tenant-registry.ts`.
- Core exports need `SERVICE_TESTS` cases (`packages/core/src/__tests__/cross-tenant/services.test.ts`).
- The fixture-table collision (above) is the same pattern in two tests.

### History
`memory_item` was registered as a disabled L2 kind in #47. The erasure job (#303) and the `encryptField` helper (#216) anticipate this work. No prior attempt at #72.

### Recommendation
Implement in order:
1. Validators.
2. Schema and migration (RLS, clerk view, scope checks).
3. Core `memory` domain: scope, propose, confirm, read, review, embedding.
4. Enable the `memory_item` handler so accepting a proposal calls `confirmMemory`.
5. Add a memory-purge job for embeddings.
6. Register everything and add tests, an ADR and docs.

Confirm-before-save is the invariant: only `confirmMemory` and lawyer-authored notes insert `memory_item`. The embedding generator should use the mock provider in CI. Scope the cross-tenant, clerk and cross-matter tests at the SQL level. If `packages/ai` has no embedding entry point, call the existing AI gateway only through its public interface. Do not add one beyond the gateway.

### Related Issues
#1 (parent), #33, #47 (deps), #21, #73, #74, #81, #112.
