# Database

`packages/db` owns the Postgres 17 + pgvector schema (spike §1, §4): Drizzle ORM over the
`postgres` (postgres-js) driver, drizzle-kit migrations, the column conventions below, the
Testcontainers test harness and the seed registry. Every tenant table is under FORCE row-level
security (#19, `0005_rls_baseline`); see [tenancy.md](tenancy.md) for the policies, the scopes
(`withWorkspace`, `withUser`, `withoutWorkspace`) and how to add a tenant table.

```sh
pnpm stack:up      # local Postgres from infra/docker (#5)
pnpm db:migrate    # apply pending migrations as the owner role
pnpm db:generate   # schema diff -> new SQL migration in packages/db/migrations
pnpm db:check      # conventions + migration lint + drizzle-kit snapshot check (also runs in CI)
pnpm db:studio     # Drizzle Studio against DATABASE_URL_OWNER
pnpm db:seed       # registered seeders, profile demo (`-- --profile test` for test)
pnpm db:check-rls  # live catalog: RLS on every tenant table, no cross-workspace FKs (tenancy.md)
```

## Entry points

| Import | What |
|---|---|
| `@causedeck/db` | `db`, `createDb`, `withWorkspace`, `withUser`, `tenantTable`, `tenantPolicy`, column helpers, `checkSchemaConventions`, `schema`, `EMBEDDING_DIMENSIONS` |
| `@causedeck/db/rls` | `withWorkspace(db, { workspaceId, userId? }, fn)` (throws `TENANCY_VIOLATION` when nested in another workspace), `withUser(db, { userId }, fn)` (pre-workspace flows) and `@internal withoutWorkspace` (global tables only, lint-restricted). Settings are `set_config(..., true)`; see [tenancy.md](tenancy.md) |
| `@causedeck/db/client` | `db` (app role, connects on first use), `createDb({ url, role })`, `closeDb()`, `Database`, `Transaction` |
| `@causedeck/db/columns` | `id()`, `timestamps()`, `workspaceId()`, `workspaceIndex()`, `provenance()`, `provenanceCheck()` and the two enums |
| `@causedeck/db/schema` | every migrated table and enum, including `job_effect` (job idempotency, see [jobs.md](jobs.md)) |
| `@causedeck/db/vector` | `EMBEDDING_DIMENSIONS` (1024 until an ADR picks the embedding model), `embedding()` |
| `@causedeck/db/testing` | `withTestDb()`, `inWorkspace()` (tenant fixtures under RLS), `truncateAll()`, `testAppDb()`, `createScratchDatabase()` |
| `@causedeck/db/testing/global-setup` | Vitest `globalSetup` that starts the test container |
| `@causedeck/db/seed` | `registerSeed()`, `seed(db, { profile })` |

The owner-role client (`src/owner.ts`) and the migrator (`src/migrate.ts`) are deliberately not
exported: application code never holds schema-owner credentials.

## Role model

Defined once in `infra/docker/postgres/init/02-roles.sql` and replayed verbatim by the test
harness, so local, CI and tests match.

| Role | Env key | Can |
|---|---|---|
| `causedeck_owner` | `DATABASE_URL_OWNER` | Owns the database and schema `public`; runs migrations, drizzle-kit and Studio |
| `causedeck_app` | `DATABASE_URL` | `SELECT/INSERT/UPDATE/DELETE` on tables the owner creates (default privileges). Not superuser, `NOBYPASSRLS`, cannot `CREATE`, `ALTER`, `DROP` or `TRUNCATE` |

Both URLs are `Secret`s from `@causedeck/config/env`. Outside production they default to the #5
stack's roles (`causedeck_app` / `causedeck_owner` on `localhost:5432`), never the superuser.
Connection errors raised by `createDb` and `runMigrations` are rebuilt as
`DatabaseConnectionError` with the URL and password removed; never log `url.reveal()`.

`createDb` uses `prepare: false` (safe behind transaction poolers), `max` 10 for the app and 1
for the owner, and a 20 s `idle_timeout`.

## Conventions

- **Naming:** snake_case identifiers in SQL, camelCase in TypeScript (`casing: 'snake_case'`).
  Tables are singular (`workspace`, `matter`, `hearing`), as listed in spike §4.2.
- **Keys:** `id: id()` is `uuid primary key default gen_random_uuid()`.
- **Timestamps:** `...timestamps()` gives `created_at` and `updated_at` (timestamptz, not null).
- **Tenancy:** every tenant table has `workspaceId: workspaceId()` (`uuid not null`) and
  `workspaceIndex('<table>', t.workspaceId, ...)` in its extra config, so an index starts with
  `workspace_id`. The FK to `workspace.id` is added once the `workspace` table exists.
- **No cross-workspace FKs:** a reference from one tenant table to another is composite and
  includes `workspace_id` on both sides, against a `unique (workspace_id, id)` on the target:

  ```ts
  (t) => [
    workspaceIndex('hearing', t.workspaceId),
    foreignKey({ columns: [t.workspaceId, t.matterId], foreignColumns: [matter.workspaceId, matter.id] }),
  ];
  ```

- **Global tables** (not workspace-scoped: the Better Auth tables `user`, `session`, `account`,
  `verification`, `passkey`, `two_factor` and `rate_limit`, later the court layer) are listed in
  `GLOBAL_TABLES` in `packages/db/src/conventions.ts` and are exempt from both checks.
  `organization` (the workspace, exported as `workspace`) is the tenant root; `member` and
  `invitation` are tenant tables whose organization FK column is `workspace_id`. Global tables have
  no row-level security; every other table with `workspace_id` does ([tenancy.md](tenancy.md)).
  New tenant tables use `tenantTable()` and get `tenantPolicy()` in the migration that creates them.
- **Provenance on every fact:** `...provenance()` adds `source_type` (enum `manual | document |
  capture | adapter | ai | import | system`, not null), `source_ref text`, `anchor_id uuid`,
  `confidence numeric(4,3)` and `confirmation_state` (enum `proposed | confirmed | edited |
  rejected`, default `proposed`). Pair it with `provenanceCheck('<table>')`, which enforces
  `source_type = 'manual' or anchor_id is not null or source_ref is not null`.
- **Vectors:** `embedding()` columns use `EMBEDDING_DIMENSIONS`; never hard-code a width.

`pnpm db:check` fails when a table with `workspace_id` has a nullable column, no index led by it,
or a tenant-to-tenant FK without `workspace_id`.

## Writing a migration (reviewed SQL)

1. Change or add tables under `packages/db/src/schema/` and export them from `schema/index.ts`.
2. `pnpm db:generate`. drizzle-kit writes `migrations/NNNN_<name>.sql` plus its snapshot, and the
   script stamps a header ending in `-- Reviewed-by: <unreviewed>`.
3. Read the SQL. Check locks, defaults on large tables, index creation and backward
   compatibility (below). Edit it if needed (for example `CREATE INDEX CONCURRENTLY` in its own
   migration, or a backfill), then replace `<unreviewed>` with your name.
4. `pnpm db:check`. The lint rejects a migration without a completed review header, and any
   `DROP TABLE` or `DROP COLUMN` that is not annotated `-- contract:approved` (on the statement or
   the line above it, with the reason).
5. `pnpm db:migrate` against the local stack, then run the package tests.
6. Commit the `.sql`, `meta/_journal.json` and the snapshot together. Never edit a migration that
   has been merged; write a new one.

`pnpm db:migrate` is idempotent. It takes a Postgres advisory lock (`MIGRATION_LOCK_KEY` in
`src/migrate.ts`), so concurrent deploys or replicas serialise and each migration is applied
exactly once. It logs the tags it applied and the latest tag, never the URL.

## Expand / contract checklist

Every migration must work with the previous app release still running (spike §3.2).

- [ ] **Expand:** add new tables, nullable columns or columns with defaults, and new indexes. The
      old release ignores them.
- [ ] Deploy app code that writes both old and new shapes and reads the new one.
- [ ] **Migrate:** backfill in batches (a separate migration or job), then add `NOT NULL` or
      constraints with `NOT VALID` followed by `VALIDATE CONSTRAINT`.
- [ ] Deploy app code that no longer touches the old shape.
- [ ] **Contract:** in a later release, drop the old column or table with `-- contract:approved`
      and a note naming the release that stopped using it.
- [ ] Never rename a column or table in one step: add, copy, switch, then drop.

## Tests

`packages/db/vitest.config.ts` uses `globalSetup` to start one `pgvector/pgvector:0.8.7-pg17`
container per `vitest run`. It runs the #5 init SQL (extensions and roles) and applies the
migrations as the owner. Docker must be running; CI's `ubuntu-latest` has it.

```ts
import { withTestDb } from '@causedeck/db/testing';

it('stores a hearing', async () => {
  await withTestDb(async (tx) => {
    await tx.insert(hearing).values({ ... });
    expect(await tx.select().from(hearing)).toHaveLength(1);
  }); // always rolled back
});
```

- `withTestDb(fn)` runs `fn` as the app role inside a transaction that is always rolled back, so
  test files run in parallel without seeing each other's writes. Wrap expected failures in
  `tx.transaction()` (a savepoint) so the outer transaction stays usable.
- `truncateAll()` empties every `public` table except `schema_info` (as the owner), for suites that
  must commit.
- `createScratchDatabase(urls, name)` clones a fresh, unmigrated database with the same roles and
  extensions (used by the migration tests).

Other packages reuse the harness by adding
`globalSetup: ['@causedeck/db/testing/global-setup']` to their Vitest config.

## Seeds

See [packages/db/src/seed/README.md](../../packages/db/src/seed/README.md). Seed data is
synthetic and uses fictional parties only.
