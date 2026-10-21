# Database

`packages/db` owns the Postgres 17 + pgvector schema (spike §1, §4): Drizzle ORM over the
`postgres` (postgres-js) driver, drizzle-kit migrations, the column conventions below, the
Testcontainers test harness and the seed registry. Every tenant table is under FORCE row-level
security (#19, `0006_rls_baseline`); see [tenancy.md](tenancy.md) for the policies, the scopes
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

| Import                               | What                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@causedeck/db`                      | `db`, `createDb`, `withWorkspace`, `withUser`, `tenantTable`, `tenantPolicy`, column helpers, `checkSchemaConventions`, `schema`, `EMBEDDING_DIMENSIONS`                                                                                                                                                         |
| `@causedeck/db/rls`                  | `withWorkspace(db, { workspaceId, userId? }, fn)` (throws `TENANCY_VIOLATION` when nested in another workspace), `withUser(db, { userId }, fn)` (pre-workspace flows) and `@internal withoutWorkspace` (global tables only, lint-restricted). Settings are `set_config(..., true)`; see [tenancy.md](tenancy.md) |
| `@causedeck/db/client`               | `db` (app role, connects on first use), `createDb({ url, role })`, `closeDb()`, `Database`, `Transaction`                                                                                                                                                                                                        |
| `@causedeck/db/columns`              | `id()`, `timestamps()`, `workspaceId()`, `workspaceIndex()`, `provenance()`, `provenanceCheck()` and the two enums                                                                                                                                                                                               |
| `@causedeck/db/schema`               | every migrated table and enum, including `job_effect` (job idempotency, see [jobs.md](jobs.md))                                                                                                                                                                                                                  |
| `@causedeck/db/vector`               | `EMBEDDING_DIMENSIONS` (1024 until an ADR picks the embedding model), `embedding()`                                                                                                                                                                                                                              |
| `@causedeck/db/testing`              | `withTestDb()`, `inWorkspace()` (tenant fixtures under RLS), `truncateAll()`, `testAppDb()`, `createScratchDatabase()`                                                                                                                                                                                           |
| `@causedeck/db/testing/global-setup` | Vitest `globalSetup` that starts the test container                                                                                                                                                                                                                                                              |
| `@causedeck/db/seed`                 | `registerSeed()`, `seed(db, { profile })`                                                                                                                                                                                                                                                                        |

The owner-role client (`src/owner.ts`) and the migrator (`src/migrate.ts`) are deliberately not
exported: application code never holds schema-owner credentials.

## Role model

Defined once in `infra/docker/postgres/init/02-roles.sql` and replayed verbatim by the test
harness, so local, CI and tests match.

| Role              | Env key              | Can                                                                                                                                                          |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `causedeck_owner` | `DATABASE_URL_OWNER` | Owns the database and schema `public`; runs migrations, drizzle-kit and Studio                                                                               |
| `causedeck_app`   | `DATABASE_URL`       | `SELECT/INSERT/UPDATE/DELETE` on tables the owner creates (default privileges). Not superuser, `NOBYPASSRLS`, cannot `CREATE`, `ALTER`, `DROP` or `TRUNCATE` |

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
    foreignKey({
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }),
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
  `confidence numeric(4,3)`, `confirmation_state` (enum `proposed | confirmed | auto_applied |
corrected`, default `proposed`; #344 renamed `edited`/`rejected`) and `captured_at timestamptz not
  null default now()`. Pair it with `provenanceCheck('<table>')`, which enforces
  `source_type = 'manual' or anchor_id is not null or source_ref is not null` and keeps
  `confidence` within 0..1. The matter-graph pg enums live in `packages/db/src/schema/enums.ts`
  ([ADR 0013](../adr/0013-matter-graph-schema.md)).
- **Vectors:** `embedding()` columns use `EMBEDDING_DIMENSIONS`; never hard-code a width.

`pnpm db:check` fails when a table with `workspace_id` has a nullable column, no index led by it,
or a tenant-to-tenant FK without `workspace_id`. The one exemption from the nullable rule is
`NULLABLE_WORKSPACE_TABLES` (`audit_event`, whose account-level events have no workspace); it is
still a tenant table under FORCE RLS and still needs the index.

## Matter and document tables

`packages/db/src/schema/matter-graph.ts` and `documents.ts`, migration `0038_matter_documents`
(#345, part 2 of #32, [ADR 0013](../adr/0013-matter-graph-schema.md)). Tenant tables under FORCE RLS
with composite `(workspace_id, <parent>_id)` FKs; `matter`, `document` and `anchor` carry the unique
`(workspace_id, id)` those FKs target.

| Table           | Columns and constraints                                                                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matter`        | `title`, `practice_area`, `status` (CHECK `active`, `disposed`, `archived`), `sensitive boolean not null default false` (CA-10), `owner_member_id` (-> `member`, same workspace), `opened_at`, `synopsis`, `merged_into_matter_id` (-> `matter`, not itself)                                                       |
| `document`      | `kind` (`document_kind`), `language`, `supersedes_document_id` (version chain, not itself), `storage_key`, `sha256` (64 lower-case hex), `text_status` (`document_text_status`, default `pending`), `source_capture_id` (no FK until #43), `matter_id` (index `(workspace_id, matter_id)`)                           |
| `document_page` | `document_id` (ON DELETE CASCADE), `page_no` (>= 1, unique per document), `text`, `text_source`, `ocr_confidence numeric(4,3)` (0..1), `lang`                                                                                                                                                                       |
| `anchor`        | `document_id` (ON DELETE CASCADE), `page_no` (>= 1), `quote` (CHECK at most 2,000 characters), `char_start`, `char_end` (`char_end >= char_start`), `bbox jsonb`, `kind` (CHECK `document`, `transcript`, `list_row`, `calendar_event`, `email`, `image_region`), `transcript_span jsonb`                            |

`owner_member_id`, `merged_into_matter_id` and `supersedes_document_id` are `ON DELETE SET NULL
(<column>)` (Postgres 15+), hand-written in the migration: a plain composite `SET NULL` would also
null `workspace_id`. So a matter outlives its owner's account deletion, and the batched erase can
delete a version or merge chain in any order. `document.matter_id` is `NO ACTION`: a matter with
documents is not deleted on its own. `matter_restriction.matter_id` references `matter` (ON DELETE
CASCADE) since 0038, which deleted the restriction rows written before matters existed.

## Audit tables

`packages/db/src/schema/audit.ts`, migration `0008_audit` (#226, #26 part 1). Both tables are
append-only and have no foreign keys: audit rows outlive the users and workspaces they name until
retention removes them.

| Table         | Columns                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_event` | `id` (uuid v7), `workspace_id` (null for account-level events), `actor_user_id` (null once anonymised), `actor_ref` (salted hash of the actor, 0031), `actor_kind` (`user`, `staff`, `system`, `api`), `action`, `target_kind`, `target_id`, `outcome` (`success`, `denied`, `error`), `ip inet`, `user_agent_hash`, `request_id`, `metadata jsonb` (ids only, never content), `prev_hash bytea`, `hash bytea`, `created_at`             |
| `ai_call`     | `id` (uuid v7), `workspace_id`, `user_id`, `purpose`, `provider`, `model`, `model_version`, `region`, `input_tokens`, `output_tokens`, `cost_paise`, `sources jsonb` (ids and anchors only), `confidence numeric(4,3)`, `automation_level smallint` (CHECK `between 1 and 4`: no L5 record can be stored), `auto_applied`, `user_action`, `undone_at`, `created_at` |

- **Ids:** `app_uuid_v7()` (Postgres 17 has no `uuidv7()`): a millisecond timestamp followed by
  random bits, so ids sort by creation time.
- **Append-only:** the app role has `SELECT` and `INSERT` only (`UPDATE`, `DELETE` and `TRUNCATE`
  are revoked; the default privileges would otherwise grant the first two). The trigger function
  `app_audit_immutable()` rejects `UPDATE`, `DELETE` and `TRUNCATE` with `42501` for every role, the
  owner included, unless the transaction-local setting `app.audit_retention` is `on`.
- **Retention path:** `app_purge_audit(cutoff)` and `app_purge_ai_calls(cutoff)` (SECURITY DEFINER,
  executable by the app role) refuse a cutoff later than `now() - 180 days` (CERT-In), set
  `app.audit_retention` for the duration of their `DELETE`, reset it and return the row count. The
  scheduled job that calls them is `system.audit.retention`. After a purge the oldest surviving event points at a
  `prev_hash` that no longer exists; chain verification starts from the oldest surviving row. `system.audit.verify` reads every chain
  through `app_audit_chain_targets()` and `app_audit_verify_account_chain()` (`0019_audit_jobs`).
- **Writing `audit_event`:** only through `app_audit_append(workspace_id, actor_user_id,
actor_kind, action, target_kind?, target_id?, outcome?, ip?, user_agent_hash?, request_id?,
metadata?)`, which returns `(id, hash)`. A non-null workspace must be the pinned workspace
  (`42501` otherwise); null appends to the account chain. Under
  `pg_advisory_xact_lock(hashtextextended('audit_event:' || coalesce(workspace_id::text, 'account'), 0))`
  it reads the chain's latest `hash` as `prev_hash`, sets `created_at = clock_timestamp()` and stores
  `hash = sha256(coalesce(prev_hash, '') || convert_to(app_audit_canonical(event)::text, 'UTF8'))`.
  `app_audit_canonical(audit_event)` is the jsonb (sorted keys) of every column except `prev_hash`
  and `hash`, with `ip` as `host(ip)` and `created_at` as UTC ISO-8601 with microseconds. The unique
  constraint `(workspace_id, prev_hash) NULLS NOT DISTINCT` makes a fork unstorable. Call it in a
  READ COMMITTED transaction (the default): a REPEATABLE READ snapshot would miss a concurrent
  append and fail on that constraint. The TypeScript `record()` writer and `verifyChain` are #227.
- **Actor reference and anonymisation (0031, #303):**
  - Since 0031, `app_audit_append` also stores `actor_ref`, the salted sha256 of `actor_user_id`.
    The salt is per user, in the owner-only global `audit_actor_salt`.
  - For rows with `actor_ref`, `app_audit_canonical` hashes it in place of `actor_user_id`.
  - `app_audit_anonymise_actor(user)` nulls a deleted user's `actor_user_id` everywhere and drops
    their salt. It is the only `UPDATE` the immutability trigger lets through, and only while
    `app.audit_anonymise` is `on`.
  - 0031 re-chained the existing rows once, after verifying every chain.
  - See [audit.md](audit.md#chain-format).
- **Writing `ai_call` (AI gateway contract, #44):** insert one row per model call inside the
  workspace transaction, with `purpose`, `provider`, `model`, `model_version`, `region` (the
  provider region, India for India-only workspaces), token counts, `cost_paise`, `sources` as
  `[{ id, anchor }]` (never text), `confidence` (0-1), `automation_level` (1-4) and `auto_applied`.
  Rows cannot be updated, so the user's later decision (`user_action`, `undone_at`) is recorded by a
  new row or by an owner-defined function added with that feature, not by `UPDATE`. The typed
  writer is #227.

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
- `truncateAll()` empties every `public` table except `schema_info` (as the owner, with
  `app.audit_retention` set so the append-only audit tables can be emptied), for suites that must
  commit.
- `createScratchDatabase(urls, name)` clones a fresh, unmigrated database with the same roles and
  extensions (used by the migration tests).

Other packages reuse the harness by adding
`globalSetup: ['@causedeck/db/testing/global-setup']` to their Vitest config.

## Seeds

See [packages/db/src/seed/README.md](../../packages/db/src/seed/README.md). Seed data is
synthetic and uses fictional parties only.
