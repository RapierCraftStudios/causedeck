### Approach
Daily system job `system.portfolio-alert.scan` lists institution workspaces with tracked cases through the owner-defined `app_portfolio_alert_targets()`, then runs `scanPortfolioAlerts` per workspace inside its own scope. Alerts go through `notify()` with per-case dedupe keys, so re-runs add nothing.

### Changes
- packages/notifications/src/categories.ts: categories `portfolio.adverse_order`, `portfolio.missed_date`.
- packages/notifications/src/__tests__/categories.test.ts: exact-list expectation.
- packages/core/src/portfolio/alerts.ts (+ index.ts export, alerts.test.ts): `scanPortfolioAlerts`.
- packages/core/src/jobs/definitions/portfolio-alert-scan.ts (+ test), jobs/registry.ts: the job (cron `0 6 * * *`).
- packages/db/migrations/20261024120000_portfolio_alert_targets.sql, meta journal and snapshot: targets function and owner read policy.
- packages/db/src/testing/cross-tenant-registry.ts, core cross-tenant/portfolio.test.ts: registry entry and a real case.
- apps/worker registry.test.ts, schedules.test.ts: new job name.
- packages/config/eslint/core-domains.js, docs/engineering/core-domains.md: jobs -> portfolio.
- Required by the new category keys (amended as add-deliverable): packages/notifications/src/push/payload.ts, apps/web preferences-form.tsx, packages/i18n messages (en/kn/ta notifications.json, generated, translation-status.json).

### Acceptance Criteria Status
- R1 ✅ packages/core/src/portfolio/alerts.ts, jobs/definitions/portfolio-alert-scan.ts, categories.ts
- R2 ✅ apps/worker/src/__tests__/registry.test.ts:169, schedules.test.ts:45, categories.test.ts:26
- R3 ✅ packages/core/src/portfolio/alerts.test.ts, cross-tenant/portfolio.test.ts

### Verification
- V1 notifications categories.test.ts: pass.
- V2 core portfolio, job test, cross-tenant portfolio, domains.test.ts: pass (25 tests).
- V3 worker registry and schedules tests: pass.
- V4 config eslint-boundaries test: pass.
- Scoped turbo typecheck: pass. i18n catalog test: pass.
- The new tests fail without the fix: `scanPortfolioAlerts` and the job do not exist on base.

### Notes
New daily job at 06:00. Migration adds a SELECT policy for `causedeck_owner` on `portfolio_case`. Removed accidentally committed `.eslintcache` files.

## Fix: stale-list guard
PORTFOLIO_ALERT_MAX_CASES is a constant already in NOT_A_SERVICE, so it is not a member of the cross-tenant portfolio CASES list; recorded in result.json not_members.

## CI fix
Migration lint required a `-- Reviewed-by:` header on 20261024120000_portfolio_alert_targets.sql; added it. lint-migrations test passes.
