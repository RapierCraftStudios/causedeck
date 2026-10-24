**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature, part 4 of 5 of #480: matched notices exist but nobody is told and holidays are not flagged)
**Task Type**: feature

### What Was Claimed
Part 4 of #480: `packages/notifications` gets a `notices` preferences category and alerts (in-app, email digest, push) by forum and matter; a new notice for a forum the workspace uses yields exactly one alert per member per their preferences (AC, integration); holiday-list notices feed the court calendar so listings on a holiday are flagged (AC, integration); i18n namespace/catalog entries.

### What We Found
- #586 is merged on base: `packages/core/src/notices/{poll,match,index}.ts` poll, store (`poll.ts:127-143`) and match (`match.ts:30-77`, writes `notice_match` per workspace inside `withWorkspace`). `matchNotices` returns only counts (`match.ts:15-20`), and `pollNotices` discards which notice matched which workspace (`poll.ts:144-149`). Nothing sends an alert. The job `jobs/definitions/notices-poll.ts:56-66` has no `enqueueDelivery`.
- Notification registry: `packages/notifications/src/categories.ts:30-50` has no `notices` category. A new category must also be added to `push/payload.ts:25-28` (title map), `__tests__/categories.test.ts:21-28`, the web preferences form map `apps/web/app/(app)/w/[slug]/settings/notifications/preferences-form.tsx:84-87`, `apps/web/__tests__/notification-preferences.test.tsx:98-101`, and i18n `packages/i18n/src/messages/{en,ta,kn}/notifications.json:139-151` (category label and description). `notifications` is already a catalogued i18n namespace (`catalog.ts:14`), so no new namespace is needed.
- `notify()` (`packages/notifications/src/service.ts:212-250`) does preference resolution and in-app/email/push channels, with `dedupeKey` unique per (workspace, user): a repeated key writes nothing, which gives "exactly one alert per member" even when the poll repeats. Email "digest" is the existing member `digest` preference (`service.ts:241-244`: only `instant` is enqueued, `daily` waits for the digest job), so no new digest code is needed.
- Best precedent for a core producer: `packages/core/src/court/bench-change.ts:387-440` (active members, `can(reader,'matter.read')`, `notify` per member, one failed notify never stops the rest) and `case-watch/alerts.ts:60-100` (no party names in titles, `dedupeKey`). `jobs/definitions/judgment-alert-scan.ts:19-34` shows how a job builds `enqueueDelivery` from `getProducer()` + `notificationDeliverSchema`.
- Holiday flag: `listing` (`packages/db/src/schema/docket.ts:50-97`: `proceeding_id`, `list_date`, canonical) joins to `proceeding.forum_id` (`proceedings.ts:46`). `notice` carries `kind='holiday'`, `forum_codes`, `effective_on` (`schema/notices.ts:64-71`). The parsers set `effectiveOn` only from a "w.e.f." phrase in the title (`intelligence/src/notices/types.ts:53-56`); the contents of a holiday-list document are not parsed, so only a holiday notice with one `effective_on` date is machine-readable today. There is no holiday table and no existing read that flags listings (`matter-graph/read-models.ts:407-431` selects next dates without it). The calendar UI is #588/web and out of scope.
- Registries: `packages/db/src/testing/cross-tenant-registry.ts:238` (`matchNotices: selfScoped`) and `:935-941` (`NOT_A_SERVICE` entries for notices) show where new core exports go; test case at `packages/core/src/__tests__/cross-tenant/services.test.ts:427`. `packages/config/eslint/core-domains.js:33` has `notices: ['sources']` and `docs/engineering/core-domains.md:26,187` must change if notices imports `workspaces` (members, role settings).
- Base ref checked: HEAD f0fb0e86 equals the base for this lane; latest migration is 0078, and this plan needs none.

### Root Cause
Greenfield: #584-#586 built storage, parsing and matching; the alert producer, the `notices` category and the holiday-listing read are the remaining piece.

### Affected Files
- `packages/notifications/src/{categories,push/payload}.ts` and `__tests__/categories.test.ts` (category `notices`, default `in_app` + `push`)
- `packages/i18n/src/messages/{en,ta,kn}/notifications.json`; `apps/web/app/(app)/w/[slug]/settings/notifications/preferences-form.tsx` (category-to-key map only), `apps/web/__tests__/notification-preferences.test.tsx`
- `packages/core/src/notices/match.ts` (report which notice matched which workspace), `notices/alerts.ts` (new `notifyNoticeMatches`), `notices/holidays.ts` (new `listHolidayListings`), `notices/poll.ts`, `notices/index.ts`, tests in `notices/notices.test.ts`
- `packages/core/src/jobs/definitions/notices-poll.ts` (wire `enqueueDelivery`), `packages/core/src/jobs/registry.ts` only if the job test lists deps
- `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md` (notices -> workspaces), `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts` (new core exports)

### Sibling Sweep
Same producer pattern: `notifyStatusChanges` (#592), `notifyBenchChange` (#590), `scanJudgments` (#497). Every category addition touches the same six lists (`status.*` in #592, commit 321fdae1). A grep for each existing category key (`judgment.alert`) shows the full list; the plan follows it. Holiday detection must not be added to `matter-graph` (domain boundary); keep it in `notices`.

### History
`notice`/`notice_match` schema: #584 (0071). Parsers: #585. Poll/match/job: #586 (merged, 522be10b). No prior attempt at #587. Category-addition precedent: 321fdae1 (#592).

### Recommendation
1. Add category `notices` (in-app + push by default; email opt-in via preferences; daily digest via the existing `digest` preference), with push title, i18n label/description in en/ta/kn, form map entry and test lists.
2. `matchNotices` also returns `matched: {workspaceId, noticeId}[]` for newly inserted rows only. New `notifyNoticeMatches(deps, matches)` in `notices/alerts.ts`: per workspace, load notice title/kind and matched matters count, then notify every active member who may `matter.read` (`can` + role settings, as bench-change does) once per notice with `dedupeKey: notice:<noticeId>`. Title is the public notice title; the body says how many of the member's matters are before that forum (counts only, never party names; sensitive matters are not named). A failed notify is skipped. `pollNotices` calls it when `deps.enqueueDelivery` is given and reports `alerts`.
3. `listHolidayListings(db, workspaceId, {from,to})` in `notices/holidays.ts`: under `withWorkspace`, listings dated in range whose proceeding forum code is in a matched `holiday` notice's `forum_codes` and whose `list_date` equals that notice's `effective_on`; returns listing, proceeding, matter ids and the notice (id, title) so the calendar can flag them. Documented limitation: multi-date holiday lists need document parsing (separate work).
4. Worker/job: `runNoticesPoll` builds `enqueueDelivery` like `judgment-alert-scan.ts`.
5. Register the new exports in the cross-tenant registry and add real B-on-A cases; update domain deps/docs.

### Related Issues
#480 (parent), #586 (done, dependency), #585, #584, #588 (UI consumes `listHolidayListings` and matches), #592/#590 (precedents).
