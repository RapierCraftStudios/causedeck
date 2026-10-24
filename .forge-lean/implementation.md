### Approach
Continued the checkpointed branch. With node 22.23 on PATH the validate commands could run; they exposed three test/import defects, fixed here. Testcontainers' ryuk reaper cannot start on this host, so tests ran with `TESTCONTAINERS_RYUK_DISABLED=true` (env only).
### Changes
- packages/core/src/jobs/definitions/webhook-deliver.ts: import the webhooks domain through its index.ts (core-domain boundary); lint-safe error text.
- packages/core/src/webhooks/__tests__/webhooks.test.ts: jobs imports via jobs/index.ts; clear the two-tenant seeder's webhook rows; run the delivery job inside a workspace scope as the runner does.
- packages/core/src/__tests__/cross-tenant/services.test.ts: clear seeded webhook rows before the list and emit cases.
### Acceptance Criteria Status
- R1 ✅ packages/core/src/webhooks/events.ts, jobs/definitions/webhook-deliver.ts, apps/worker/src/__tests__/registry.test.ts:169, schedules.test.ts:45
- R2 ✅ packages/core/src/webhooks/__tests__/webhooks.test.ts (emit + deliver on the test database)
- R3 ✅ apps/api/src/routes/v1/webhook-endpoints.ts:60 requireScope
- R4 ✅ apps/api/src/__tests__/webhook-endpoints.test.ts:26
- R5 ✅ content-free payload asserted in webhooks.test.ts; no judge data
### Verification
V1–V5 all pass (`forgedock check` PASS, run with TESTCONTAINERS_RYUK_DISABLED=true). The domains.test.ts, webhooks and cross-tenant cases failed before these fixes and pass now.
### Notes
No behaviour change in production code. Env: TESTCONTAINERS_RYUK_DISABLED=true needed locally only.

## Stale-list follow-up
Flagged job/schema symbols are already in cross-tenant-registry NOT_A_SERVICE / table list; the flagged app and services tests enumerate no sibling schema or job symbols, so recorded as not_members in result.json.

### Follow-up: sibling lists
The flagged tests do not enumerate job exports or schema tables (no sibling symbol appears in them); recorded as `not_members` in result.json. The registries that do enumerate them (cross-tenant-registry.ts, db index.test.ts, rls sql.test.ts) already name the webhook symbols. V1-V5 were passing on the previous commit; no code changed.
