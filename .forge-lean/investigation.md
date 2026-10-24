**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature; notices exist but nothing links them to benches, halls or listings)
**Task Type**: feature

### What Was Claimed
#496 (D-048, after #480): map roster and leave/special-bench/roster-reassignment notices to the listed and upcoming matters they affect (forum, hall, judge, case category); add a `bench_change` notification category (in-app, push, daily summary); show an alert card on the matter and court-day view with the notice as its source.

### What We Found
- The dependencies are closed and merged on the base: #584-#588 (`packages/core/src/notices/{poll,match,alerts,holidays,list}.ts`). The stale `.forge-lean/*` files at the start of this run described #588 and were replaced. The `INVESTIGATION` comment on #496 also describes #588, not this issue.
- `packages/core/src/court/bench-alerts.ts` does not exist. Roster-change alerts already exist (`court/bench-change.ts:1-20` header, `detectBenchChanges` at `:213`, `listAlerts`, `dismissAlert`; `bench_change_alert` at `packages/db/src/schema/roster.ts:147`). They cover only a newly confirmed roster, by hall or portfolio rule. Nothing reads `notice` for benches. They notify under `reminder.hearing` (`bench-change.ts:343`).
- A notice has no structured bench data: `packages/db/src/schema/notices.ts:50-70` holds only `forumCodes`, `kind` (circular|practice_direction|roster|holiday|registry|bar_council|gazette|other), `title`, `issuedOn`, `effectiveOn`, `url`. Parsers set kind and forum codes only (`packages/intelligence/src/notices/types.ts:36-44`, `tag.ts:1-5`). There is no leave or special-bench kind, and no hall, judge or case-category field.
- Matching notices to workspaces is by forum only (`notices/match.ts:44-76`): `notice_match` rows `forum` and `matter_forum` per matter with a proceeding in that forum. Narrowing to hall or category must be derived from the notice title.
- Listings carry `hallId` and `listDate` (`packages/db/src/schema/docket.ts:50-79`, hall number via `court_hall.hall_no`, `court.ts:54-67`); proceedings carry `forumId` and `caseTypeCode` (`proceedings.ts:46-51`). `portfolioRuleMatches` (`court/bench-change.ts:127`) and `caseTypeKey` (`:122`) already compare case types.
- Read-time precedent for "notice affects listing, not stored": `notices/holidays.ts:30-74` (`listHolidayListings`). Alert delivery precedent: `notices/alerts.ts:44-109` (`notify()`, `dedupeKey: notice:${noticeId}`, `matterVisibilityPredicate`).
- Hook point: `notices/poll.ts:151-161` calls `matchNotices` and then `notifyNoticeMatches`. The job wrapper is `jobs/definitions/notices-poll.ts:50-71`; domain `jobs` may import `court` and `notices`, but `notices` may import only `workspaces` and `sources` (`packages/config/eslint/core-domains.js:33`, `:93-116`), so `notices` must not import `court`.
- Notification categories are a closed list: `packages/notifications/src/categories.ts:25-60` has no `bench_change`. Guard test: `packages/notifications/src/__tests__/categories.test.ts:15-30`. UI map: `apps/web/app/(app)/w/[slug]/settings/notifications/preferences-form.tsx:88`; copy: `packages/i18n/src/messages/*/notifications.json` (`notices` entry near line 155). Digest is per category and generic (`service.ts:12-13`, `:172-196`), so a daily summary is the existing `digest: 'daily'` preference.
- Web: bench-change banner `apps/web/components/courts/bench-change-banner.tsx`; matter overview cards `apps/web/components/matters/matter-overview.tsx:18,40,184-239` (notices card slot from #588); matter page `apps/web/app/(app)/w/[slug]/matters/[id]/page.tsx`; the court-day view is `apps/web/app/(app)/w/[slug]/today/page.tsx` (`LiveHalls`).
- PX-9 / ME-6 / D-050 (`docs/product/03-prd.md:278,319`, `docs/adr/0017-effective-dated-rosters.md:15`): judge-level data is internal only; the bench-change code never reads judges (`bench-change.ts:12`). Mapping a leave notice by judge name needs `bench.judges` and counsel clearance.

### Root Cause
Greenfield. Notices are stored and matched per forum (#584-#588) and rosters per hall (#389), but no code classifies a notice as leave, special bench or reassignment, narrows it to hall or case category, links it to listings, or alerts under a bench category.

### Affected Files
- `packages/core/src/court/bench-alerts.ts` (new), `court/index.ts`, `court/bench-alerts.test.ts` (new)
- `packages/core/src/notices/poll.ts` (an optional `onMatched` hook), `notices/index.ts` if types are exported, `packages/core/src/jobs/definitions/notices-poll.ts` (wires `notifyBenchNoticeAlerts`)
- `packages/notifications/src/categories.ts`, `__tests__/categories.test.ts`
- `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`
- `apps/web/components/courts/bench-notice-alerts.tsx` (new, with test), `matters/[id]/page.tsx`, `components/matters/matter-overview.tsx`, `today/page.tsx`
- `packages/i18n/src/messages/{en,ta,kn}/{notices,notifications}.json`, generated files, `translation-status.json`, `preferences-form.tsx`
- `docs/engineering/core-domains.md` (court row)

### Sibling Sweep
Same defect class (a stored notice not read anywhere): `listHolidayListings` is the only read-time notice consumer today and is not used in `apps/web`; it is out of scope. Case-watch status alerts (#592) follow the same notify/dedupeKey pattern and are untouched. No other code reads `notice.title` for hall or category.

### History
`bench-change.ts` was added in c9928931 (#389). Notices #584-#588 landed on `milestone/court-data-network` (latest merge 223595b5). No prior attempt at #496.

### Recommendation
- Compute on read, no migration: `classifyBenchNotice(title)` is a pure rules classifier returning `leave | special_bench | roster_reassignment` plus the hall numbers and case types named in the title, or null. No AI. `listBenchNoticeAlerts(db, actor, {matterId?, from?, to?})` reads `notice_match` (`matter_forum`) joined to `notice`, `listing`, `proceeding` and `court_hall`. It keeps listings on or after `effectiveOn ?? issuedOn` in the notice's forum, where the hall number is in the named set and, if case types are named, `portfolioRuleMatches`. A notice naming neither hall nor case type affects nothing, so unaffected matters get no alert. It applies the matter visibility predicate and returns the notice id, title, url and source name.
- `notifyBenchNoticeAlerts(deps, matched)` notifies each active member who may read an affected matter, once per member and notice, through `notify()` category `bench_change`, `dedupeKey: bench-notice:${noticeId}`, counts-only body (no party names), `href` to the matter or `/w/<slug>/today`.
- Wiring: add `onMatched?: (matched: MatchedNotice[]) => Promise<void>` to `PollNoticesDeps`, called in `poll.ts` next to the existing alerts; `jobs/definitions/notices-poll.ts` passes the court function. This avoids a `notices` -> `court` import.
- Judge: not matched, because PX-9 and D-050 forbid it without counsel clearance (see the R4 deferral in the contract).
- Web: `BenchNoticeAlerts` card (notice linked as an external `rel="noopener noreferrer"` link, source name, kind label), shown on the matter overview and the `today` page; hidden when empty. Add i18n in en/ta/kn.

### Related Issues
#480 (closed, not planned; the parent text is quoted in the issue context), #584-#588 (closed dependencies), #389 (roster bench-change alerts), #493 (court-day view), #593.
