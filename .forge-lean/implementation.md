### Approach
Resumed the interrupted branch. The engine, orders poll, extraction hook, registries and docs were already in place; this pass added the missing `period.ts` named by D1 and declared the `status-poll.ts` accessor as an amendment.

### Changes
- packages/core/src/deadlines/period.ts: new, period arithmetic (days/weeks/months, month-end clamp).
- packages/core/src/deadlines/compute.ts: uses period.ts.
- packages/core/src/jobs/definitions/status-poll.ts: `getStatusFetcherFactory` accessor so orders.poll shares the wired fetcher (amendment add-deliverable).
- Earlier commits: deadlines domain, case-watch/orders.ts, jobs/definitions/orders-poll.ts, extraction/run.ts, registries, eslint core-domains, docs, cross-tenant tests, worker registry/schedule tests.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/deadlines/calendar.ts
- R2 ✅ packages/core/src/jobs/definitions/orders-poll.ts, case-watch/orders.ts
- R3 ✅ packages/core/src/extraction/run.ts
- R4 ✅ packages/core/src/deadlines/direction.test.ts
- R5 ✅ packages/core/src/deadlines/deadlines.test.ts
- R6 ✅ packages/core/src/case-watch/orders.test.ts
- R7 ✅ packages/core/src/deadlines/compute.ts

### Verification
Run with TESTCONTAINERS_RYUK_DISABLED=true (the Ryuk reaper container never logs Started here).
- V1 core vitest: pass (9 files, 217 tests); deadlines/orders tests fail without the new modules.
- V2 worker registry/schedules: pass (11 tests); fails without the orders.poll registration.
- V3 intelligence: pass (14 tests).

### Notes
No env vars. Vacations come from a static per-forum table (R8 deferred).

### Stale-list follow-up
The eight flagged symbols are not members of the named lists (partial mocks in case-watch-actions and status-poll tests; services.test.ts CASES is per-service, and the constants/job symbols are already in NOT_A_SERVICE). Recorded under `not_members` in result.json; no code changed, so V1-V3 results stand.

### Merge typecheck failure
`turbo run typecheck` exited 127 (`turbo: command not found`): an environment PATH issue, not a code or merge conflict. Ran `pnpm exec turbo run typecheck --filter=@causedeck/core --filter=@causedeck/worker` (core, worker and their dependencies, 17 tasks): all pass. No code changed.

### Post-merge
Merged origin/milestone/court-data-network (only .forge-lean files conflicted; kept this branch's). `turbo` is not on PATH here (exit 127 is environmental); `pnpm exec turbo run typecheck` over core, worker, api, db, flags and intelligence passes (18 tasks), and V1-V3 pass on the merged tree. No duplicate keys or symbol clashes found.
