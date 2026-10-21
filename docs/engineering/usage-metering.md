# Usage metering

`@causedeck/core/usage` meters what a workspace consumes (#30, #219 to #225): the metered keys,
IST calendar-month periods, the `usage_event` ledger and `usage_counter` totals, the AI budget and
its reservation protocol, the soft and hard limits, fair-use caps, and reconciliation of
`ai_call` rows with the ledger. Only keys, numbers and ids are ever written, never customer
content. The tables live in `packages/db/src/schema/usage.ts`, under row-level security like every
workspace table ([tenancy.md](tenancy.md)).

```sh
pnpm --filter @causedeck/core exec vitest run src/usage
```

| Import | What |
|---|---|
| `@causedeck/core/usage` (`keys.ts`) | `USAGE_KEYS`, `UsageKey`, `USAGE_KEY_KINDS`, `isUsageKey` |
| `@causedeck/core/usage` (`period.ts`) | `usagePeriod`, `periodStart`, `nextPeriodStart`, `USAGE_TIME_ZONE` |
| `@causedeck/core/usage` (`meter.ts`) | `increment`, `incrementSql`, `getUsage`, `UsageContext` |
| `@causedeck/core/usage` (`budget.ts`) | `reserve`, `commit`, `release`, `reapExpiredReservations`, `RESERVATION_TTL_MS`, `BudgetError` (`BUDGET_EXCEEDED`) |
| `@causedeck/core/usage` (`limits.ts`) | `AI_BUDGET_KEY`, `getAiBudget`, `setBudgetOverride`, `expireBudgetOverride` |
| `@causedeck/core/usage` (`thresholds.ts`) | `checkAiBudgetThresholds`, `SOFT_LIMIT_BPS`, `HARD_LIMIT_BPS` |
| `@causedeck/core/usage` (`fair-use.ts`) | `assertWithinFairUse`, `FAIR_USE_KEYS`, `FAIR_USE_CAPS`, `FairUseError` (`FAIR_USE_EXCEEDED`) |
| `@causedeck/core/usage` (`fairness.ts`) | `fairnessConcurrencyForPlan`, `getWorkspaceFairnessConcurrency` (per-plan job fairness) |
| `@causedeck/core/usage` (`reconcile.ts`) | `reconcileAiCalls`, `reconcileAiCallsSql`, `AiCallMismatch` |

## Keys

`USAGE_KEYS` (`packages/core/src/usage/keys.ts`) lists every metered resource: `ai.spend_paise`,
`ai.tokens_in`, `ai.tokens_out`, `ocr.pages`, `stt.seconds`, `storage.bytes` and
`matters.active`. `increment` rejects any other key.

Each key has a kind in `USAGE_KEY_KINDS`:

- `counter` keys only grow within a period, so their amounts are `>= 0` (AI spend and tokens, OCR
  pages, STT seconds).
- `gauge` keys track a level and take signed deltas, such as bytes freed or a matter closed
  (`storage.bytes`, `matters.active`).

Every key matches `USAGE_KEY_PATTERN_SOURCE` (`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`,
`packages/db/src/schema/usage.ts`), which is also the `usage_event.key` CHECK constraint.

`usage_event.metadata` holds ids only, keyed like `ai_call_id` or `reservation_id`. Never put
names, prompts, document text or other content in it.

## Periods

A period is one IST calendar month (`Asia/Kolkata`, a fixed +05:30 with no daylight saving), with
`start` inclusive and `end` exclusive (`usagePeriod(at)`, `period.ts`). The database stores a
period as its start instant, `usage_counter.period_start`. For example, April 2026 starts at
`2026-03-31T18:30:00Z`.

`increment` appends a `usage_event` row and adds to the period's `usage_counter` in one statement
inside `withWorkspace`. The ledger insert claims the idempotency key, which is unique per
workspace, so a retried increment is counted once. Every hour the `system.usage.rollup` job
(`packages/core/src/jobs/definitions/usage-rollup.ts`, #222) copies the counters for the previous
and current months into `usage_period_summary`, the table billing reports read. It closes a month
on the first run after the month ends, and a closed summary never changes again. See
[jobs.md](jobs.md) for how jobs are defined and scheduled.

## Reservation protocol for the AI gateway

The AI gateway wraps every model call in a reservation (`budget.ts`, #220):

```ts
const r = await reserve(ctx, { estimatePaise, purpose });
try {
  const out = await call();
  const { id } = await recordAiCall(db, workspaceId, aiCallInput(out)); // audit/ai-call.ts
  await commit(ctx, r, actualPaise, { aiCallId: id });
} catch (e) {
  await release(ctx, r);
  throw e;
}
```

- `reserve` holds `estimatePaise` in `usage_reservation`. It throws `BUDGET_EXCEEDED` when
  `spent + reserved + estimate` is above the hard limit, which is the budget plus the courtesy
  grace (`ctx.thresholds.courtesyGraceBps`, default 0).
- A transaction-scoped advisory lock (`pg_advisory_xact_lock`) serialises the check per
  workspace, so concurrent reservations cannot oversubscribe the budget.
- `commit` replaces the reservation with the actual spend through
  `increment('ai.spend_paise')`. Its idempotency key is `reservation:<id>`, so a repeated commit is
  not counted again. With `{ aiCallId }`, the ledger metadata is
  `{ reservation_id, ai_call_id }`, which lets `reconcileAiCalls` match it. Without it, the metadata
  is `{ reservation_id }`.
- `release` drops a reservation without spending.
- Reservations expire after `RESERVATION_TTL_MS` (5 minutes). Expired ones never count, and the
  next `reserve` (or `reapExpiredReservations`) reaps them. A commit after expiry still records the
  spend.
- The budget is the newest unexpired staff override for `ai.spend_paise` (`setBudgetOverride`,
  `limits.ts`), or else the `ai_budget_paise` entitlement. Overrides are staff-only, justified,
  always expiring and audited as `usage.budget_override_set` ([audit.md](audit.md)). Staff can
  end an active override early with a reason (`expireBudgetOverride`, #224): its `expires_at`
  moves to now, `expired_at`, `expired_by` and `expire_reason` record who and why, and it is
  audited as `usage.budget_override_expired`. The next active override, or else the entitlement,
  applies from then on. The admin console's workspace page shows the counters and overrides
  ([admin-console.md](admin-console.md)).
- Soft limit: after a recorded spend, when the context has `enqueueDelivery`, `commit` runs
  `checkAiBudgetThresholds`. At 80% (`SOFT_LIMIT_BPS`) it sends the `usage.warning` notice to the
  workspace's active owners, at most once per period. A failure in this check never fails the
  commit.

## Reconciliation

`reconcileAiCalls(ctx, period = usagePeriod(now))` (`reconcile.ts`, #225) runs one read-only
statement inside `withWorkspace` on `ctx.workspaceId`. It joins the period's `ai_call` rows
([audit.md](audit.md)) to the period's `ai.spend_paise` ledger rows that carry
`metadata.ai_call_id`, summed per id. Ids are compared as text, so a malformed metadata id
cannot fail a uuid cast. The result is `{ period, checked, matched, mismatches }`, where
`mismatches` is ordered by `aiCallId`:

| Kind | Meaning |
|---|---|
| `missing_usage` | An `ai_call` has no ledger row in the period |
| `orphan_usage` | A ledger row names an `ai_call_id` with no `ai_call` in the period |
| `amount_mismatch` | `ai_call.cost_paise` differs from the ledger total |

Each mismatch carries `costPaise` and `usagePaise` (null on the missing side). It never includes
the call's purpose, sources or any other content. Ledger rows without `ai_call_id`, such as other
keys or commits without `aiCallId`, are not part of the reconciliation.

Boundary semantics: each side is filtered by its own `created_at`. A call at 23:59 IST on the last
day of a month whose spend lands after midnight is reported as `missing_usage` in the first month
and `orphan_usage` in the next. Such rows are reported, not hidden.

## How to add a metered resource

1. Add the key to `USAGE_KEYS` and `USAGE_KEY_KINDS` in `packages/core/src/usage/keys.ts`. It must
   match `USAGE_KEY_PATTERN_SOURCE`.
2. Call `increment(ctx, key, amount, { idempotencyKey, metadata })` where the work happens. Use an
   idempotency key derived from the unit of work (a job id, a document id) so retries count once,
   and put ids only in `metadata`.
3. Optionally cap it: add a fair-use cap in `fair-use.ts` backed by an entitlement
   (`packages/billing` plans), and call `assertWithinFairUse` before starting the work.
4. Add tests next to the existing ones in `packages/core/src/usage/__tests__/` (DB tests use
   `withTestDb` and `seedTwoTenants`).
5. Register any new `@causedeck/core` export in `packages/db/src/testing/cross-tenant-registry.ts`,
   in `SERVICE_TESTS` with a case in `packages/core/src/__tests__/cross-tenant/services.test.ts`,
   or in `NOT_A_SERVICE` with the reason it needs none.

## Hard limit never blocks data access

Only `reserve`, meaning a new AI call, consults the AI budget (`budget.ts`, `thresholds.ts`).
When the budget is exhausted:

- reads, search and existing data stay available, and nothing is deleted or hidden;
- export (#31) is never gated;
- manual entry and every non-AI write keep working; `increment` and `getUsage` are never gated;
- entitlements such as `features.write` do not depend on AI spend.

Fair-use caps (`fair-use.ts`) gate only the start of new metered work (new OCR pages, STT
seconds, a new active matter). They never gate access to existing data.
