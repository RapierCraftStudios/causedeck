**Verdict**: BLOCKED
**Confidence**: medium
**Severity**: medium (P2 feature, new B2B revenue line; no existing defect)
**Task Type**: feature

### What Was Claimed
Greenfield B2B portfolio litigation tracking for banks, NBFCs and ARCs (DRT, DRAT, NCLT, SARFAESI). Four parts: (1) DRT/DRAT and national NCLT adapters, (2) `apps/web` B2B portfolio import (CSV of case numbers or CNRs), dashboard, exception alerts and exports, (3) a per-tracked-case billing plan, (4) delegated lookups on behalf of the institution's panel advocates, or cleared sources (bulk only after #492). Acceptance: importing 1,000 cases creates watches and a dashboard within rate budgets; exception alerts (new adverse order, missed date) reach the institution's users.

### What Was Claimed — dependencies
#479, #483 and #487 are CLOSED. #483 and #487 were closed as decomposed trackers (#589-#593; #624-#627); #627 is the last merge at HEAD `62b3b04f`, so the dependency gate is clear.

### What We Found
- Case-watch layer exists: `packages/db/src/schema/case-watch.ts:33-79` (`case_watch` is one advocate's own: `advocate_user_id` NOT NULL, unique per workspace+proceeding+source), `packages/core/src/case-watch/watch.ts:20-22` (cap 50 watches per member, hourly minimum cadence), `poll.ts:21-27` (per-advocate 5 / per-source 20 / total 100 watches per run), `alerts.ts:20-60` (alerts only for next_date/order/stage, to the watch's own advocate, never for a sensitive matter).
- No institution/organisation-level workspace kind: `packages/db/src/schema/workspace.ts` has no kind column; plans are only advocate/chamber (`packages/billing/src/plans.ts:1-33`, `MIN_CHAMBER_SEATS`); nothing meters per tracked case.
- No portfolio code: no portfolio table, CSV portfolio import (`packages/core/src/import/` is the matter-import pipeline), dashboard, export or "missed date" alert. `packages/notifications/src/categories.ts` has only `status.next_date|order|stage`.
- Adapters: status parsers exist only for eCourts district, Madras HC, Karnataka HC (`packages/adapters/src/status/`); NCLT only Bengaluru cause lists (`packages/adapters/src/nclt-blr/`). DRT forums are seeded without an adapter (`packages/db/src/seed/forum-catalogue/tribunals.ts:14-66`, `DRT_CONFIG` hosts `drt.gov.in`); DRAT, other NCLT benches and SARFAESI (DM/CMM) have nothing.
- Importing 1,000 cases cannot fit the existing watch model as is: 1,000 > 50 watches per member, and poll caps are per advocate, so the institution's panel-advocate delegation needs a new model.

### Root Cause
Greenfield: the feature needs a new tenant model (institution workspace, portfolio, panel advocates), adapters, billing and UI, none of which exist.

### Affected Files
`packages/db/src/schema/` (new `portfolio.ts`, migration, RLS/registry tests), `packages/adapters/src/{drt,nclt,status}/`, `packages/core/src/portfolio/` (new), `packages/core/src/case-watch/` (bulk/panel path), `packages/validators/src/plans`, `packages/billing/src/`, `packages/core/src/billing/`, `packages/notifications/src/categories.ts`, `apps/worker/src/` (job and schedule), `apps/web/app/(app)/w/[slug]/portfolio/`, `packages/i18n`. Estimated 35+ files and 2,500+ lines.

### Sibling Sweep
Same pattern (per-advocate caps in the watch path) in `watch.ts:20-21` and `poll.ts:21-27`; any institutional change must keep the delegated, never-bulk guarantee of `fetchSource` (bulk solving only after #492).

### History
Case-watch landed via #589-#593 (decomposition of #483); public API via #624-#627. No prior attempt at #498 (no branch or PR; earlier runs only waited on dependencies). `.forge-lean/*` files at the start of this run belonged to #517 and were stale.

### Recommendation
Split. One change would exceed 25 files and 1,500 lines. Six sub-issues: S0 DB model, S1 adapters, S2 core portfolio service, S3 billing, S4 exception alerts and worker job, S5 web UI. See `result.json`.

### Related Issues
#479, #483, #487 (closed dependencies); #38 (NCLT Bengaluru adapter); #492 (bulk captcha, out of scope); #589-#593, #624-#627.
