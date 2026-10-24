**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (P2 greenfield; B2B institution billing, part 4 of #498)
**Task Type**: feature

### What Was Claimed
Part 4 of #498: "Add a per-tracked-case plan kind to the plan catalogue and metering of tracked cases in packages/billing and core billing entitlements. Acceptance: charge computed from tracked case count with tests." Depends on #661 (merged; `portfolio_case` exists).

### What We Found
- `PLAN_KINDS = ['junior','advocate','chamber','dedicated']` and the catalogue live in `packages/validators/src/plans.ts:12,92`; no plan is priced per tracked case. `kind 'dedicated'` is in the DB check (`packages/db/src/schema/billing.ts:53`, `migrations/0005_billing.sql:41`), the API enum (`packages/validators/src/api/billing.ts:9`) and `FAIRNESS_CONCURRENCY_BY_PLAN` (`packages/core/src/usage/fairness.ts:12-17`) but no catalogue row uses it.
- Charge is computed by `mandateChargeNotice` (`packages/billing/src/plans.ts:60-69`) and `cycleChargePaise` (`packages/billing/src/service.ts:88-93`): only seats and clerk seats; `checkPlanConfig` (`plans.ts:88-133`) assumes per-seat or fixed.
- Invoice line quantity is seats-only (`packages/billing/src/invoice/on-payment.ts:66-67`).
- `portfolio_case` is a tenant table (`packages/db/src/schema/portfolio.ts:37`); there is no count of tracked cases anywhere in core billing (`packages/core/src/billing/entitlements.ts`, seat count via `countBillableSeats` only).
- Web plan picker filters `p.active` (`apps/web/app/(app)/w/[slug]/billing/billing-view.ts:240-246`) and the API lists active plans only (`apps/api/src/routes/v1/billing.ts:55`), so an `active:false` institution plan is not self-serve (matches institutions being provisioned).
- Plan `kind` is a DB check; reusing existing `'dedicated'` avoids a migration plus a 17k-line snapshot and the fairness/API enum churn.

### Root Cause
Pricing model supports only flat and per-seat plans; no per-case price, no tracked-case count, no charge function.

### Affected Files
- `packages/validators/src/plans.ts` (Plan flag, price constant, catalogue row)
- `packages/billing/src/plans.ts`, `src/service.ts`, `src/invoice/on-payment.ts`, `src/entitlements.ts` (only if derive needs it)
- `packages/core/src/billing/entitlements.ts` (count tracked cases, charge), `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`
- tests: `packages/billing/src/__tests__/plans.test.ts`, `service.test.ts`, `on-payment.test.ts`; `packages/db/src/seed/__tests__/plans-seed.test.ts` (maps catalogue, should keep passing); `packages/core/src/billing/__tests__/entitlements.test.ts`

### Sibling Sweep
- Catalogue consumers: `apps/api/src/routes/v1/billing.ts:55`, `billing-view.ts:240`, `db/src/seed/plans.ts:15`, `service.ts:198`, `entitlements.ts:118`: all tolerate a new optional-flag row; inactive row stays out of lists.
- `kind` switch sites: `fairness.ts:12` (Record, already has `dedicated`), API enum `api/billing.ts:9` (has `dedicated`).
- Other per-unit charge paths: `mandateChargeNotice`, `cycleChargePaise`, `quoteChange` counts (`service.ts:~130`) share `SeatCounts`; extend them together.

### History
Catalogue from #28/#200; seat metering #203; `dedicated` kind reserved since 0005_billing. Portfolio tables landed in #661 (f4450766).

### Recommendation
Reuse kind `dedicated` (no migration). Add `perTrackedCase?: boolean` to `Plan`, `TRACKED_CASE_PRICE_PAISE`, and an inactive monthly catalogue row `institution-case-monthly`. Pure `trackedCaseChargePaise(plan, n)`; extend `mandateChargeNotice`/`cycleChargePaise` counts with optional `trackedCases` so the charge = price × cases for such plans; `checkPlanConfig` rejects perSeat+perTrackedCase and does not flag the cap on a zero-case minimum. Core: `countTrackedCases(db, workspaceId)` (RLS-scoped count of `portfolio_case`) and `getTrackedCaseCharge` combining it with the subscription's plan; register in `SERVICE_TESTS` with a two-tenant case. Invoice line quantity uses tracked cases for such plans.

### Related Issues
#498 (parent), #661 (dependency, merged), #662, #663, #665, #666.
