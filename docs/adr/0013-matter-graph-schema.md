# 0013. Matter-graph schema: composite tenant keys, global-or-workspace reference tables, case identity

## Status

Proposed

## Date

2026-10-21

## Context

The matter graph (#32, split into #344-#349) is the knowledge spine of CauseDeck: matters, proceedings, listings, hearings, orders, obligations, tasks, people and documents, plus the court-layer reference tables `forum`, `court_hall` and `bench`. The [technical architecture spike](../engineering/13-technical-architecture-spike.md) §4.1-§4.3 asks for its invariants to live in the database: provenance on every fact, no cross-workspace foreign keys, and RLS as the backstop ([ADR 0003](0003-postgres-17-pgvector-drizzle-rls-multitenancy.md)). Two things do not fit the existing helpers. Court reference data is shared: the system catalogue of forums (seeded by #34) is the same for every workspace, but a workspace may add its own A0 forum. The `confirmation_state` enum from #6 (`proposed|confirmed|edited|rejected`) also predates the #32 data contract (`proposed|confirmed|auto_applied|corrected`).

## Decision drivers

- No foreign key may let one workspace reference, or probe the existence of, another workspace's rows.
- The system catalogue must be readable by every workspace and writable by no application role.
- `db:check` and `db:check-rls` must keep machine-checking every table; no table may be exempted by hand.
- Case identity must cover the pre-numbering stage (SR/FR numbers) as well as numbered cases.

## Considered options

| Option                                                                           | Verdict  | Reason                                                                                                                                 |
| -------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Global-or-workspace tables: nullable `workspace_id`, three policies, scope guard | Chosen   | One table holds catalogue and custom rows; RLS keeps custom rows private; the trigger closes the FK gap                                |
| Court tables in `GLOBAL_TABLES`, custom forums in a separate tenant table        | Rejected | Every reference to a forum would need two nullable columns and a CHECK; queries would union two tables                                 |
| Composite `(workspace_id, forum_id)` FKs into the court tables                   | Rejected | MATCH SIMPLE skips the check when `workspace_id` is null, and a strict tenant row cannot point at a null-workspace parent through it   |
| Drop and recreate `confirmation_state`                                           | Rejected | Works only because no column uses the type yet; `RENAME VALUE` gives the same labels in the same order without a destructive statement |

## Decision

- **Composite tenant FKs.** Every child tenant table references its tenant parent as `(workspace_id, <parent>_id) -> parent(workspace_id, id)`; each parent has a unique `(workspace_id, id)`. `member` gets `member_workspace_id_id_uq` (#344) so `owner_member_id`, `member_id` and similar columns (#345, #347) are composite too. `db:check` and `db:check-rls` already enforce this.
- **Nullable composite FKs.** A nullable composite FK whose parent can go away (`matter.owner_member_id`: an account deletion cascades its member rows; the self-references `matter.merged_into_matter_id` and `document.supersedes_document_id`: the erase deletes in 500-row batches) is `ON DELETE SET NULL (<column>)` (Postgres 15+), hand-written in the migration, because a plain composite `SET NULL` would also null `workspace_id` (#345, migration 0038).
- **Global-or-workspace reference tables.** `forum`, `court_hall` and `bench` are declared with `globalOrWorkspaceTable()` and listed in `GLOBAL_OR_WORKSPACE_TABLES`. `workspace_id` is nullable: null is a system catalogue row, a workspace id is that workspace's custom row. Their migration runs `globalOrWorkspacePolicy()`: the tenant `ws_isolation` policy (reads and writes inside the current workspace; a null `workspace_id` never passes its WITH CHECK, so the app and clerk roles cannot write catalogue rows), `global_read` (FOR SELECT, `workspace_id IS NULL`) and `owner_catalogue` (FOR ALL TO `causedeck_owner`, `workspace_id IS NULL`), because FORCE RLS binds the owner too.
- **References into them.** A FK into a global-or-workspace table is single-column (`forum_id -> forum(id)`) and guarded by the `app_reference_scope_guard(ref_table, fk_column, mode)` BEFORE INSERT/UPDATE trigger, named `<table>_<column>_scope_guard`. It runs as the invoker, so it only sees rows visible under RLS, and rejects (23503) a missing or invisible row, or one of the wrong scope. Mode `same` (used by `court_hall` and `bench`) requires exactly the row's scope: a hall belongs to its forum's scope, so `court_hall (forum_id, hall_no)` stays unique without leaking another workspace's halls. Mode `same_or_global` (for `proceeding.forum_id` in #346 and `listing.hall_id` / `bench_id`, `order.bench_id` in #347) also accepts a catalogue row. `db:check-rls` fails on a FK into such a table without its trigger.
- **Case identity.** A proceeding is identified by forum x normalised `case_type_code` (upper-case, no dots or spaces; the printed label in `case_type_raw`) x `number` x `year`, unique per workspace once numbered. Before numbering, `filing_no`, `sr_no`, `fr_no`, `diary_no` and `cnr` (16 upper-case alphanumerics, unique per workspace) are separate nullable columns, and `state` follows `filed -> sr_fr -> defects -> re_presented -> numbered -> disposed`; `number` and `year` are required from `numbered` on (#346).
- **Provenance.** `confirmation_state` becomes `proposed|confirmed|auto_applied|corrected` (renamed in place in migration 0037), `provenance()` adds `captured_at timestamptz not null default now()`, and `provenanceCheck()` also keeps `confidence` within 0..1. The shared pg enums of the graph live in `packages/db/src/schema/enums.ts`.

## Consequences

- Positive: the catalogue and custom forums share one table and one set of queries, and every reference is checked by Postgres, not by service code.
- Positive: both checkers know the category, so a new reference table or FK cannot skip its policies or its trigger.
- Negative: references into the court tables pay for a trigger lookup on insert and on updates of the FK column.
- Negative: a single-column FK into a reference table is a deliberate exception to the composite-FK rule that reviewers must recognise.

## Revisit when

- Another shared catalogue (for example statutes or limitation rules) needs the same category.
- A workspace needs to extend a catalogue forum with its own halls or benches (mode `same` forbids it today).

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- [Tenancy](../engineering/tenancy.md)
- [ADR 0003](0003-postgres-17-pgvector-drizzle-rls-multitenancy.md)
- Issues: #32 (matter-graph schema), #344 (this part), #345 (matter, documents), #346 (proceeding), #347 (listing, order)
