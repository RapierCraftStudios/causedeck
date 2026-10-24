### Approach
Add a `notices` notification category, have `matchNotices` report which notice newly matched which workspace, and alert each active member who may read matters once per notice through `notify()` (dedupe key `notice:<id>`). Holiday flagging is a computed read in core `notices`.

### Changes
- packages/notifications/src/{categories,push/payload}.ts, __tests__/categories.test.ts: category `notices` (in-app + push), push title.
- packages/i18n/src/messages/{en,ta,kn}/notifications.json and generated catalogs: label and description.
- apps/web preferences-form.tsx and notification-preferences.test.tsx: category map and default list.
- packages/core/src/notices/match.ts: report `matched` (workspace, notice) of new rows.
- packages/core/src/notices/alerts.ts: `notifyNoticeMatches`.
- packages/core/src/notices/holidays.ts: `listHolidayListings`.
- packages/core/src/notices/poll.ts, index.ts: optional `enqueueDelivery`, `alerts` count, exports.
- packages/core/src/jobs/definitions/notices-poll.ts: builds `enqueueDelivery` like judgment-alert-scan.
- packages/config/eslint/core-domains.js, docs/engineering/core-domains.md: notices -> workspaces.
- packages/db/src/testing/cross-tenant-registry.ts, core cross-tenant services.test.ts: registered with real cases.
- packages/core/src/notices/notices.test.ts: alert and holiday regression tests.

### Acceptance Criteria Status
- R1 ✅ packages/notifications/src/categories.ts (notices), packages/core/src/notices/alerts.ts
- R2 ✅ packages/core/src/notices/alerts.ts (dedupeKey), notices.test.ts "alerts each member once"
- R3 ✅ packages/core/src/notices/holidays.ts, notices.test.ts "flags a listing"
- R4 ✅ packages/i18n/src/messages/*/notifications.json
- R5 deferred (amendment): dates inside holiday-list documents are not parsed.

### Verification
Per rule verify.mode is ci: no tests or type-checks were run locally (V1-V7 run in CI). Prettier and the lane ESLint pass on all changed files; `forgedock check` passes. The new tests fail without the fix (the exports and category do not exist), not run locally.

### Notes
No migration, no env var. Alerts are sent only when `enqueueDelivery` is supplied; the job always supplies it. The two generated i18n catalogs were hand-edited at the same insertion point because `i18n:types` could not run (tsx unavailable); CI's `i18n:check` verifies them.

## CI fix: i18n:check
Added `ta`/`kn` entries (draft) for `notifications.preferences.categories.notices.{label,description}` to `packages/i18n/translation-status.json`; `pnpm i18n:check` now reports the catalogs in sync.
