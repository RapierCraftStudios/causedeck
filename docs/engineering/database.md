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
pnpm db:seed:demo  # the fictional `demo` workspace (#182), as the owner role; refuses in production
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

## Proceeding tables

`proceeding` and `proceeding_link` in `packages/db/src/schema/proceedings.ts`, migration
`0039_proceedings` (#346, part 3 of #32, [ADR 0013](../adr/0013-matter-graph-schema.md)). Tenant
tables under FORCE RLS with `provenance()` and `provenanceCheck()`; tested in
`packages/db/src/__tests__/proceeding-schema.test.ts`.

| Table             | Columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proceeding`      | `matter_id` (-> `matter`, same workspace, NO ACTION; index `(workspace_id, matter_id)`), `forum_id` (-> `forum`, a catalogue or own forum: `same_or_global` scope guard), `kind` (`proceeding_kind`), `case_type_code` (CHECK upper-case, no dots or spaces), `case_type_raw`, `number` (text), `year`, `sr_no`, `fr_no`, `diary_no`, `filing_no`, `cnr` (CHECK `^[A-Z0-9]{16}$`), `filing_date`, `state` (`proceeding_state`, default `filed`; CHECK `number` and `year` set when `numbered` or `disposed`), `state_changed_at`, `parent_proceeding_id` (-> `proceeding`, not itself), `title_petitioner`, `title_respondent` |
| `proceeding_link` | `from_proceeding_id`, `to_proceeding_id` (-> `proceeding`, ON DELETE CASCADE; CHECK not equal), `kind` (CHECK `parent_of`, `connected`, `appeal_from`, `lower_court`), unique `(workspace_id, from_proceeding_id, to_proceeding_id, kind)`                                                                                                                                                                                                                                                                                                         |

Case identity: unique `(workspace_id, forum_id, case_type_code, number, year) WHERE number IS NOT
NULL` and `(workspace_id, cnr) WHERE cnr IS NOT NULL`. The provenance `anchor_id` is a composite
NO ACTION FK to `anchor` on both tables. `parent_proceeding_id` is `ON DELETE SET NULL
(parent_proceeding_id)`. The `proceeding_link_parent_of_cycle_guard` trigger
(`app_proceeding_link_cycle_guard()`) rejects, with 23514, an insert or update of a `parent_of` link
that would close a cycle; it serializes per workspace with a transaction advisory lock.

`proceeding_state_change` (same file, migration `0043_proceeding_state_change`, #363,
[ADR 0016](../adr/0016-proceeding-state-machine-and-next-date-rules.md)) is the append-only
history of proceeding state transitions, written only by the matter-graph state machine
(`transitionProceeding`). It is a tenant table under FORCE RLS with `provenance()` and
`provenanceCheck()`. Columns: `proceeding_id` (-> `proceeding`, ON DELETE CASCADE), `from_state`
and `to_state` (`proceeding_state`; CHECK not equal), `reason` (CHECK not blank; required by CHECK
when `disposed` -> `numbered`), `actor_member_id` (-> `member`, `ON DELETE SET NULL
(actor_member_id)`), `cure_deadline` (date; CHECK only when `to_state = 'defects'`), `changed_at`.
Index `(workspace_id, proceeding_id, changed_at)`.

## People tables

`person`, `organisation` and `role_edge` in `packages/db/src/schema/people.ts`, migration
`0040_people` (#348, part 5 of #32, [ADR 0013](../adr/0013-matter-graph-schema.md)). Tenant tables
under FORCE RLS; `person` and `role_edge` carry `provenance()` and `provenanceCheck()`, with the
provenance `anchor_id` a composite NO ACTION FK to `anchor`. Tested in
`packages/db/src/__tests__/people-schema.test.ts`.

| Table          | Columns and constraints                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `person`       | `name` (CHECK not blank), `aliases text[]` (default `{}`), `kind` (`person_kind`), `contact jsonb` (CHECK null unless `kind` is `client` or `professional`: PRD §9, no contact-book upload)                                                                                                             |
| `organisation` | `name` (CHECK not blank), `aliases text[]` (default `{}`); no provenance                                                                                                                                                                                                                                 |
| `role_edge`    | `kind` (`role_edge_kind`), `from_person_id` (-> `person`), exactly one of `to_person_id` (-> `person`, not `from_person_id`), `matter_id` (-> `matter`), `proceeding_id` (-> `proceeding`) (CHECK `num_nonnulls(...) = 1`); every FK composite and ON DELETE CASCADE; an index led by `workspace_id` on each |

## Docket tables

`listing`, `hearing`, `appearance`, `order`, `obligation` and `task` in
`packages/db/src/schema/docket.ts`, migration `0041_docket` (#347, part 4 of #32,
[ADR 0013](../adr/0013-matter-graph-schema.md)). Tenant tables under FORCE RLS; all but `appearance`
carry `provenance()` and `provenanceCheck()`. Tested in
`packages/db/src/__tests__/docket-schema.test.ts`.

| Table        | Columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listing`    | `proceeding_id` (-> `proceeding`, NO ACTION), `list_date`, `list_type` (`list_type`), `list_no`, `item_no`, `stage_raw`, `stage_norm`, `hall_id` / `bench_id` (-> `court_hall` / `bench`, `same_or_global` scope guards), `canonical` (unique `(workspace_id, proceeding_id) WHERE canonical`: one next date per proceeding), `source_document_id` (-> `document`, SET NULL); indexes `(workspace_id, proceeding_id, list_date)`, `(workspace_id, list_date, hall_id)` |
| `hearing`    | `listing_id` (-> `listing`, NO ACTION), `held_on`, `outcome`, `adjournment_reason`, `next_date_proposed`, `next_date_confirmed`, `stage_after_raw`                                                                                                                                                                                                                                                                                                                     |
| `appearance` | `hearing_id` (-> `hearing`, ON DELETE CASCADE), `member_id` (-> `member`, SET NULL), `capacity` (`appearance_capacity`), `appearing_for_person_id` (no FK yet; a follow-up adds the composite FK to `person`)                                                                                                                                                                                                                                                                                                  |
| `order`      | `proceeding_id`, `document_id` (NO ACTION), `order_date`, `bench_id` (-> `bench`, scope guard), `order_type` (`order_type`), `neutral_citation`, `operative_directions` (jsonb array of `{text, anchorId}`), `next_date`                                                                                                                                                                                                                                               |
| `obligation` | `matter_id` (NOT NULL), `proceeding_id`, `source` (`obligation_source`), `description`, `due_date`, `basis`, `owner_member_id` (SET NULL), `status` (`obligation_status`), `closed_reason_type`, `closed_by` (-> `member`, SET NULL), `closed_at`, `closed_note`, `source_order_id` (-> `order`, SET NULL); closure: `obligation_closure_chk` plus the `obligation_closed_by_guard` trigger                                                                            |
| `task`       | `matter_id`, `proceeding_id`, `title`, `due_date`, `owner_member_id` (SET NULL), `status` (CHECK `open`, `done`, `cancelled`), `fulfils_obligation_id` (-> `obligation`, SET NULL)                                                                                                                                                                                                                                                                                     |

All references are composite `(workspace_id, <parent>_id)` except the hall and bench FKs; every SET
NULL is `ON DELETE SET NULL (<column>)`, so `workspace_id` stays. A closed obligation needs
`closed_reason_type` and `closed_at` (CHECK), a non-blank `closed_note` for `not_applicable`
(CHECK), and `closed_by` (trigger, 23514). The trigger exempts only the FK's own SET NULL when the
closer's member row is deleted (account deletion), so the obligation stays closed with
`closed_by` null. `order` is a reserved word: quote it in raw SQL.

## Adapter tables

`adapter_version`, `adapter_parse_run` and the view `adapter_health_summary` in
`packages/db/src/schema/adapters.ts`, migration `0044_adapter_framework` (#372,
[ADR 0015](../adr/0015-court-adapter-framework.md)). Tested in
`packages/db/src/__tests__/adapters-schema.test.ts`.

- `adapter_version` is global (`GLOBAL_TABLES`): one row per `(adapter_id, version)` with the config,
  its sha256 `checksum`, `fixtures_digest`, `status` (`adapter_version_status`), `activated_at`,
  `activated_by` (-> `user`, SET NULL) and `last_verified_at`. The partial unique index
  `adapter_version_one_active_uq` allows one `active` row per adapter. The app role may select,
  insert and update it; the clerk role has no access.
- `adapter_parse_run` is a tenant table under FORCE RLS: `document_id` (composite FK, ON DELETE
  CASCADE), adapter id and version, `forum_code`, row and heading counts, `halls_seen`,
  `halls_unreadable` and `status` (`parse_health_status`). Metrics only, never row text.
- `adapter_health_summary` groups those runs by adapter and version (run counts per status, row
  sums). It is owned by the owner role and reads every workspace through `owner_definer_read` on
  `adapter_parse_run`; the app and clerk roles may only select it. It has no workspace, document or
  hall column. drizzle declares it with `.existing()`, so `db:generate` leaves it alone.

## Bench roster tables

`bench_roster`, `bench_roster_entry` and `bench_change_alert` in
`packages/db/src/schema/roster.ts`, migration `0046_bench_rosters` (#384, part 1 of #39,
[ADR 0017](../adr/0017-effective-dated-rosters.md)), plus `bench_roster.confirmation_state` in
migration `0047_bench_roster_confirmation` (#387). Tenant tables under FORCE RLS; no `provenance()`
columns, but a roster records its source document, importing member and confirmation state.
Tested in `packages/db/src/__tests__/roster-schema.test.ts`; zod schemas in
`@causedeck/validators/roster`.

| Table                | Columns and constraints                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench_roster`       | `forum_id` (-> `forum`, `same_or_global` scope guard), `effective_from`, `effective_to` (null: open-ended; CHECK after `effective_from`), `status` (CHECK `draft`, `active`, `superseded`), `version` (CHECK > 0; unique `(workspace_id, forum_id, version)`), `source_document_id` (-> `document`, SET NULL), `imported_by` (-> `member`, SET NULL), `note`, `confirmation_state` (enum, default `proposed`; `bench_roster_confirmed_chk`: only a draft may stay `proposed`) |
| `bench_roster_entry` | `roster_id` (-> `bench_roster`, ON DELETE CASCADE), `hall_id` (-> `court_hall`, scope guard, nullable), `hall_no` (CHECK not blank), `bench_id` (-> `bench`, scope guard), `portfolio_text`, `portfolio_rule` (jsonb object or null)                                                                              |
| `bench_change_alert` | `proceeding_id` (-> `proceeding`, NO ACTION), `roster_id` (-> `bench_roster`, NO ACTION), `old_bench_id` (nullable) / `new_bench_id` (-> `bench`, scope guards), `reason` (CHECK `hall`, `portfolio`), `status` (CHECK `open`, `dismissed`); unique `(proceeding_id, roster_id)`                                     |

`bench_roster_active_period_excl` (hand-written in the migration; Drizzle cannot declare EXCLUDE)
is `EXCLUDE USING gist (workspace_id WITH =, forum_id WITH =, daterange(effective_from,
effective_to, '[)') WITH &&) WHERE (status = 'active')`: no two active rosters of one workspace
and forum share a day (23P01). Migration 0046 creates the `btree_gist` extension it needs. Entries
name a bench, never judges (the judge-aggregation guard covers these tables). The roster
services in `@causedeck/core/court` (#387) are the only writers: `confirmRosterImport` writes a
roster `active` and `confirmed`, and supersedes the previous version, in one transaction.
`detectBenchChanges` (#389) is the only writer of `bench_change_alert`: it inserts with
`ON CONFLICT (proceeding_id, roster_id) DO NOTHING`, so a re-run adds nothing, and `dismissAlert`
only sets `status`. Migration `0049_notification_bench_alert_party_names` adds
`notification_setting.bench_alert_party_names` (boolean, default false): the member's opt-in to party
names in bench-change notifications.

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
