**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (no data routes under the API prefixes yet; quota can overshoot slightly under load)
**Task Type**: bug

### What Was Claimed
`consumeApiCall` checks the monthly quota and bills the usage unit in separate steps, so concurrent requests on one key can all pass the check before any increments and exceed the quota.

### What We Found
- `packages/core/src/api-keys/index.ts:297-322`: `consumeApiCall` reads `apiKeyCallsThisPeriod` (own `withWorkspace` tx, `:279-295`, counts `usage_event` rows), compares to `monthlyQuota` (`:307`), then calls `increment` (own tx, `:310`) and updates `last_used_at` (own tx, `:316`). Three transactions, no lock between check and increment.
- `packages/core/src/usage/meter.ts:77-95,106-125`: `increment`/`incrementSql` is a single atomic statement but is idempotent per `idempotency_key`; it has no quota condition. `incrementSql` is exported and usable inside an existing workspace tx.
- Unique index `usage_event_workspace_idempotency_uq` (`packages/db/src/schema/usage.ts:77`) only dedups the same request id; distinct concurrent requests all insert.
- `withWorkspace` (`packages/db/src/rls.ts:135`) nests freely in the same workspace, so one tx can do lock, count, insert and touch.
- Existing tests are sequential in a rolled-back tx (`packages/core/src/api-keys/__tests__/api-keys.test.ts:124-176`); the concurrency pattern to copy is `packages/core/src/usage/__tests__/concurrency.test.ts` (real pooled `createDb`, committed seed, cleanup).

### Root Cause
Check-then-act across separate transactions. The count is a read of the ledger, and nothing serializes the read with the later insert, so under READ COMMITTED N requests all see `used < quota`.

### Affected Files
- `packages/core/src/api-keys/index.ts` (`consumeApiCall`)
- `packages/core/src/api-keys/__tests__/api-keys.test.ts` (existing tests must still pass)
- new `packages/core/src/api-keys/__tests__/concurrency.test.ts` (repro: N concurrent calls, K remaining, exactly K allowed; quota 0 blocks)
- Enumerating test, only if a new runtime export is added: `packages/core/src/__tests__/cross-tenant/services.test.ts:2625` and `packages/db/src/testing/cross-tenant-registry.ts`. The plan adds no export, so neither changes; run the services test to confirm.

### Sibling Sweep
- `usage` `reserve`/`commit` (AI budget) in `packages/core/src/usage/budget.ts` is a separate path with its own design; not touched. `apps/api/src/middleware/api-key.ts` is the only caller of `consumeApiCall`; its result shape must be unchanged. The per-minute rate limit is separate.

### History
Introduced in #624 (PR #633); found in its security review.

### Recommendation
Rewrite `consumeApiCall` as a single `withWorkspace` transaction: (1) `select id from api_key where workspace_id and id for update` to take a per-key row lock (serialises concurrent calls on that key; after the lock is granted the next statement sees committed rows under READ COMMITTED); (2) count this period's `api.calls` events for the key; (3) if quota non-null and used >= quota return not allowed (quota 0 always blocks); (4) run `incrementSql` (exported from `usage/meter.ts`, validated inputs, same idempotency/metadata) and update `last_used_at`, in the same tx. Any thrown error propagates (fail closed). Keep `ApiCallResult` unchanged. Different keys do not block each other.

### Related Issues
#624, #633 (origin).
