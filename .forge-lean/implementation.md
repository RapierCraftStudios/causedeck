### Approach
A pure coverage model in core (forum x data type levels, freshness, volume, ranked gaps, week-over-week diff derived from `source.cleared_at`), a SECURITY DEFINER `app_staff_watch_demand()` for live watch counts, an audited admin data function and Coverage page, and a weekly email job.

### Changes
- packages/core/src/sources/coverage.ts (+ index.ts export): model, reader, `staffCoverageInputs`, `coverageReport`.
- packages/db/migrations/20261024100000_staff_watch_demand.sql (+ journal, snapshot): definer function, aggregates only.
- apps/admin: `lib/data/index.ts` `coverageOverview`, `app/(console)/coverage/page.tsx` (force-added: `.gitignore` ignores `coverage/`), nav item, `coverage` capability for ops/admin.
- packages/core/src/jobs/definitions/coverage-weekly.ts + registry: `system.coverage.weekly`, cron `30 9 * * 1`.
- Registries/tests: worker registry and schedules tests, cross-tenant registry, staff-console-schema test, coverage unit/page/job tests.

### Acceptance Criteria Status
- R1 ✅ apps/admin/app/(console)/coverage/page.tsx, __tests__/coverage-page.test.tsx
- R2 ✅ packages/core/src/sources/coverage.ts rankGaps
- R3 ✅ packages/core/src/jobs/definitions/coverage-weekly.ts
- R4 ✅ coverage.test.ts "gives every catalogue forum a level for every data type"
- R5 ✅ coverage.test.ts "ranks by live watch demand" (order flips with demand)

### Verification
- V1 core vitest, V2 admin vitest, V3 worker vitest, V4 db vitest, V5 checks.mjs: pass (`forgedock check` PASS).
- core and admin `tsc --noEmit`: clean; eslint on changed files runs clean via the pre-commit hook.
- New tests exercise new code, so they fail without the change (modules absent).

### Notes
- The weekly job reads watch demand as the first enabled ops/admin staff user.
- New `coverage` capability: ops and admin only.

- Added coverageOverview to the READS list (with staffCoverageInputs/coverageReport mocks) in apps/admin/__tests__/server-actions-audit.test.ts.
