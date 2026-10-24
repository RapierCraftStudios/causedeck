**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (P2 greenfield data model; blocks #662-#666 B2B portfolio work)
**Task Type**: feature

### What Was Claimed
Part 1 of #498: add tenant tables `portfolio`, `portfolio_case`, `portfolio_panel_advocate`, an institution workspace kind, a migration (next free number), FORCE RLS via `tenantTable()`, and the registry/test updates (`packages/db/src/index.test.ts`, RLS catalog in `rls/sql.test.ts`, TABLE_TESTS/registry, two-tenant seeders). Acceptance: RLS tests prove tenant B sees nothing of A.

### What We Found
- No portfolio code exists anywhere (`grep -ril portfolio packages apps` is empty). The earlier "Investigation Report" comment on #661 and the old `.forge-lean/*` files describe a different issue (coverage tracker) and are stale; ignore them.
- Workspace kind is `organization.kind` text with `organization_kind_chk` (`packages/db/src/schema/auth.ts:44,77,85`); `WORKSPACE_KINDS = ['solo','chamber']`. The check was created in `packages/db/migrations/0004_workspaces.sql:46`. Asserted by `packages/db/src/__tests__/auth-schema.test.ts:93`.
- UI/validators mirror kinds separately (`packages/validators/src/workspace.ts:31`, profile form, onboarding form); they are user-selectable lists, so the institution kind should NOT be added there (institutions are provisioned, not self-served).
- Tenant-table template: `packages/db/src/schema/webhooks.ts` (tenantTable, `(workspace_id,id)` unique, explicit workspace FK cascade) and `case_watch` (`schema/case-watch.ts:31-70`, composite FK to `proceeding` and `source`, CNR check using `CNR_PATTERN` from `proceedings.ts:38`).
- Migration template `migrations/20261024063416_webhooks.sql`; latest migration is `20261024100000_staff_watch_demand.sql` (journal idx 86, `when` 1792830000000), with snapshot `migrations/meta/20261024100000_snapshot.json`.
- Registration lists to update, each already listing webhook tables: `src/index.test.ts:155`, `src/__tests__/rls/sql.test.ts:162`, `src/testing/cross-tenant-registry.ts:137` (`DB_TABLES_TEST`), `src/testing/two-tenants.ts:326` (`TENANT_SEEDERS`, seeder example at `:964`), `src/schema/index.ts` exports.

### Root Cause
Greenfield: institutions (banks, NBFCs, ARCs) have no workspace kind and no tables to hold a tracked-case portfolio or delegate panel advocates.

### Affected Files
- `packages/db/src/schema/auth.ts` (add `'institution'` to `WORKSPACE_KINDS`)
- `packages/db/src/schema/portfolio.ts` (new), `packages/db/src/schema/index.ts`
- `packages/db/migrations/<next>_portfolio.sql`, `migrations/meta/_journal.json`, new snapshot
- `packages/db/src/index.test.ts`, `src/__tests__/rls/sql.test.ts`, `src/testing/cross-tenant-registry.ts`, `src/testing/two-tenants.ts`, `src/__tests__/auth-schema.test.ts`, new `src/__tests__/portfolio-schema.test.ts`

### Sibling Sweep
- Other `kind in (...)` checks: only `organization_kind_chk`. Plans use a separate `PLAN_KINDS` (`packages/validators/src/plans.ts:11`), untouched.
- `workspace_integration`, `webhook_*`, `case_watch` all follow the same register-in-four-places pattern; do the same.
- Core runtime exports: none added, so no `SERVICE_TESTS`/`NOT_A_SERVICE` change is needed unless schema constants get re-exported from core (they are not).

### History
Kind check introduced by #177 (0004_workspaces). Recent tenant-table additions: webhooks (#626), case_watch (#589). Siblings #662-#666 depend on these tables.

### Recommendation
Add `portfolio` (id, name, owner timestamps), `portfolio_case` (portfolio_id composite FK, optional proceeding_id composite FK to `proceeding`, `cnr` with CNR check, `case_number`, `source_id` FK to `source`, status text fields, `next_date`, `last_adverse_order_at`/id, unique per portfolio+cnr or case number, target check like `case_watch_target_chk`), and `portfolio_panel_advocate` (portfolio_id, advocate_user_id FK user, unique pair). All via `tenantTable()`. Write migration SQL generated shape plus RLS/policies matching webhooks migration; extend the organization check constraint in the migration (drop and re-add with `'institution'`). Register in all lists and add two-tenant seeders (portfolio, portfolio_case, portfolio_panel_advocate). Add a schema test and cover the RLS acceptance via the existing generic two-tenant RLS harness (TENANT_SEEDERS).

### Related Issues
#498 (parent), #662-#666 (siblings), #626, #589, #177.
