**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (P3 greenfield feature; no live defect)
**Task Type**: feature

### What Was Claimed
Issue #66: build the week and month calendar view at `/w/[slug]/calendar` (listings, confirmed next dates, obligation due dates, holiday/vacation markers), backed by a new `getCalendarRange` over the court-day service, with day popover, Board hand-off, kind legend, Proposed styling, Mine/Whole-chamber scope, ICS feed hand-off, all states, keyboard model, stories, e2e/visual/a11y, i18n. Deps #58 and #145 are closed. A prior bot comment on the issue (WhatsApp card) belongs to a different issue; ignore it, as well as the stale `.forge-lean/*` files for it.

### What We Found
- `apps/web/app/(app)/w/[slug]/calendar/page.tsx:1-3` is only `placeholderPage('calendar')`; no `calendar/` components, no `loading.tsx`/`error.tsx`. History: `7f6fe4ed` (#154).
- No `getCalendarRange`/`CalendarRange` anywhere (`grep` over packages and apps), no `packages/validators/src/calendar.ts`.
- Court-day service exists (#58): `packages/core/src/court-day/query.ts:81` `getCourtDay` (single date; scope `mine|workspace`; `court_day.view_all` check at `:~104`; `strategy.read` gates strategy fields at `:~110`; restricted matters filtered via `can('listing.read')` at `:~196`). `scope.ts:84` `inCourtDayScope`; `clashes.ts` `detectClashes`. Barrel `court-day/index.ts` re-exports `query.ts` (so a new export needs a cross-tenant registry entry).
- Next dates: `packages/db/src/schema/docket.ts:113-114` `hearing.nextDateProposed` / `nextDateConfirmed` (provenance for Proposed vs confirmed). Obligations: `docket.ts:242` `obligation.dueDate`, status `open`, index `obligation_workspace_due_date_idx`.
- Holidays/vacations: `packages/core/src/deadlines/calendar.ts:60` `loadCourtCalendar` (holiday notices + static `FORUM_VACATIONS`, `closedReason`); `packages/core/src/notices/holidays.ts:29` `listHolidayListings`. Using them from court-day adds a domain edge (court-day currently depends only on sources, matter-graph, workspaces, audit: `docs/engineering/core-domains.md:102-105`).
- ICS feed: `packages/core/src/calendar/feed.ts:83` `getFeedStatus`; token shown only once on create/rotate (settings page `settings/integrations/calendar/*`). The existing i18n namespace `calendar` (`packages/i18n/src/messages/en/calendar.json`, `catalog.ts:29`, `catalog.test.ts:92`) is the ICS settings copy, so the issue's `packages/i18n/messages/...` path is wrong and the view needs a new namespace.
- UI patterns available: `packages/ui/src/patterns/{stage-badge,provenance-chip,obligation-row,court-item-chip,states}`; stories live next to components (`*.stories.tsx`). e2e lives in `e2e/tests/<area>/` (no `e2e/product`).
- Web precedent for server pages: `apps/web/app/(app)/w/[slug]/today/page.tsx` (`getWorkspaceContext`, dynamic `@causedeck/core/runtime`, logged fallbacks).

### Root Cause
Greenfield: the route is a placeholder and there is no range read model.

### Affected Files
`packages/validators/src/{calendar.ts,index.ts}`; `packages/core/src/court-day/{calendar.ts,calendar.test.ts,index.ts}`; `calendar/{page,loading,error}.tsx` and `_components/*` under the web route; `packages/ui` calendar stories (or story files beside the web components if ui must stay app-free); `packages/i18n/src/messages/{en,ta,kn}/calendarView.json`, `catalog.ts`, `__tests__/catalog.test.ts`, generated catalogs; registry/guards listed below; e2e specs.

### Sibling Sweep
Other placeholder routes exist but are separate issues (#59 Board, #65 offline cache, #84 limitation). Guards to update: `packages/db/src/testing/cross-tenant-registry.ts` (`SERVICE_TESTS` near `getCourtDay` :502) + `packages/core/src/__tests__/cross-tenant/services.test.ts` (:1934 pattern); `packages/core/src/domains.test.ts` + `docs/engineering/core-domains.md` if court-day imports deadlines/notices; no `'use server'` action is needed (read-only RSC), so no `cross-tenant-actions` entry.

### History
Placeholder from #154. Court-day service #58 (ADR 0037); ICS feed #53 (PR #524); holiday notices #587; deadline calendar #494.

### Recommendation
Implement in order: validators; `getCalendarRange` (one query set per source: listings, hearings' next dates, open obligations, forum calendar; reuse `inCourtDayScope`, the same mine/readable predicates and `detectClashes` rather than calling `getCourtDay` per day; redact restricted matters; clerk gets no strategy fields; proposed dates flagged and excluded from confirmed counts; cap range at 42 days via zod); then the page (week/month/agenda, popover with Board link using `today`/`tomorrow` aliases, legend, states, keyboard grid), i18n, stories, e2e. Offline: #65 is open, so show the offline notice when no cached range exists. Perf/bundle budgets are measured in CI.

### Related Issues
#1 (parent), #58, #145 (deps, closed), #53 (feed), #59 (Board, open), #65 (offline cache, open), #84 (limitation, out of scope), #34 (forum calendar data).
