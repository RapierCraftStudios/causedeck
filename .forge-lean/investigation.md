**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature, part 5 of #498)
**Task Type**: feature

### What Was Claimed
Add notification categories and a worker job/schedule that raises exception alerts for portfolio cases (new adverse order, missed date) to the institution's users; update worker `registry.test.ts`, `schedules.test.ts` and the notification category tests. Acceptance: alerts reach institution users (integration).

### What We Found
- No portfolio alert exists: `packages/core/src/portfolio/index.ts:1-27` exports import, dashboard, export and csv only. `dashboard.ts:2-3` says status fields are "written by the poll and the alerts of later parts".
- Data to alert on is on `portfolio_case`: `nextDate`, `lastAdverseOrderAt`, `lastAdverseOrderRef` (`packages/db/src/schema/portfolio.ts:49-55`). Nothing writes `lastAdverseOrderAt` or `nextDate` yet (grep: only import/dashboard/export/tests touch `portfolioCase`), so the alert source reads these columns as they are.
- Categories live in `packages/notifications/src/categories.ts:23-70`; the exact-list test is `packages/notifications/src/__tests__/categories.test.ts:13-33`. Precedent for similar categories: `status.order`/`status.next_date` (`categories.ts:48-50`).
- Notifying: `notify()` with `dedupeKey` is idempotent per user (`packages/notifications/src/service.ts:212-252`). Precedent job: `judgment-alert-scan.ts` (no-workspace job lists targets via an owner-defined SECURITY DEFINER function `app_judgment_alert_targets`, `migrations/0073_judgment_alerts.sql`, then runs per-workspace, one failure does not stop the others) plus `research/alerts.ts` `scanJudgments`.
- Job registry: `packages/core/src/jobs/registry.ts:30,208,266`; expected-name lists in `apps/worker/src/__tests__/registry.test.ts:118-172` and `schedules.test.ts:41-48`.
- Organization kind `institution` exists (`migrations/20261024110000_portfolio.sql:60`); latest migration is `20261024110000_portfolio.sql`.
- Cross-tenant guard: portfolio entries `packages/db/src/testing/cross-tenant-registry.ts:268-272, 826-829`.

### Root Cause
Feature not built: no alert category, no scan service, no job, no targets function for the portfolio.

### Affected Files
- `packages/notifications/src/categories.ts` (+ `__tests__/categories.test.ts`)
- `packages/core/src/portfolio/alerts.ts` (new), `portfolio/index.ts`, `portfolio/portfolio.test.ts` or a new `alerts.test.ts`
- `packages/core/src/jobs/definitions/portfolio-alert-scan.ts` (new), `jobs/registry.ts`
- `packages/db/migrations/<next>_portfolio_alert_targets.sql` (+ snapshot/journal as the repo requires)
- `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/portfolio.test.ts`
- `apps/worker/src/__tests__/registry.test.ts`, `schedules.test.ts`
- `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md` (jobs -> portfolio dependency)

### Sibling Sweep
Same pattern: `system.judgment-alert.scan`, `system.status.poll`, `system.notices.poll`. Follow `judgment-alert-scan` for the targets function and per-workspace error isolation. Gap to note: no code syncs watch snapshots into `portfolio_case.nextDate`/`lastAdverseOrderAt`; out of this issue's text, so the scan reads the columns and the integration test seeds them. Flag in the PR.

### History
Portfolio model #661, adapters #662, service #663 (merged 29504608). #664 billing went needs-human (unrelated). No prior alert work.

### Recommendation
Add categories `portfolio.adverse_order` and `portfolio.missed_date` (default in_app+email+push for institutions would be heavy; use in_app, email, push like `reminder.hearing`). Add `scanPortfolioAlerts(deps, workspaceId)` in core/portfolio: in `withWorkspace`, find cases with `lastAdverseOrderAt` within the lookback (7d) and cases with `nextDate` before today (IST) that are overdue; notify every active member of the workspace with dedupe keys `portfolio-adverse:<caseId>:<ref|epoch>` and `portfolio-missed:<caseId>:<nextDate>`. Add job `system.portfolio-alert.scan` (daily, e.g. 06:00 IST), targets via new `app_portfolio_alert_targets()` migration (institution orgs, not deleted, having cases). Cap cases per run for volume. Update registries, tests and docs listed above.

### Related Issues
#498 (parent), #663 (dependency, merged), #661, #662, #666 (UI, open), #664.
