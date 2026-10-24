**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P2: internal tooling, no user-facing defect; blocks roadmap/partnership targeting, #513)
**Task Type**: feature

### What Was Claimed
Greenfield coverage tracker (D-049): (1) an `apps/admin` Coverage matrix of forums (grouped by state and court type) against data types, each cell showing level, freshness and volume, filterable by state; (2) a gap list ranked by demand (watches and users in that forum) times missing level; (3) a weekly staff email with the change since last week. Acceptance: every catalogue forum appears with a level per data type [integration]; gap ranking uses live demand (watch counts) [unit]. Depends on #478 (closed, source registry) and #495 (closed not_planned, but its parts #634/#635/#636 are merged at HEAD).

### What We Found
- The existing `.forge-lean/*` and the earlier "Investigation Report" comment on #517 describe #636 (district status sources); they are stale and superseded. Those changes are already at HEAD (`packages/db/migrations/20261024090000_ecourts_district_status_sources.sql`, journal idx 85).
- No coverage code exists: `grep -ri coverage apps/admin packages/core/src` finds no tracker. Admin routes are `apps/admin/app/(console)/{adapters,sources,data-ops,flags,...}`; nav is `apps/admin/components/console-nav.tsx:29-39`; roles in `apps/admin/lib/roles.ts:28` (ops has `data-ops`, `sources`).
- Forum facts: `forum` (`packages/db/src/schema/court.ts:34-62`: `code`, `court`, `establishment`, `jurisdictionKind`, `adapterId`, `adapterLevel`, `enabled`; `workspace_id` null = system catalogue). Forum codes look like `in.ka.karnataka-hc.bengaluru`, `in.tn.chennai.family-courts`; state is the 2nd segment (`packages/db/src/seed/forum-catalogue/ecourts/snapshot.ts:8-40`).
- Source facts: `source` (`packages/db/src/schema/source-registry.ts:50-90`: `id`, `kind`, `accessMode` A0-A3, `clearedAt`, `killSwitch`, `slo*`). Source ids are `<scope>:<data_type>` with data types seen in migrations: `case_status`, `cause_list`, `display_board` (e.g. `in.ka.karnataka-hc.bengaluru:cause_list`, `in.tn.madras-hc.chennai:display_board`), state-wide district ids `in.<st>.district:case_status`, and Chennai `in.tn.chennai-district:case_status`; notices are a `notice` kind whose rows carry `forum_codes` (`packages/db/src/schema/notices.ts:54,74`). There is no `order` source yet, so that data type will show "none".
- Freshness/volume: `fetch_log` (`packages/db/src/schema/fetch-log.ts:9-25`, index on `source_id, fetched_at`; status 0 or >=400 is an error per `packages/core/src/sources/ops.ts:128`). `sourceOpsOverview` (`ops.ts:204`) already computes per-source health from it and is the template.
- Demand: `case_watch.source_id/advocate_user_id` (`packages/db/src/schema/case-watch.ts:34-50`) and `cause_list_watch.source_id/user_id` (`cause-list-watch.ts:27-42`) are tenant tables under FORCE RLS, so staff can only read aggregates through a SECURITY DEFINER function that calls `app_staff_require_caller()`, exactly as `app_staff_conflict_rate` (`packages/db/migrations/0082_staff_conflict_rate.sql`) and its wrapper `staffConflictRate` (`ops.ts:165`), called via `staffCall` (`apps/admin/lib/data/scope.ts:94`).
- Admin read pattern: pages import only from `apps/admin/lib/data/index.ts` (`dataOpsOverview` at `:187`), never `withoutWorkspace`; guard tests `apps/admin/__tests__/{data-layer,server-component-imports,no-content-fields,no-without-workspace-outside-data}.test.ts` constrain new pages (no content fields: counts/ids/levels only).
- Weekly email pattern: `packages/core/src/jobs/definitions/business-digest.ts` (cron `0 9 * * 1`, `defineJob`, injected `email`/deps, `notificationJobDeps`), registered in `packages/core/src/jobs/registry.ts:23-24,177-178,233-234` and enumerated in `apps/worker/src/__tests__/registry.test.ts:139` and `schedules.test.ts:30`. Recipients there come from env (`BUSINESS_FOUNDER_EMAILS`); staff accounts are `staff_user` (`schema/staff.ts:52-61`, role, `disabled_at`) joined to `user.email`.
- No history of past levels is stored, so "change since last week" needs either a snapshot store or derivation (see Recommendation).

