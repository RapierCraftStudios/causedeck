**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (a listing or deadline on a holiday named only inside a holiday-list document is not flagged; the date rolls onto a closed day)
**Task Type**: feature

### What Was Claimed
#628 (deferred from #587): holiday-list notices must feed the court calendar so listings on a holiday are flagged. #587 only flags a holiday notice with a single machine-readable `effective_on`; "reading every date out of a holiday-list PDF needs document parsing that no parser does yet".
(The earlier investigation comment on the issue and the old `.forge-lean/investigation.md` describe #68, the obligation queue UI. They are misattributed and ignored.)

### What We Found
Verified on the base (`milestone/follow-up-continuity-memory`, HEAD cc377aae).
- `packages/core/src/notices/holidays.ts:42-52` joins `notice.effectiveOn = listing.listDate` and `forum.code = any(notice.forumCodes)`: one date per notice. Header comment `holidays.ts:3-5` says the dates inside a holiday-list document are not parsed.
- `packages/core/src/deadlines/calendar.ts:70-81` (`loadCourtCalendar`) reads the same single `notice.effectiveOn`; `docs/engineering/core-domains.md:28` documents the single-date limit and the static `FORUM_VACATIONS`.
- `packages/db/src/schema/notices.ts:46-81`: `notice` (global, no workspace_id) has one `effective_on`, plus `document_key/sha256/mime` that nothing sets (`packages/core/src/notices/notices.test.ts:132` asserts null).
- `packages/core/src/notices/poll.ts:1-8,124,140-150`: the poll fetches only the listing page and stores metadata, never the notice document. `NoticeFetcher` returns `body: string` (`poll.ts:26-31`) and `packages/fetch/src/types.ts:43,79` has string bodies only, so a PDF cannot be fetched as bytes through the governed fetcher today.
- Parsing pieces now exist: `layoutFromPdf`, `layoutFromHtml`, `normaliseDate` in `@causedeck/adapters` (used by `packages/intelligence/src/notices/parse-pdf-list.ts:4`, `packages/core/src/court/roster-import.ts:8`); `kindFromTitle`/`effectiveOnFromTitle` in `packages/intelligence/src/notices/types.ts:47-55`. No holiday-list date extractor exists (`git grep -i holiday` in adapters/intelligence: none).
- Cross-tenant registry already lists `listHolidayListings` and `loadCourtCalendar` as `selfScoped` (`packages/db/src/testing/cross-tenant-registry.ts:298-300`); real cases in `packages/core/src/__tests__/cross-tenant/services.test.ts:570-662`.

### Root Cause
The model stores one date per notice and nothing reads the holiday-list document, so only notices with a title-derived single date reach the calendar.

### Affected Files
`packages/db/src/schema/notices.ts` (+ new migration, snapshot, `packages/db/src/index.test.ts` table list, `notices-schema.test.ts`); `packages/intelligence/src/notices/parse-holiday-list.ts` (+index export, test); `packages/core/src/notices/{holiday-dates.ts,poll.ts,holidays.ts,index.ts,notices.test.ts}`; `packages/core/src/deadlines/calendar.ts`; `packages/core/src/__tests__/cross-tenant/services.test.ts`; `docs/engineering/core-domains.md`; `apps/worker` notices poll wiring only if the document fetcher seam is wired there.

### Sibling Sweep
Both readers of notice dates (`holidays.ts`, `calendar.ts`) must change together; `packages/core/src/court/bench-alerts.ts:261` excludes holiday notices from bench alerts, unaffected. No other `effectiveOn` date consumer treats holidays (`apps/api/src/public/v1/notices.ts`, `list.ts` expose the field only).

### History
`1f4cd406` (#587) added `listHolidayListings` and declared the multi-date case out of scope; `loadCourtCalendar` came with #494. No prior attempt at this item.

### Recommendation
One lane. (1) Pure `parseHolidayList(layout lines) -> {date,name}[]` over text lines (dd/mm/yyyy, dd-Mon-yyyy via `normaliseDate`), tolerant, never throws. (2) New global table `notice_holiday` (notice_id FK cascade, holiday_on date, name; unique notice_id+holiday_on), migration with next free number. (3) Poll: for newly inserted `holiday` notices, fetch the document through an optional injected `NoticeDocumentFetcher` (bytes or text), parse, insert dates; failure is logged and skipped, never fails the poll. (4) `listHolidayListings` and `loadCourtCalendar` read `notice_holiday` union the legacy `effective_on`. Binary PDF fetch through `@causedeck/fetch` (string-only bodies) is a separate change; this lane accepts bytes via the seam and covers HTML/text bodies and PDF bytes in tests with synthetic fixtures.

### Related Issues
#587 (origin), #586, #585, #494, #480 (parent).
