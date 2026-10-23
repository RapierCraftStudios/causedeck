### Approach
`pollNotices` fetches each cleared `notice` source once through a structural `NoticeFetcher` port (the worker wires the governed `@causedeck/fetch` fetcher; core never imports it), parses with the source parser, stores notices once (unique source+url) with provenance, then matches new ones via the owner-defined `app_notice_match_targets` and writes `notice_match` per workspace inside `withWorkspace`. `system.notices.poll` runs it hourly.

### Changes
- packages/core/src/notices/{poll,match,index}.ts: poll, match, barrel.
- packages/core/src/jobs/definitions/notices-poll.ts, jobs/registry.ts, jobs/index.ts: the `system.notices.poll` job and `setNoticeFetcherFactory`.
- packages/core/package.json, src/index.ts: `./notices` export only (no dependency changes).
- packages/db/migrations/0075_notice_match_targets.sql, meta snapshot and journal: SECURITY DEFINER function plus owner read policy on `proceeding`.
- apps/worker/src/main.ts: wires the fetcher factory for notices.
- packages/config/eslint/core-domains.js, docs/engineering/core-domains.md: `notices` domain.
- packages/db/src/testing/cross-tenant-registry.ts, core cross-tenant services.test.ts: `matchNotices` case and NOT_A_SERVICE entries.
- apps/worker registry.test.ts, schedules.test.ts: job and cron expectations.
- packages/core/src/notices/notices.test.ts: regression tests.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/notices/poll.ts, match.ts
- R2 ✅ packages/core/src/jobs/definitions/notices-poll.ts
- R3 ✅ packages/core/src/notices/poll.ts ("skipped: not cleared")
- R4 n/a: core already lists `@causedeck/fetch` and must not import it
- R5 ✅ packages/config/eslint/core-domains.js, docs/engineering/core-domains.md
- R6 ✅ packages/core/src/__tests__/cross-tenant/services.test.ts (matchNotices)
- R7 ✅ apps/worker/src/__tests__/registry.test.ts, schedules.test.ts

### Verification
Verification runs on CI (verify.mode ci): V1-V4 were not run locally. Prettier and the changed-files ESLint (lane-check lint) pass. V5 (checks.mjs) widens to full turbo because packages/core/package.json changed, so it was not run. The new notices tests are expected to fail without the fix, since the module does not exist.

### Notes
New job `system.notices.poll`, hourly. New migration 0075 (function plus owner read policy on `proceeding`). No env vars.

## Follow-up
NOTICES_POLL_CRON, noticesPoll, runNoticesPoll and setNoticeFetcherFactory are not members of the services.test.ts CASES list; they are registered in NOT_A_SERVICE and recorded under not_members in result.json.
- The cross-tenant services test lists only `SERVICE_TESTS` members. `NOTICES_POLL_CRON`, `noticesPoll`, `runNoticesPoll` and `setNoticeFetcherFactory` are in `NOT_A_SERVICE` (`cross-tenant-registry.ts:909-912`), so they are recorded as `not_members` in `result.json`.
