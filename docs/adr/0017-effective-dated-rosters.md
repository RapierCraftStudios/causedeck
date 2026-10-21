# 0017. Effective-dated bench rosters

## Status

Proposed

## Date

2026-10-21

## Context

A High Court publishes a roster that says which bench sits in which court hall and which matters (its portfolio) each bench takes. Rosters change every few weeks or months, often mid-term, and the bench a matter goes before follows from the roster in force on the listing date. CauseDeck must tell a lawyer which bench a matter is before on a given day, and warn them when a new roster moves it (#39, PRD CL-10; [technical architecture spike](../engineering/13-technical-architecture-spike.md) §4.2, §5, §7, §8; docs/strategy/11 §2). Automatic roster retrieval is legally gated (A2) and out of scope. Rosters are imported by the lawyer from a PDF they supply, parsed heuristically, and always confirmed by the lawyer.

The court reference tables (`forum`, `court_hall`, `bench`, [ADR 0013](0013-matter-graph-schema.md)) are global-or-workspace. `bench.judges` records only the court-published composition, and nothing may aggregate by judge across matters or workspaces (PX-9, ME-6). This ADR covers the schema (#384, part 1 of #39). The parser (#385), the roster services (#387), bench-change detection (#389) and the UI (#391) build on it.

## Decision drivers

- A roster is lawyer-supplied data: it belongs to one workspace, is never shared, and follows the same RLS and erase rules as the rest of the matter graph.
- For a workspace and forum, exactly one confirmed roster answers "which bench sits in hall N on day D". The database, not only the service, must guarantee it.
- A roster can be for a catalogue forum (the main case) or for one of the workspace's own forums.
- No judge analytics, no bench profiling, no cross-workspace aggregation.
- History stays: an older roster is superseded, not overwritten.

## Considered options

| Option                                                                       | Verdict  | Reason                                                                                                                                    |
| ---------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace rosters with versions and a btree_gist exclusion on active periods | Chosen   | The database enforces one active roster per day; history is kept as versions; the same tenancy as the docket                              |
| One global roster per forum in the catalogue                                 | Rejected | Rosters are lawyer-supplied and parsed with the lawyer's confirmation; sharing them across workspaces would aggregate lawyer-entered data |
| Service-only overlap check                                                   | Rejected | Two concurrent confirmations could both pass a read-then-write check                                                                      |
| Entries storing judge names directly                                         | Rejected | Adds judge-bearing columns beside `bench.judges`, breaking the judge-aggregation guard                                                    |

## Decision

- **Tables** (`packages/db/src/schema/roster.ts`, migration `0046_bench_rosters`), all `tenantTable()`s under FORCE RLS with `ws_isolation`:
  - `bench_roster`: `forum_id`, `effective_from`, `effective_to` (null: open-ended), `status` (`draft`, `active`, `superseded`; default `draft`), `version` (> 0, unique per workspace and forum), `source_document_id` (-> `document`), `imported_by` (-> `member`), `note`.
  - `bench_roster_entry`: `roster_id` (-> `bench_roster`, ON DELETE CASCADE), `hall_id` (-> `court_hall`, nullable), `hall_no` (as printed), `bench_id` (-> `bench`), `portfolio_text` (as printed), `portfolio_rule` (jsonb object `{ caseTypes?, yearFrom?, yearTo?, subjectTags? }`, nullable).
  - `bench_change_alert`: `proceeding_id`, `roster_id`, `old_bench_id` (nullable), `new_bench_id`, `reason` (`hall`, `portfolio`), `status` (`open`, `dismissed`); unique `(proceeding_id, roster_id)`, so one alert per proceeding per roster.
- **One active roster per day.** `bench_roster_active_period_excl`: `EXCLUDE USING gist (workspace_id WITH =, forum_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'active')`. Periods are half-open, so a roster ending on 1 December and one starting that day do not overlap. Draft and superseded rosters are not constrained. The `btree_gist` extension (trusted; the database owner creates it in the migration) provides the equality operators for the uuid columns. Drizzle cannot declare EXCLUDE, so the constraint is hand-written SQL and absent from the snapshot. The roster schema test pins it.
- **Scope.** `forum_id`, `hall_id`, `bench_id`, `old_bench_id` and `new_bench_id` are single-column FKs guarded by `app_reference_scope_guard` in mode `same_or_global`: a catalogue row or one of the workspace's own, never another workspace's.
- **Deletes.** `imported_by` and `source_document_id` are `ON DELETE SET NULL (<column>)`. Alerts keep the proceeding and roster they cite (NO ACTION). The workspace erase purges alerts, then entries, then rosters, all before proceedings, documents, members and court rows. The rows are exported with the `court` exporter.
- **No judges.** An entry names a bench. Judge names live only in `bench.judges`. The judge-aggregation guard checks that the roster tables add no judge-bearing column, index or constraint. `RosterCandidate.judges` (`@causedeck/validators/roster`) is the court-published composition as the parser read it, a preview value the lawyer confirms into a bench. It is never stored on a roster row.
- **Immutability and supersede** are the roster services' rules (#387): an active version's entries are not edited; a newer roster supersedes it (status `superseded`, or its `effective_to` set to the newer roster's start). They are not a trigger, because a trigger freezing entries would also block the workspace erase's delete of `bench_roster_entry`.
- **Validators.** `@causedeck/validators/roster` holds the table schemas (checked against the tables by `matter-graph-validators.test.ts`), `PortfolioRule`, `RosterAnchor` (a page, quote and span location: candidates exist before any `anchor` row), `RosterCandidate` and the service inputs of #385, #387 and #389.

## Consequences

- Positive: the bench for a hall on a day is a single indexed lookup with a database-guaranteed unique answer; roster history is kept as versions; tenancy, erase and export follow the existing matter-graph rules.
- Negative: activating a roster that overlaps the current one needs the old one superseded or ended first, in the same transaction; the exclusion constraint is hand-written SQL that drizzle-kit does not track.

## Revisit when

- Courts publish rosters through an official machine-readable channel and A2 retrieval is legally cleared (#39 out of scope).
- A forum needs more than one concurrent active roster (for example separate rosters per side), which would add a column to the exclusion key.

## Links

- [ADR 0013: matter-graph schema](0013-matter-graph-schema.md)
- [Database guide: bench roster tables](../engineering/database.md#bench-roster-tables)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
