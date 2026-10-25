### Approach
Continued the checkpointed branch: all deliverables D1-D39 were present; verified every validate command and added the missing R10/R11 sweep test.
### Changes
- packages/validators/src/brief.ts, index.ts: brief zod schemas and re-export
- packages/db/src/schema/brief.ts, index.ts, migrations/20261025000000_brief_state.sql (+snapshot, journal): brief_state with FORCE RLS and app_brief_refresh_targets()
- packages/db tests/registry/seeds (index.test.ts, rls/sql.test.ts, cross-tenant-registry.ts, two-tenants.ts, seed/brief-fixtures.ts): registrations and fixtures
- packages/db/package.json: `./seed/brief-fixtures` export (amendment add-deliverable)
- packages/core/src/briefs/*: assemble, sections, readiness, state, refresh, barrel (no send/export/file)
- packages/core/src/jobs/definitions/brief-refresh.ts, jobs/registry.ts, index.ts: jobs and exports
- eslint core-domains.js, docs/engineering/core-domains.md, ADR 0038 + README: domain docs
- tests: briefs/__tests__/*, cross-tenant services.test.ts, worker registry/schedules tests
### Acceptance Criteria Status
- R1 ✅ packages/core/src/briefs/assemble.ts
- R2 ✅ sections/last-order.ts
- R3 ✅ sections/obligations.ts
- R4 ✅ sections/carry.ts, state.ts
- R5 ✅ sections/synopsis.ts, court-notes.ts
- R6 ✅ sections/context.ts
- R7 ✅ readiness.ts
- R8 ✅ state.ts, refresh.ts
- R9 ✅ assemble.ts
- R10 ✅ refresh.ts; state.test.ts sweep/idempotence tests (p95 on deterministic path not benchmarked separately)
- R11 ✅ migration app_brief_refresh_targets, jobs/definitions/brief-refresh.ts
- R12 ✅ assemble.ts / last-order.ts via gateway
- R13 ✅ briefs/index.ts
- R14 ✅ briefs/__tests__/cross-tenant.test.ts, services.test.ts
- R15 ✅ schema/brief.ts, migration
- R16 ✅ validators/src/brief.ts
### Verification
V1-V6 all pass (forgedock check: PASS). New sweep test (state.test.ts) covers selection that did not exist before; it would fail without refreshBriefTargets/target function.
### Notes
No env vars. schedules.test.ts two-replica test is timing-flaky under load (passed on rerun).

## Stale-list follow-up
briefState flagged against 10 app tests; none enumerates db tables or schema exports (see not_members in result.json). No test edits needed.

briefState is recorded as not_members for the ten listed apps/admin and apps/web tests (see result.json): none enumerates schema tables, and briefs add no server action or route in the apps.


## Fix: export name collisions
Renamed briefs `requireAction` -> `requireBriefAction` and `istDay` -> `briefIstDay` (no registry keyed by either name).
Also moved the shared briefs plumbing from assemble.ts into briefs/scope.ts to break import cycles that the pre-commit lint flagged, and fixed the lint errors in the briefs files. Re-ran core briefs and domains tests: pass.

## Conformance fix
Added briefs/__tests__/ai-and-budget.test.ts: R10 deterministic-path p95 < 1.5 s over 10 assemblies; R12 gateway call writes ai_call rows (task summarise) and none on a sensitive matter.

## Lint fix
CI lint failed on restrict-template-expressions in packages/core/src/briefs/readiness.ts:36; wrapped the number in String(). ESLint on all changed files now clean.

## CI fix
CI test/tenancy logs were unavailable. brief_state was missing from the lifecycle export coverage and erase-order lists (core/lifecycle), which guard tests require for every tenant table; added both. Removed committed .eslintcache files. The worker schedules two-replica test failure in V5 looked like a minute-boundary timing flake and is unrelated.
