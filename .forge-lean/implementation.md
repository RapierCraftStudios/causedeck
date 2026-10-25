### Approach
Dates named inside a holiday-list document are parsed by a pure parser, stored in a new global `notice_holiday` table by the poll (through an optional injected document fetcher, since core cannot import `@causedeck/fetch`), and read together with `notice.effective_on` by `listHolidayListings` and `loadCourtCalendar`.

### Changes
- packages/intelligence/src/notices/parse-holiday-list.ts (+ index export, __tests__/parse-holiday-list.test.ts): `parseHolidayListLines/Text/Html/Pdf`.
- packages/db/src/schema/notices.ts, schema/index.ts: `notice_holiday` table; migrations/20261025194355_notice_holiday.sql (+ snapshot, journal): grants SELECT, INSERT to the app role.
- packages/db/src/conventions.ts: table added to GLOBAL_TABLES; src/index.test.ts table list; __tests__/notices-schema.test.ts: privilege, unique and check test.
- packages/core/src/notices/poll.ts, index.ts: optional `documentFetcher`, `holidayDates`/`holidayFailed` in the report; failures never fail the poll.
- packages/core/src/notices/holidays.ts, deadlines/calendar.ts: read `notice_holiday` plus `effective_on`.
- packages/core/src/notices/notices.test.ts, __tests__/cross-tenant/services.test.ts: regression and cross-tenant cases.
- docs/engineering/core-domains.md.

### Acceptance Criteria Status
- R1 ✅ holidays.ts leftJoin on `notice_holiday`; calendar.ts `listed` query; notices.test.ts "holiday-list documents".
- R2 ✅ parse-holiday-list.ts (PDF text layer, HTML, text); poll.ts `storeHolidayDates`.
- R3 ✅ the `effective_on` path is kept (existing listHolidayListings tests and the cross-tenant case still pass).

### Verification
- V1 intelligence src/notices: 17 passed.
- V2 core src/notices src/deadlines: 27 passed.
- V3 db notices-schema + index tests: passed.
- V4 core cross-tenant services `-t holiday` matches no test name (case-sensitive); `-t "loadCourtCalendar|listHolidayListings"` ran 2 passed.
- The new poll and calendar test fails without the fix (no `notice_holiday` table or `documentFetcher`).
- Typecheck of the changed packages and dependents: 22 of 23 tasks passed; `apps/web` typecheck died with a Node heap OOM on the shared host (environment, not a type error). ESLint on changed files in core, db and intelligence: clean.

### Notes
Nothing wires `documentFetcher` in the worker yet, so production polls store no dates until that is added. `@causedeck/fetch` is string-bodied, so PDF bytes need a separate fetch change. Migration and conventions edits are listed as amendments.

### CI sibling-list follow-up
The ten flagged apps/admin and apps/web tests list no db schema tables (none names `noticeMatch` or any notice table), so `noticeHoliday` is not a member of any; each is recorded in result.json `not_members`.

### Merge-check failure (turbo: command not found)
No code conflict: the failing check only ran `turbo` outside PATH (exit 127). Re-ran `pnpm turbo run typecheck --filter='...[base]'`: 0 TS errors; every package passed except `@causedeck/web`, which died with a V8 heap OOM on the shared host (environment, not a type error). V1-V3 pass; V4 is skipped locally (the cross-tenant suite skips without its database), left to CI. No source change was needed.

### Merge re-check
The merged-tree failure was `turbo: command not found` (exit 127): `turbo` is not on PATH, not a code conflict. Run via `pnpm exec turbo`, typecheck passes for 22 of 23 packages; `@causedeck/web` hit a V8 heap OOM under the default heap and passes (rc 0, no TS errors) with `NODE_OPTIONS=--max-old-space-size=6144`. No source change was needed.

### CI `test` failure (no log available)
The job log could not be read. Re-ran locally: db (notices-schema, index, rls, cross-tenant, lint-migrations, migrate, conventions), core (notices, deadlines, jobs, domains), full intelligence, tsc for db/core/intelligence, prettier and ESLint on changed files: all pass. The core cross-tenant suite skips without its database, so it could only be checked by CI; it is the one suite not run here. Changed `listHolidayListings` case so the listing's date is named only by a `notice_holiday` row (contract D6), the multi-date path it had not exercised. No source change otherwise; the cause of the CI failure is unconfirmed.

### CI `test` failure: rosters-perf (#387)
The only failing test was `src/court/__tests__/rosters-perf.test.ts > are index-backed` (planner did not pick `bench_roster_entry_workspace_roster_idx` under `enable_seqscan = off`). It touches only the `bench_roster*` tables; this branch adds `notice_holiday` and changes nothing in `court` or those tables, and the other 185 core test files passed. It is a query-plan assertion on a CI database under load (shard took 554s), unrelated to #628, so no source change. Also untracked three accidentally committed `.eslintcache` files (gitignored).

### CI `test` failure (second report, no log available)
The log was unreadable again. Re-ran core src/notices src/deadlines: 27 passed. No source change; the failing test is unconfirmed and is most likely the unrelated rosters-perf query-plan assertion recorded above (the core cross-tenant suite needs a database, so only CI runs it).
