**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P2 feature; core follow-up-loop pain, but ships behind existing clearance/kill-switch gating)
**Task Type**: feature

### What Was Claimed
Directions in orders must become obligations with exact due dates computed with court holidays, vacations and next-working-day rules. Needs a `packages/core/src/deadlines/` rule engine with per-forum calendars built from the notices feed, an `orders.poll` worker job ingesting new orders for watched matters, proposed obligations (lawyer confirms, L2) carrying the rule and a page anchor, and a fixture table of real phrasings.

### What We Found
- Dependencies: #479 closed/completed; #480 and #483 closed not_planned, but their code landed under other numbers: notices (`packages/core/src/notices/{poll,holidays,match}.ts`, #586/#587) and case-watch (`packages/core/src/case-watch/{poll,lookup,diff}.ts`, #591/#592). Not blocked.
- No `packages/core/src/deadlines/` exists.
- Relative dates are computed in `packages/intelligence/src/extract/relative.ts:1-4,15-16` with calendar days/weeks/months and explicitly "no holiday or vacation adjustment" (`RELATIVE_RULE`). `to-proposals.ts:111-123` turns a dated direction into an `obligation_from_direction` draft with `basis = dueExpression`. That is the only rule text stored today. intelligence must not import core (`extract/index.ts:1-3`).
- Drafts are staged in `packages/core/src/extraction/run.ts:219-237` via `submitProposals`; `obligation_from_direction` is always L2 (`packages/core/src/automation/matrix.ts:54`); the handler writes `obligation.basis` (`automation/handlers/obligation-from-direction.ts:34-38`, schema `packages/db/src/schema/docket.ts:240-244`). `basis` is shown in `apps/web/components/matters/proceeding-row.tsx`.
- Calendar data: `notice` has a single `effective_on` date, no end date (`packages/db/src/schema/notices.ts:61`); `listHolidayListings` only matches exact-date holiday notices (`notices/holidays.ts:1-6,40-66`). The holiday-list document's dates are not parsed ("not parsed yet"), and `packages/intelligence/src/notices/types.ts:37` classifies "vacation" as `holiday`. So there is no vacation range data anywhere.
- Order fetching: case-watch snapshots record `orders` with hrefs and `diffStatus` yields `newOrders` (`case-watch/diff.ts:11-32`), but nothing downloads the order document. Job `system.status.poll` (`jobs/definitions/status-poll.ts:56-90`, `case-watch/poll.ts`) polls status only; caps, kill switch and `delegatedFor` live in `pollCaseWatches`. Fetcher wiring via `setStatusFetcherFactory` (`status-poll.ts:29`, `apps/worker/src/main.ts:54`). Capture ingestion (`capture/create.ts`: `createCapture`/`completeUpload`, sha256 dedupe per workspace) feeds `extraction.extract-order` (`jobs/definitions/extraction-extract-order.ts`).
- Job registration points: `packages/core/src/jobs/{registry.ts:28,197,246,index.ts:139}`, `apps/worker/src/__tests__/{registry,schedules}.test.ts`.

### Root Cause
Greenfield on two axes: (1) no calendar-aware deadline engine; the only date arithmetic ignores holidays, vacations and the next-working-day rule and has no per-forum calendar; (2) no pipeline from a newly listed order on a watched matter to a fetched order document and its extraction.

### Affected Files
- new `packages/core/src/deadlines/{index,period,calendar,compute}.ts` + tests (fixture table)
- `packages/core/src/extraction/run.ts` (re-derive `obligation_from_direction` due date and `basis` through the engine before `submitProposals`)
- new `packages/core/src/case-watch/orders.ts` (fetch new orders delegated, create capture) + `packages/core/src/jobs/definitions/orders-poll.ts`, `jobs/registry.ts`, `jobs/index.ts`
- `apps/worker/src/__tests__/{registry,schedules}.test.ts`, `apps/worker/src/main.ts` if wiring needed
- `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `docs/engineering/jobs.md`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, `packages/core/package.json` export map

### Sibling Sweep
`RELATIVE_RULE` consumers (`extract/validate.ts`, `preparse.ts`, `generic-a0/synthetic/generate.ts`) keep the plain rule for next dates ("list after N weeks" is a listing date, not a compliance deadline; the court sits on the date it names). Only "within"/compliance durations get adjusted. `apps/web` calendar (`calendar/`) and `listHolidayListings` stay unchanged. Limitation tables stay under the separate `limitation.enabled` flag (#84).

### History
Introduced by #46 (relative dates, plain rule by design); #47 (obligation handler); #586/#587 notices and holiday flagging; #591/#592 case-watch. No prior attempt at #494 in this tree.

### Recommendation
One lane, no migration. (1) Pure engine: `computeDueDate({anchorDate, n, unit, calendar, adjust:'next_working_day'})` returning `{date, rule}` where `rule` is a human string ("4 weeks from 22 Oct; court closed 19 Nov, so 20 Nov"). `CourtCalendar` = weekly offs + holiday dates + vacation ranges per forum code; `loadCourtCalendar(db, workspaceId, forumCode, range)` reads matched `holiday` notices (`effective_on`) and accepts vacation ranges from a typed counsel-reviewed static table in code (empty/seeded minimal; notices carry no ranges, so vacations from notices are deferred). Saturdays/Sundays treated as off by a per-forum weekly-off setting, default Sunday only (counsel to refine). (2) In `runOrderExtraction`, for dated "within" directions of a proceeding with a forum, recompute through the engine; keep the extracted date if the phrase cannot be parsed; write rule into `basis`; remain L2. (3) `system.orders.poll` job: for watches whose latest snapshot lists orders with `href` not yet captured, fetch each with `delegatedFor` through the same `StatusFetcher`, create a capture (dedupe by sha256), which queues extraction; same caps/kill-switch/skipped semantics as `pollCaseWatches`; singleton, hourly. Integration test with fakes proves a new order yields proposals with an anchor within one poll.

### Related Issues
#479, #480, #483, #586, #587, #591, #592, #84 (limitation), #46, #47.
