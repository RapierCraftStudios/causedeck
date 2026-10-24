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

## Merge fix (turbo not found)
The merged-tree failure was `turbo: command not found` (exit 127), an environment PATH issue, not a code conflict. With `node_modules/.bin` on PATH, `turbo run typecheck --filter=@causedeck/core --filter=@causedeck/worker --filter=@causedeck/db` passes (17/17). No source change was needed. Vitest suites could not run on this host (the global setup's Postgres container did not start: "Log stream ended and message /.*Started.*/ was not received"), so V1/V2 were not re-run after the merge.

### Post-merge (second base merge)
Registry lists conflicted (core jobs/registry.ts, worker registry/schedules tests); kept both the base's webhook jobs and `system.orders.poll`. `turbo: command not found` (exit 127) is a PATH problem, not a code clash: `pnpm exec turbo run typecheck` over core, worker, api and db passes (18 tasks), and V1-V3 pass on the merged tree.

### Merge fix (third check)
`turbo: command not found` (exit 127) is again a PATH problem, not a code clash. With `node_modules/.bin` on PATH, `tsc --noEmit` over core, worker and db is clean. Vitest could not start on this host (Postgres container "Started" log never arrives), so V1/V2 were not re-run. No source change.

### Merge fix (fourth check)
`turbo: command not found` (exit 127) is a PATH problem, not a code clash. With `node_modules/.bin` on PATH, `turbo run typecheck --filter=@causedeck/core --filter=@causedeck/worker` passes (17/17). Vitest still cannot start on this host (Postgres container), so V1/V2 were not re-run. No source change.

### Merge fix (fifth check)
`turbo: command not found` (exit 127) is again a PATH problem, not a code clash. With `node_modules/.bin` on PATH, `turbo run typecheck --filter=@causedeck/core` passes (16/16). The worker vitest run (V2) still fails to start on this host (no Postgres container), so it was not re-verified. No source change.

### Post-merge (third base merge)
core-domains.md conflicted; kept the `deadlines` and extended `case-watch` rows plus the base's `notices` row (onMatched hook). `turbo: command not found` (exit 127) is a PATH problem, not a code clash: `pnpm exec turbo run typecheck` over core, worker, api and db passes (18 tasks), and V1-V3 pass on the merged tree.

## CI fix (test job)
CI log was unavailable and no Postgres exists on the host, so DB-backed tests could not run. Reviewed the diff against the guard lists (registries, domains, worker tests: consistent) and ran the pure tests (deadlines, orders-poll, domains: pass). Found one real defect: `storeOrder` created captures without `ttlAt`, so retention would never expire them (createCapture sets `initialTtl`). Fixed in case-watch/orders.ts. Not confirmed to be the CI failure.

### Post-merge recheck (turbo exit 127)
Again `turbo: command not found` only: no code clash. `tsc --noEmit` is clean in core, db and worker; targeted vitest (deadlines, case-watch, extraction, orders-poll, domains, worker registry/schedules) passes. No code change needed.

## Merge recheck (turbo exit 127)
`turbo: command not found` was a PATH problem, not a code clash. No source change needed. Ran `tsc --noEmit` for core, worker and db (pass) and the V1/V2 vitest subsets (core 37 tests, worker 11 tests; pass).

### Post-merge (fourth base merge)
Only .forge-lean files conflicted (kept this branch's). `turbo: command not found` (exit 127) is a PATH problem, not a code clash: `pnpm exec turbo run typecheck` over core, worker, api and db passes (18 tasks), and V1-V3 pass on the merged tree.

### CI fix (intelligence test, run 40084029731)
The only failed task was `@causedeck/intelligence#test`; the log excerpt shows no failing assertion. This branch changes nothing under packages/intelligence (`git diff origin/milestone/court-data-network...HEAD -- packages/intelligence` is empty, P1 preserved). `vitest run --coverage` for the package passes locally (exit 0, no threshold error). Treated as a CI-load flake unrelated to this change; no code change.

## Merge recheck (3)
turbo not found (exit 127) is a host PATH issue, not a merge conflict. tsc --noEmit clean for core, worker, db; core V1 and worker V2 subsets pass. No code change.

## Merge recheck (4)
`turbo: command not found` (exit 127) is again a PATH problem: turbo is in `node_modules/.bin`. With it on PATH, `tsc --noEmit` is clean for core, worker and db, and the V1 (39 tests) and V2 (11 tests) subsets pass. No code change.
