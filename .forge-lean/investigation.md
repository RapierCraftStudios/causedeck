**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P2 feature; greenfield court and process analytics, with a legal guardrail: no judge dimensions)
**Task Type**: feature

### What Was Claimed
Add user-facing court and process analytics (listing delay, adjournments per hearing, time to disposal, backlog by forum, case type, stage and period) with no judge or bench dimension (static test), k-anonymity cell suppression, a forum and case-type insights page, expected timelines on a matter, and institution API aggregate endpoints. Depends on #483, #484, #495. All three are closed (#483 and #495 as not_planned, #484 merged); their case-watch and corpus tables are in the base, and this feature does not need them.

### What We Found
- No analytics code exists: `packages/intelligence/src/analytics/` is absent (`packages/intelligence/src/index.ts:6-8` barrel lists no analytics).
- Source data is already in tenant tables under RLS: `proceeding` (forum_id, case_type_code, filing_date, state: `packages/db/src/schema/proceedings.ts:40-70`), `listing` (list_date, stage_norm, proceeding_id, bench_id, hall_id: `packages/db/src/schema/docket.ts:38-60`), `hearing` (held_on, adjournment_reason, next_date_*: `docket.ts:106-115`) and `proceeding_state_change` (to_state, changed_at: `proceedings.ts:171-186`).
- `listing.bench_id` and `bench_sitting_fact.bench_id` are the bench-level data that the user-facing layer must not read. `bench_sitting_fact` is staff-only and has no app grant (`packages/db/src/schema/bench-facts.ts:1-9`). The only user surface for it is the flagged bench card (`apps/api/src/routes/v1/bench-card.ts`).
- A precedent static guard exists: `packages/intelligence/src/bench-facts/static-guard.test.ts:12-30`. It scans comment-stripped source against a prohibited regex, with a planted-offender mutation case.
- `/w/[slug]/insights` is a placeholder (`apps/web/app/(app)/w/[slug]/insights/page.tsx:1-3`, nav `requires: 'insights.read'` at `apps/web/lib/nav.ts:108`). It is a practice-insights slot, so the court page should be a new route under courts: `courts/` has a `[code]` dynamic segment (`apps/web/app/(app)/w/[slug]/courts/`), and a static `insights` segment takes precedence over it.
- `apps/web` already depends on `@causedeck/intelligence` (`apps/web/package.json:60`). Workspace-scoped reads use `withWorkspace` from `@causedeck/db` (`packages/core/src/court/rosters.ts:109`).
- The public API app has v1 routes (`apps/api/src/routes/v1/index.ts`), but #487 (public developer API with quotas) was closed not_planned, so there is no institution API or quota framework to extend.
- Grep for k-anonymity or minimum-cell code finds nothing. This is the first aggregate-publication code.

### Root Cause
Greenfield: nothing computes process aggregates, and there is no guard that keeps judge and bench fields out of user-facing analytics.

### Affected Files
- `packages/intelligence/src/analytics/` (new): pure aggregation, workspace-scoped query, `MIN_CELL_SIZE`, static guard test.
- `packages/intelligence/src/index.ts`: export.
- `apps/web/app/(app)/w/[slug]/courts/insights/page.tsx` (new) and a component under `apps/web/components/courts/`.
- `packages/i18n/src/messages/{en,ta,kn}/court-insights.json` (new namespace) plus generated files, and `packages/i18n/src/__tests__/catalog.test.ts`.
- No new table or migration. No `@causedeck/core` export (it would trigger the cross-tenant registry).

### Sibling Sweep
- Other places that touch bench or judge data: `packages/core/src/court-day/bench-card.ts`, `apps/api/src/routes/v1/bench-card.ts`, `court/rosters.ts`. They are flagged or internal and out of scope. The new guard must not break their existing guard (`bench-facts/static-guard.test.ts`).
- No other analytics surface exists to harden.

### History
- `bench-facts` (#521) introduced the guard pattern. D-049 and D-050 (`DECISIONS.md:394-426`) set the guardrails. No prior analytics attempt. The `.forge-lean` files in the worktree on arrival were stale (from #636) and are overwritten.

### Recommendation
Implement own-workspace aggregates (the caller's RLS scope), so no cross-tenant data leaves a workspace and k-anonymity is a cell-size floor. Cross-workspace network aggregates need an owner-defined function and a counsel/privacy decision, so defer them.
- Metrics: listing delay is the median days from `proceeding.filing_date` to its first `listing.list_date`. Adjournment rate is the share of hearings with `adjournment_reason` not null. Time to disposal is the median days from `filing_date` to the `proceeding_state_change` row with `to_state='disposed'`. Backlog is the count of non-disposed proceedings.
- Dimensions are only forum, case type, stage and period.
- A cell with n < `MIN_CELL_SIZE` (5) has its values withheld, and the page states "not enough data".
- The page states the data window and coverage (proceedings and hearings counted).
- Defer the matter "expected timelines" (R10) and the institution API (R6).

### Related Issues
#483, #484, #495 (dependencies, closed), #487 (API, closed not_planned), #521 (bench facts, guard precedent), D-049, D-050.
