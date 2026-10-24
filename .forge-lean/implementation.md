### Approach
<<<<<<< HEAD
A global `review_item` queue plus tenant `review_correction` rows. A SECURITY DEFINER `app_review_propagate` writes one correction per watcher of the record. Core `review` domain services, audited admin actions and pages, and a consented report-error action in the web matter page.

### Changes
- packages/db: review_item and review_correction tables, migration 20261024134105_review_queue (renumbered after the base's portfolio migration; SQL unchanged, snapshot and journal regenerated), registry and seeders.
- packages/core/src/review and data-ops/response.ts (enqueue on parse_yield and conflict_rate breaches).
- apps/admin: review queue pages, audited actions, send-to-workbench, nav entry.
- apps/web: reportRecordErrorAction, report-error component, correction display, i18n, vitest.config.ts.
- core-domains lint config and docs.

### Acceptance Criteria Status
- R1 ✅ apps/web/app/(app)/w/[slug]/matters/[id]/actions.ts:187
- R2 ✅ apps/admin/app/(console)/review/page.tsx
- R3 ✅ packages/core/src/review/corrections.ts
- R4 ✅ packages/core/src/review/__tests__/review.test.ts
- R5 ✅ apps/admin/app/(console)/review/actions.ts; review.test.ts:217
- R6 ✅ packages/core/src/review/queue.ts:124; review.test.ts:185
- R7 ✅ packages/core/src/data-ops/response.ts:212

### Verification
V1-V5 pass with TESTCONTAINERS_RYUK_DISABLED=true (see result.json). review.test.ts and the cross-tenant ACTIONS entry fail without the fix.

### Notes
No new env vars. `turbo` is not on PATH here; use `pnpm exec turbo`.

### Post-merge check (turbo exit 127)
The merged-tree failure was `turbo: command not found` (PATH), not a code conflict. Ran `node_modules/.bin/turbo run typecheck --filter='...[origin/milestone/court-data-network]'`: 24/24 tasks pass. V1-V5 re-run and pass. No code changes needed.

### Post-merge check (turbo exit 127)
`turbo: command not found` is an environment issue (not on PATH), not a code conflict. Ran `pnpm exec turbo run typecheck` scoped to db, core, admin, web and i18n: 20/20 tasks pass. `forgedock check`: V1-V5 pass. No code change needed.

### Post-merge check (turbo exit 127, again)
Still `turbo: command not found` (PATH), not a code conflict. `pnpm exec turbo run typecheck` scoped to db, core, admin, web, i18n and adapters: all tasks pass. `forgedock check`: V1-V5 pass. No code change.

### CI fix: tenancy job
The tenancy job's last step (`test:export-coverage`) failed: new tenant table `review_correction` had no exporter. Registered `ws('review_correction')` in `packages/core/src/lifecycle/export/exporters.ts`. Verified the export-coverage test fails without it and passes with it; db cross-tenant/rls, core cross-tenant and web cross-tenant-actions suites also pass locally.
=======
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
>>>>>>> origin/milestone/court-data-network
