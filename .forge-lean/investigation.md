**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; foundation for #767/#768, no live defect)
**Task Type**: feature

### What Was Claimed
Part 1 of #75: add the drafting data layer (`template`, `draft`, `draft_version` tables with forced RLS, migration + snapshot, schema barrel) and zod validators (`TemplateSchema`, `BlockSchema`, `DraftSchema`, `FormatPresetSchema`, `ExportRequestSchema`), registered in the db test lists, RLS catalog, TABLE_TESTS and two-tenant seeders.

### What We Found
- Base `origin/milestone/drafting-citations-research` has no drafting schema or validators: no `packages/db/src/schema/drafting.ts`, no `packages/validators/src/drafting.ts`, and no `drafting`/`draft_version` match in `packages/db/src` or `packages/validators/src`.
- Last migration is `packages/db/migrations/20261025040000_whatsapp_inbound.sql` (journal idx 98, `meta/_journal.json` tail); next is idx 99.
- Pattern for nullable-workspace tables: `forum` in `packages/db/src/schema/court.ts:26` uses `globalOrWorkspaceTable` and `unique('forum_scope_code_uq').on(workspaceId, code).nullsNotDistinct()` (`court.ts:~50`). Tables must be listed in `GLOBAL_OR_WORKSPACE_TABLES` (`packages/db/src/conventions.ts:102`, currently forum/court_hall/bench). Policy helpers are `globalOrWorkspacePolicy`/`scopeGuardTrigger` in `packages/db/src/rls-policies.ts:91,106`, and the RLS test requires them in the creating migration (`sql.test.ts:336`).
- Immutability trigger precedent: `packages/db/migrations/0017_saas_invoices.sql:77-111` (function + trigger + REVOKE FROM PUBLIC + GRANT to `causedeck_app`).
- `matter` has a `(workspace_id, id)` unique key (`matter-graph.ts:43`), so a composite FK from `draft` is possible.
- Registries: table list `packages/db/src/index.test.ts:95,146`, RLS catalog `__tests__/rls/sql.test.ts:102-114`, `TABLE_TESTS` `testing/cross-tenant-registry.ts:63-76`, seeders `testing/two-tenants.ts:196,660`.
- Validators: subpath exports in `packages/validators/package.json:8-17`; the barrel `src/index.ts` exports some modules (not all). No name collision with the new names.
- Stale `.forge-lean/*` files in the tree belonged to a WhatsApp task and were removed.

### Root Cause
Missing feature: the drafting engine (#767) and service (#768) need persistent tables and validated block trees that do not exist yet.

### Affected Files
`packages/db/src/schema/drafting.ts` (new), `schema/index.ts`, `conventions.ts`, new migration + `meta/_journal.json` + snapshot, `packages/db/src/index.test.ts`, `__tests__/rls/sql.test.ts`, `testing/cross-tenant-registry.ts`, `testing/two-tenants.ts`, `packages/validators/src/drafting.ts` (+ test), `src/index.ts`, `package.json`.

### Sibling Sweep
Same pattern (global-or-workspace + tenant tables) is already registered for forum/court_hall/bench and saas_invoice; follow those. No other missing registrations are known.

### History
No prior drafting work on the lane. Parent #75 was closed not_planned and split into #766-#768.

### Recommendation
Implement per `contract.json`. Keep the closed block, resolver and preset lists in validators only (db stores jsonb, no db->validators dependency). Generate the migration with `db:generate`, then hand-add the policies, scope guard and immutability trigger.

### Related Issues
#75 (parent), #1, #767 (engine, consumes validators), #768 (service, consumes tables).
