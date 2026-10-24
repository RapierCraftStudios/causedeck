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
- V1 `pnpm --filter @causedeck/core exec vitest run src/sources/__tests__/coverage.test.ts src/sources/__tests__/ src/jobs/definitions/coverage-weekly.test.ts`: pass (exit 0)
- V2 `pnpm --filter @causedeck/admin exec vitest run __tests__/coverage-page.test.tsx __tests__/console-layout.test.tsx __tests__/roles.test.ts __tests__/data-layer.test.ts __tests__/server-component-imports.test.ts __tests__/no-content-fields.test.ts __tests__/no-without-workspace-outside-data.test.ts`: pass (exit 0)
- V3 `pnpm --filter @causedeck/worker exec vitest run src/__tests__/registry.test.ts src/__tests__/schedules.test.ts`: pass (exit 0)
- V4 `pnpm --filter @causedeck/db exec vitest run src/index.test.ts src/testing`: pass (exit 0)
- V5 `node /opt/node/lib/node_modules/forgedock/bin/lean/checks.mjs --base origin/milestone/court-data-network`: pass (exit 0); `forgedock check` PASS on the merged tree.
- core and admin `tsc --noEmit`: clean; eslint on changed files runs clean via the pre-commit hook.
- New tests exercise new code, so they fail without the change (modules absent).

### Notes
- The weekly job reads watch demand as the first enabled ops/admin staff user.
- New `coverage` capability: ops and admin only.

- Added coverageOverview to the READS list (with staffCoverageInputs/coverageReport mocks) in apps/admin/__tests__/server-actions-audit.test.ts.

- Merge recheck: `turbo: command not found` (exit 127) is a PATH issue, not a code conflict. `pnpm exec turbo run typecheck --filter='...[base]'` passes (23/23); V1-V4 pass. No code change.

### Merge check
- After merging the base, `turbo run typecheck --filter=...[e39ede8b]` exited 127 (`turbo` not on PATH, an environment problem, not code). Run as `pnpm turbo run typecheck`: 23/23 tasks pass; V1-V5 pass. No code change was needed.

- Merge recheck 2 (#517): `turbo: command not found` (exit 127) is a PATH issue only. `pnpm exec turbo run typecheck --filter=...[base]` 23/23 pass; V1-V3 pass. No code change.
