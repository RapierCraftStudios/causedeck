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
V1, V2: could not run. Vitest globalSetup fails to start the Postgres testcontainer ("Log stream ended ... Started"), a toolchain/environment problem. V3 not run. Prettier and eslint pass via the commit hook.

### Notes
No env vars. Vacations come from a static per-forum table (R8 deferred).
