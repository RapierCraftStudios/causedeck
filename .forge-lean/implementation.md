### Approach
Hand-written `obligation_clerk_v` (security_barrier, description NULL on strategy rows); clerk role loses all privileges on `obligation`; `queryQueue` reads the view in a clerk-role scope for clerks; writes stay in the app role (P1).
### Changes
- packages/db/src/schema/docket.ts, schema/index.ts: `strategy` column, `obligationClerkView`.
- packages/db/migrations/20261031133134_obligation_strategy.sql (+snapshot, journal): column, view, REVOKE/GRANT.
- packages/core/src/obligations/context.ts: `readableObligation`, `readObligations`, `obligationColumns`, `visibleRow`; clerks cannot load strategy rows for write.
- packages/core/src/obligations/queue.ts: clerk reads through the view.
- packages/core/src/obligations/update.ts: `strategy` settable by owner/advocate only.
- packages/validators/src/obligation.ts, matter-graph.ts: `strategy` field.
- docs/adr/0043-obligation-model.md; tests: rls/obligation-clerk-view.test.ts, obligations.test.ts, judge-aggregation-guard allow-list.
- views.ts (D4) unchanged: its reads run in the app role and never select `description`.
- cross-tenant/obligations.test.ts (D10) unchanged: no new path exposed; existing cases pass.
### Acceptance Criteria Status
- R1 ✅ queue.ts:44-88, context.ts:185-215, update.ts:36, migration sql
### Verification
- V1 db vitest (4 files, 20 tests): pass.
- V2 core vitest (3 files, 19 tests): pass; new strategy test fails without the fix (clerk would see the description / no flag).
- V3 validators: pass.
- V4 literal command fails: no `check-rls` script (real one is `db:check-rls`, needs a live DB). Its intent passes: `vitest run src/__tests__/rls/sql.test.ts` runs the db:check-rls CLI against the migrated DB (15 tests pass), plus a static migration-policy check with no violations.
### Notes
Clerk-role reads of `obligation` elsewhere (briefs, calendar, handover...) would now be denied; none run in the clerk role today (see ADR).

## Stale-list follow-up
The 19 flagged tests list tables, row fixtures or mocks; obligationClerkView is a view, so none enumerates it. Recorded under not_members in result.json; no test edits needed.