### Root Cause
Not a defect: the facts exist (forum catalogue, source registry, fetch log, watch tables) but nothing joins them into a coverage view, a demand-ranked gap list or a weekly report.

### Affected Files
- `packages/core/src/sources/coverage.ts` (new; exported from `sources/index.ts`): pure `buildCoverage`/`rankGaps`/`diffCoverage` plus a reader.
- `packages/db/migrations/<next-timestamp>_staff_watch_demand.sql` + journal entry + snapshot: `app_staff_watch_demand()`.
- `apps/admin/lib/data/index.ts`: audited `coverageOverview` read; `apps/admin/lib/roles.ts` / `components/console-nav.tsx`: capability and nav item `coverage` (or reuse `data-ops`).
- `apps/admin/app/(console)/coverage/page.tsx` (new), `apps/admin/__tests__/coverage-page.test.tsx` (new).
- `packages/core/src/jobs/definitions/coverage-weekly.ts` (new), `jobs/registry.ts`, `apps/worker/src/__tests__/{registry,schedules}.test.ts`.
- `packages/core/src/sources/__tests__/coverage.test.ts` (new); `packages/db/src/testing/cross-tenant-registry.ts` (new core runtime exports need `SERVICE_TESTS` or `NOT_A_SERVICE`), `packages/core/src/__tests__/cross-tenant/services.test.ts` if a real case is chosen; core domain deps (`CORE_DOMAIN_DEPENDENCIES`, `docs/engineering/core-domains.md`) only if `sources` gains a new cross-domain import.

### Sibling Sweep
- Data Ops (#514) and adapter health (#499) are source-keyed, not forum-keyed; the coverage view reuses their wrappers rather than duplicating SQL. The `source`/`forum` code mismatch (state-wide `in.<st>.district:*` vs per-forum codes) is the one place a new mapping rule is needed; it must be a single tested function.
- Other staff-readable aggregates over tenant tables all use a definer function (0072 parse yield, 0082 conflict rate): follow it, never read `case_watch` directly from admin.

### History
`source` registry: #478 (D-048). Fetch log: #479. Case watch: #483/#589/#591. Cause-list watch: #482. Display board: #493. Notices: #584. Data Ops: #514/#515. District importer #635, parsers #634, district status sources #636. Weekly digest pattern: #519.

### Recommendation
1. Coverage model (core, pure + tested): a forum covers a data type through a source whose id is `<prefix>:<type>` where prefix equals the forum code, is a dotted ancestor of it, or is `in.<st>.district` for district-kind forums of state `<st>`. Data types: `cause_list`, `case_status`, `order`, `display_board`, `notice`. Cell level = highest `access_mode` among matching sources that are cleared (`cleared_at` set) and not killed; otherwise `none`. Freshness = latest successful `fetch_log.fetched_at` (status 200-399) of those sources; volume = successful fetches in 7 days; notices volume from `notice.forum_codes`. Every enabled catalogue forum (workspace_id null) gets all 5 cells.
2. Demand: migration with `app_staff_watch_demand()` returning `source_id, watches, users` (count and distinct user) over `case_watch` (enabled) and `cause_list_watch`, refusing non-staff, aggregates only. `rankGaps` scores forum x type = demand(watches, users) * (A3 target level index - current level index), `none`=0 ... A3=3 target; drops zero-demand cells to the tail; deterministic tie-break by forum code.
3. Admin page `/coverage`: matrix grouped by state then court type, state filter via a `?state=` search param (server component, no client JS), plus the ranked gap list. Audited read through `lib/data` with purpose `coverage.overview`.
4. Weekly report: `system.coverage.weekly`, Mondays 09:30 IST (cron `30 9 * * 1`), emails enabled staff (ops/admin) with top gaps and the change since last week. Change since last week is derived without a new table: cells whose covering source `cleared_at` or first successful fetch fell inside the last 7 days count as new, and levels are recomputed "as of" 7 days ago by ignoring sources cleared later; this avoids a snapshot table (and the table/RLS/registry updates). If reviewers prefer exact history, a `coverage_snapshot` global table is the alternative.
5. Tests: unit for mapping, level, ranking uses live watch counts (stubbed demand rows with different counts reorder the list), integration/page test that every forum in a seeded catalogue appears with five levels, job test with injected email.
Risk: source-to-forum mapping is heuristic until sources carry an explicit forum column; keep it in one function with tests. Medium confidence for that reason.

### Related Issues
#478, #495 (deps); #513 (partnerships workstream, consumer); #514/#515 (Data Ops), #499, #519 (weekly digest pattern), #583/#584 (notices), #482/#493, #635/#636.
