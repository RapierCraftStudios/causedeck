### Approach
Reuse the existing `dedicated` plan kind (no migration) for an inactive `institution-case-monthly` plan flagged `perTrackedCase`. The charge is price times tracked cases, computed purely in billing and fed by a core count of `portfolio_case` rows.

### Changes
- packages/validators/src/plans.ts: `TRACKED_CASE_PRICE_PAISE`, optional `Plan.perTrackedCase`, the inactive catalogue row.
- packages/billing/src/plans.ts: `trackedCaseChargePaise`; `mandateChargeNotice` takes optional `trackedCases`; `checkPlanConfig` rejects per-seat plus per-case and skips the cap on the zero minimum.
- packages/billing/src/service.ts: `ChargeCounts`, used by `cycleChargePaise` and `quoteChange`.
- packages/billing/src/invoice/on-payment.ts: per-case invoice line (null with no cases).
- packages/core/src/billing/entitlements.ts: `countTrackedCases`, `getTrackedCaseCharge`.
- Tests: billing plans (snapshot updated for the new row) and on-payment; core billing entitlements (DB).

### Acceptance Criteria Status
- R1 ✅ packages/validators/src/plans.ts (institution-case-monthly row)
- R2 ✅ packages/core/src/billing/entitlements.ts (countTrackedCases, getTrackedCaseCharge), packages/billing/src/plans.ts (trackedCaseChargePaise)
- R3 ✅ charge from count, tested in packages/billing/src/__tests__/plans.test.ts and packages/core/src/billing/__tests__/entitlements.test.ts

### Verification
- V1 billing vitest (plans, service, on-payment, entitlements): 79 passed.
- V2 core vitest (billing entitlements, cross-tenant services, fairness): 200 passed.
- V3 db plans-seed: passed.
- turbo typecheck on changed packages and dependents: 23/23 successful. eslint on changed files: clean.
- New tests would fail without the fix (the functions and the plan row do not exist).

### Notes
- D6 (SERVICE_TESTS registry entry) is not delivered: `@causedeck/core/billing` is a subpath export, not in `packages/core/src/index.ts`, so the guard does not cover it and an entry would reference a non-existent `core.*` export (recorded as an amendment).
- D7 delivered as a standalone two-tenant case in `services.test.ts`: B's count/charge ignore A's portfolio_case rows (RLS), and A's count is unchanged.
- `scripts/check-devdocs-freshness.sh` and `lane-check.sh` do not exist here.
