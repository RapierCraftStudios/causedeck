# Tenancy and row-level security

Every workspace's data lives in shared tables. Postgres row-level security (RLS) keeps the
workspaces apart (#19, spike §4.1, architecture §6.3): a query sees and writes only the rows of the
workspace pinned on its transaction, whatever its `WHERE` clause says. Application filters remain,
but they are no longer the only line of defence.

The pieces:

| Piece                                                                    | Where                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Policies, GUC helpers, SECURITY DEFINER lookups                          | `packages/db/migrations/0006_rls_baseline.sql`                                                     |
| Scopes: `withWorkspace`, `withUser`, `withoutWorkspace`                  | `packages/db/src/rls.ts` (`@causedeck/db`)                                                         |
| `tenantPolicy(table)` and the tenant-table registry                      | `packages/db/src/rls-policies.ts`                                                                  |
| `tenantTable(name, cols, extras)`                                        | `packages/db/src/schema-helpers/tenant-table.ts`                                                   |
| `pnpm db:check-rls`                                                      | `packages/db/scripts/check-rls.ts` over `packages/db/src/check-rls.ts`                             |
| Policy tests                                                             | `packages/db/src/__tests__/rls/{sql,no-guc,with-check,pooling,owner,vector}.test.ts`               |
| Two-tenant fixture (`seedTwoTenants`, `TENANT_SEEDERS`)                  | `packages/db/src/testing/two-tenants.ts` (`@causedeck/db/testing/two-tenants`)                     |
| Cross-tenant registry                                                    | `packages/db/src/testing/cross-tenant-registry.ts` (`@causedeck/db/testing/cross-tenant-registry`) |
| Cross-tenant suite, `pnpm test:tenancy`, CI job `tenancy`                | see [Cross-tenant suite](#cross-tenant-suite)                                                      |
| Lint: `withoutWorkspace` only in `packages/db`, `apps/admin`, migrations | `packages/config/eslint/base.js`                                                                   |

## The role model

| Role              | Used by                                                             | Can                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `causedeck_owner` | migrations (`DATABASE_URL_OWNER`), `db:check-rls`, the test harness | Owns every table and function. Runs DDL. Has no `BYPASSRLS`, so FORCE RLS binds it too; it reads across tenants only through the narrow `owner_definer_*` policies that back the SECURITY DEFINER functions                             |
| `causedeck_app`   | every app and the worker (`DATABASE_URL`)                           | DML on `public` tables and `EXECUTE` on the `app_*` functions. Not the owner, `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`: it cannot `ALTER` a table, disable or un-force RLS, drop a policy or `SET ROLE` to the owner (`owner.test.ts`) |

`0006_rls_baseline` also revokes the `PUBLIC` defaults: no table privileges for `PUBLIC`, and
functions the owner creates are not executable by `PUBLIC` (each `app_*` function is granted to
`causedeck_app` explicitly).

## Why FORCE

`ENABLE ROW LEVEL SECURITY` alone exempts the table owner. With `FORCE`, the policies apply to every
role without `BYPASSRLS`, the owner included. A leaked owner session, a migration that touches data,
or a future change that connects an app as the owner still sees only the pinned workspace. The cost
is that data migrations and seeds write tenant rows inside a workspace scope too.

## GUC semantics

Two transaction-local settings drive the policies:

| Setting            | Set by                                             | Read through                                                                                  |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `app.workspace_id` | `withWorkspace`                                    | `nullif(current_setting('app.workspace_id', true), '')::uuid`, also `app_current_workspace()` |
| `app.user_id`      | `withWorkspace` (optional `userId`) and `withUser` | `app_current_user()`                                                                          |

- The helpers use `set_config(name, value, true)`, the function form of `SET LOCAL`. The value ends
  with the transaction, so a pooled connection that is reused afterwards carries no workspace and
  sees no tenant rows (`pooling.test.ts`, with `max: 1`).
- With no workspace pinned, tenant tables return zero rows and reject every write (`no-guc.test.ts`).
- Ids are validated as uuids before any SQL runs. An empty or invalid id is a `TypeError`.
- A scope opened on an existing transaction is a SAVEPOINT. A setting made inside a released
  savepoint would otherwise last until the outer `COMMIT`, so the helper restores the outer values
  when the inner scope ends. Two sequential scopes on one outer transaction never leak into each
  other.
- The active scope is also tracked per async call chain (`AsyncLocalStorage`). Inside a workspace
  scope, `withWorkspace` with a different workspace, `withUser` or `withoutWorkspace` throws
  `TenancyError` (`code: 'TENANCY_VIOLATION'`), even on another connection. The same workspace nests
  freely.

## Scopes

| Scope                                             | Use for                                                                                                                                                        | Sees                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `withWorkspace(db, { workspaceId, userId? }, fn)` | everything inside a workspace: page loads, `workspaceAction` handlers (`ctx.tx`), the API's `c.var.withWorkspace`, workspace jobs                              | that workspace's rows only                                                                                                |
| `withUser(db, { userId }, fn)`                    | pre-workspace flows: the switcher, `/v1/me`, `/v1/workspaces`, membership checks (`listMemberships`, `listWorkspacesForUser`, `memberRole` open it themselves) | the user's own `member` rows (`member_self`) and the `organization` rows they belong to                                   |
| `@internal withoutWorkspace(db, { tables }, fn)`  | admin and maintenance code on global tables                                                                                                                    | global tables only. It throws unless every table named is in `GLOBAL_TABLES`, and tenant tables stay invisible regardless |

Cross-tenant work that must touch tenant tables (slug uniqueness, invitation lookup by token, the
retention purge) never widens the app's scope. It calls an owner-defined SECURITY DEFINER function
that returns only what the caller needs: slugs, ids, booleans or a count. The function is pinned to
`search_path = public, pg_temp` and executable only by `causedeck_app`.

| Function                                                                                                                                                               | Caller                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `app_slug_taken(text[])`                                                                                                                                               | `generateUniqueSlug`                                                            |
| `app_slug_available(text, uuid)`, `app_release_expired_slugs(text[])`                                                                                                  | `renameSlug`                                                                    |
| `app_resolve_slug(text)` returns `(workspace_id, redirected)`                                                                                                          | `resolveSlug`, which then reads the row inside `withWorkspace`                  |
| `app_invitation_workspace(text)` (token hash in, workspace id out)                                                                                                     | `acceptInvitation`, `previewInvitation`, which then work inside `withWorkspace` |
| `app_purge_job_effects(timestamptz)`                                                                                                                                   | `system.retention.sweep`                                                        |
| `app_billing_reconcile_targets()` returns `(workspace_id, subscription_id)`                                                                                            | `system.billing.reconcile`, which then reads each row inside `withWorkspace`    |
| `app_audit_append(...)` returns `(id, hash)`: appends to the pinned workspace's chain (any other workspace id is `42501`) or, with a null workspace, the account chain | the audit writer `record()` (#227)                                              |
| `app_workspace_keys_for_rewrap(text)` (workspace ids whose live key is under another KEK) | `rewrapAll` / `pendingRewrap` in `@causedeck/storage`, which re-wrap each key inside `withWorkspace` ([storage.md](storage.md)) |
| `app_purge_audit(timestamptz)`, `app_purge_ai_calls(timestamptz)` (cutoff at least 180 days old)                                                                       | the audit retention job (#230)                                                  |

`createWorkspace` needs no bypass: it picks the new workspace's id itself and writes the
organization, owner membership and settings inside `withWorkspace(newId)`.

## Bootstrap policies

| Table                                                                                                                                                                               | Policies                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `member`, `invitation`, `workspace_settings`, `workspace_slug_history`, `job_effect`, and the billing tables `subscription`, `entitlement`, `usage_counter`, `billing_event` (#200), and `workspace_key` (#216, `0009_storage`) | `ws_isolation` FOR ALL, USING and WITH CHECK `workspace_id = app.workspace_id`                                                                                                                                                                                                                |
| `member`                                                                                                                                                                            | `member_self` FOR SELECT: `user_id = app.user_id`, only while no workspace is pinned (so a user scope never widens a workspace scope)                                                                                                                                                         |
| `organization` (the tenant root, no `workspace_id`)                                                                                                                                 | `ws_isolation` FOR ALL on `id = app.workspace_id`; `member_read` FOR SELECT while no workspace is pinned, for workspaces the user is a member of                                                                                                                                              |
| owner-only                                                                                                                                                                          | `owner_definer_read` (SELECT) on `organization`, `invitation`, `workspace_slug_history`, `job_effect`, `subscription` (`0007_billing_reconcile`), `workspace_key` (`0009_storage`); `owner_definer_release` (DELETE expired redirects) on `workspace_slug_history`; `owner_definer_purge` (DELETE) on `job_effect`              |
| `audit_event`, `ai_call` (#226, `0008_audit`)                                                                                                                                       | `ws_isolation` as above. Append-only: the app role has SELECT and INSERT only, and a trigger rejects UPDATE, DELETE and TRUNCATE outside the retention functions ([database.md](database.md#audit-tables))                                                                                    |
| `audit_event`                                                                                                                                                                       | `account_self` FOR SELECT: account-level events (`workspace_id` null) whose `actor_user_id = app.user_id`, only while no workspace is pinned; `owner_definer_read` (SELECT), `owner_definer_append` (INSERT) and `owner_definer_purge` (DELETE) back `app_audit_append` and `app_purge_audit` |
| `ai_call`                                                                                                                                                                           | `owner_definer_read` (SELECT) and `owner_definer_purge` (DELETE) back `app_purge_ai_calls`                                                                                                                                                                                                    |

WITH CHECK rejects an `INSERT` or `UPDATE` that writes another workspace's id, so a row cannot be
moved between workspaces (`with-check.test.ts`). Foreign-key checks and `ON DELETE CASCADE` run
outside RLS, so deleting a workspace still cascades to its rows.

## What is global

`GLOBAL_TABLES` in `packages/db/src/conventions.ts` lists the tables without RLS: `schema_info`,
Better Auth's identity tables (`user`, `session`, `account`, `verification`, `passkey`,
`two_factor`, `rate_limit`), the billing `plan` catalogue and `api_idempotency_key`. The last has a nullable `workspace_id` but is
keyed by user, so it stays global. `audit_event` also has a nullable `workspace_id`, but it is a tenant table: account-level events
(null workspace) are invisible to every workspace scope and are listed in
`NULLABLE_WORKSPACE_TABLES` (`packages/db/src/conventions.ts`) only to exempt them from the
NOT NULL convention. The court layer will join this list. Adding a table here is a
security decision: say why in the PR.

## Adding a tenant table

1. Declare it with `tenantTable()`. It adds the NOT NULL `workspace_id`, an index leading with it,
   and registers the table as tenant:

   ```ts
   export const matter = tenantTable(
     'matter',
     { id: id(), title: text('title').notNull() },
     (t) => [unique('matter_ws_id_uq').on(t.workspaceId, t.id)],
   );
   ```

2. `pnpm db:generate`, then append the `tenantPolicy('matter')` statements (ENABLE, FORCE,
   `ws_isolation`) to the same migration, each followed by `--> statement-breakpoint`. Never put them
   in a later migration: a tenant table must not exist for even one deploy without its policies.
3. Foreign keys to another tenant table are composite and pair `workspace_id` with `workspace_id`.
4. `pnpm db:check` (Drizzle conventions) and `pnpm db:check-rls` (the live catalog and the
   migrations) must pass. `db:check-rls` fails when a tenant table lacks ENABLE, FORCE or
   `ws_isolation`, when an FK can cross workspaces, or when a migration after `0006_rls_baseline`
   creates a tenant table without its `tenantPolicy()` statements.
5. Write tenant rows in tests through `inWorkspace(tx, workspaceId, fn)` from
   `@causedeck/db/testing`. An owner connection does not help: FORCE RLS binds the owner too.

## Incidents

A suspected cross-tenant read or write is a personal-data breach under the DPDP Act. Follow the
[DPDP breach runbook](https://github.com/RapierCraftStudios/causedeck/issues/103) (to be written
at `docs/runbooks/`, #103). It covers containment, the CERT-In 6-hour report and notifying the
affected workspaces. Preserve the request and job logs (they carry `workspaceId` and never matter
content) before any fix is deployed.

## Cross-tenant suite

`pnpm test:tenancy` (#209) proves that workspace B cannot reach workspace A through any layer. It
runs in the required CI job `tenancy`, together with `pnpm db:check-rls` on a freshly migrated
database, on every pull request and always in full. **Any failure of this suite is a release
blocker**: treat it as a suspected cross-tenant leak (see Incidents), never skip or quarantine it.

| Layer                                                                       | Test                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SQL, every tenant table: A cannot select, update, delete or insert B's rows | `packages/db/src/__tests__/cross-tenant/tables.test.ts`                                                                            |
| pgvector similarity search on a `memory_embedding`-shaped table             | `packages/db/src/__tests__/rls/vector.test.ts`                                                                                     |
| Every exported `@causedeck/core` service, `ub` against A's ids              | `packages/core/src/__tests__/cross-tenant/services.test.ts`                                                                        |
| A user in both workspaces (`uboth`): one workspace per transaction          | `packages/core/src/__tests__/cross-tenant/two-workspace-user.test.ts`                                                              |
| REST routes (`/v1`), including `requireWorkspace`                           | `apps/api/src/__tests__/cross-tenant.test.ts`                                                                                      |
| Server actions and the workspace loader                                     | `apps/web/__tests__/cross-tenant-actions.test.ts` (run by `apps/web/vitest.tenancy.config.ts`; the default web config excludes it) |
| Storage presign                                                             | `packages/storage/src/__tests__/cross-tenant-presign.test.ts` (placeholder until #21)                                              |

`seedTwoTenants(db)` creates workspaces A and B, `ua` (owner of A), `ub` (owner of B) and `uboth`
(an advocate in both), and one row per tenant table in each, written through `TENANT_SEEDERS`
inside the workspace's own scope. It works inside `withTestDb` and on committed data.

For the append-only tables in `APPEND_ONLY_TABLES` (`audit_event`, `ai_call`) the app role has no
UPDATE or DELETE, so the suite expects `42501` from those statements instead of zero rows. The
`audit_event` seeder writes through `app_audit_append`, so the insert-for-B check also proves the
chain function refuses another workspace's id.

The registry (`cross-tenant-registry.ts`) is enforced by two tests, so an addition without a
cross-tenant test fails `pnpm test:tenancy`:

- `packages/db/src/__tests__/cross-tenant/registry.test.ts` introspects the live catalog (tables
  with `workspace_id` outside `GLOBAL_TABLES`) plus `registeredTenantTables()`. Each one needs a
  `TABLE_TESTS` entry and a `TENANT_SEEDERS` entry.
- `packages/core/src/__tests__/cross-tenant/registry.test.ts` lists the runtime exports of
  `@causedeck/core`. Each one is either in `SERVICE_TESTS` with its kind (`denies`, `rls-empty`,
  `self-scoped`, `caller-checked`) or in `NOT_A_SERVICE` with a reason. `services.test.ts` has one case per
  `SERVICE_TESTS` entry that points at it. The same test fails once `@causedeck/storage` exports
  presign (#21) while the presign test is still the placeholder.

Adding a tenant table: add a seeder to `TENANT_SEEDERS` and a `TABLE_TESTS` entry; the table test
then covers it. Adding a core service: add a `SERVICE_TESTS` entry and its case in
`services.test.ts`, which must show that B gets `NOT_FOUND` / `FORBIDDEN` or nothing of A's.
