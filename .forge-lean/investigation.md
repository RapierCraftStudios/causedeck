**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: P1 feature (greenfield backend service; blocks #59, #60, #63, #64, #66, #70)
**Task Type**: feature

### What Was Claimed
Build the court-day service in `packages/core`: a workspace-scoped read model "what is listed on date D" grouped complex -> hall -> list -> item, plus clash detection, list snapshot/diff, manual "court is at item N" markers, and canonical next-date proposals/conflict cards. Two new tenant tables (`court_day_marker`, `list_snapshot`), zod types, cross-tenant tests.

### What We Found
(Verified at origin/milestone/prepare-execute a0f2f0b7; the earlier FORGE:INVESTIGATION comment on the issue describes a different issue (#666 portfolio UI) and is disregarded.)
- No `getCourtDay`, `detectClashes`, `snapshotList`, `diffLists`, `setCurrentItem`, `listConflictCards`, `court_day_marker` or `list_snapshot` exist anywhere (grep over ts/sql/md).
- `packages/core/src/court-day/` exists but is a different feature (#493 live display board, #521 bench card): `index.ts:1-6` exports `board.ts`, `eta.ts`, `bench-card.ts`. New files must be added next to them and re-exported there; the domain is already re-exported from `packages/core/src/index.ts:14`. Name clashes to avoid: `itemNumber` (eta.ts), `getLiveHalls`.
- Tables to read exist: `listing` (`packages/db/src/schema/docket.ts:50-100`: proceedingId, listDate, listType, listNo, itemNo text, stageRaw/stageNorm, hallId, benchId, canonical, provenance columns), `hearing` (`:107`), `appearance` (`:141`, memberId, capacity), `obligation` (`:234`, status/proceedingId), `proceeding` (`proceedings.ts:40`), `courtHall`/`bench`/`forum` (`court.ts:26,54,72`, global-or-workspace).
- The partial unique index `listing_one_canonical_uq` on `(workspace_id, proceeding_id) where canonical` already exists (`docket.ts:73-75`); only the test for the AC is missing. An index `listing_workspace_date_hall_idx(workspace_id, list_date, hall_id)` already exists (`docket.ts:77`), so the issue's index deliverable is already met.
- `itemNo` is `text` (not int): numeric ordering (item 9 before 10) must be done in the query/comparator; `eta.ts` has an `itemNumber` helper to reuse.
- Next-date logic already exists: `proposeNextDate` (`matter-graph/next-date.ts:134`) returns `proposal | conflict | noop`, never overwrites the canonical listing, needs `matter.write`; conflict view `NextDateConflictView` (`matter-graph/read-models.ts:148`, built in `getMatterOverview` ~`:1162`). `proposeNextDate` and `listConflictCards` for court-day should wrap/reuse these, not reimplement.
- Services pattern: `inGraphScope`/`MatterGraphDeps`/`GraphActor` (`matter-graph/context.ts`), `can()` from `@causedeck/auth/policy`, `withWorkspace`. Policy actions are a closed list (`packages/auth/src/policy/actions.ts:8-15`, `matrix.ts:6-31`); there is no `court_day.view_all`. `advocatesCanReadAudit` setting is the precedent for an owner setting (`can.ts:38,84-86`). Roles: owner, advocate, junior, clerk, viewer (`auth/src/role-rank.ts:6`).
- Domain boundary map: `'court-day': ['sources']` (`packages/config/eslint/core-domains.js:21`); the new code needs `matter-graph`, `workspaces`, `audit`, `matters` there, plus `docs/engineering/core-domains.md`.
- Migrations live in `packages/db/migrations/` with timestamp names (latest `20261024160052_review_queue.sql`, snapshot under `migrations/meta/`), not `packages/db/drizzle/` as the issue says. Seeds dir is `packages/db/src/seed/` (not `seeds/`). Core tests are colocated (`court-day/board.test.ts`), not `__tests__/`.
- Tenant-table registries touched by review_correction (precedent): `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/db/src/testing/two-tenants.ts`, `schema/index.ts`.
- Next ADR number: 0037 (`docs/adr` ends at `0036-bench-facts.md`); the ADR index in `docs/adr/README.md` must be updated (`pnpm adr:lint`).

### Root Cause
Greenfield: the matter graph (#33), adapters (#401, #408) and live-board feature landed, but nothing composes listings into a day view, detects clashes, snapshots lists or stores the manual hall marker.

### Affected Files
- `packages/validators/src/court-day.ts` (+ `index.ts` export, test)
- `packages/db/src/schema/court-day.ts`, `schema/index.ts`, migration `packages/db/migrations/<ts>_court_day.sql` + `meta` snapshot/journal
- `packages/core/src/court-day/{query,clashes,diff,markers,next-date}.ts` + colocated tests, `index.ts`
- `packages/auth/src/policy/{actions,matrix,can,docs}.ts` (+ policy tests) for `court_day.view_all`
- `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`
- `packages/db/src/{index.test.ts,__tests__/rls/sql.test.ts,testing/cross-tenant-registry.ts,testing/two-tenants.ts,seed/court-day-fixtures.ts}`, `packages/core/src/__tests__/cross-tenant/services.test.ts`
- `docs/adr/0037-court-day-read-model.md`, `docs/adr/README.md`

### Sibling Sweep
Every new core runtime export needs `SERVICE_TESTS` (or `NOT_A_SERVICE` for pure functions `detectClashes`, `diffLists`) in the cross-tenant registry. Both new tables need RLS + FORCE (copy `review_correction`/`portfolio` migrations). `setCurrentItem` writes must go through the audit path used by other core services (see `packages/core/src/audit/index.ts`). Same-class check: other read models (`matter-graph/read-models.ts upcomingListingsQuery :636`, `court/read-models.ts`) use `workspaceId` filters explicitly; follow it.

### History
No prior attempt (`committed: []` in the FORGE:STATE). Dependencies #33 (closed not_planned, but its services exist in `matter-graph/`), #401 and #408 merged. Court-day dir introduced by #493/#521 for a different scope.

### Recommendation
One lane, ordered checklist: (1) validators; (2) schema + migration + db registries/seeders; (3) policy action `court_day.view_all` (owner, advocate unless owner setting disables); (4) `query.ts` using at most 6 statements (listings+proceeding+matter+hall+bench+forum join, appearances, open-obligation counts, carry counts, markers, snapshots/diffs) with numeric item sort, supplementary after daily, tie on serial, `mine` scope via appearance.member_id, clerk payload without strategy fields, sensitive matters without AI-derived fields, `expectedNotListed`, `freshness`; (5) pure `detectClashes` with factual output only; (6) `snapshotList`/`diffLists`; (7) `setCurrentItem`/`clearCurrentItem` with audit event; (8) `proposeNextDate`/`listConflictCards` wrapping matter-graph; (9) tests incl. the two-canonical constraint test and the perf/statement-count test; (10) registries, domain map, ADR 0037. The `court_day.list_changed` event is emitted through an injected port, with no worker job registration (consumers are #59/#64).

### Related Issues
#1 (parent), #33, #401, #408 (deps); consumers #59, #60, #63, #64, #66, #70; #493/#521 (existing court-day dir).
