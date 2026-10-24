### Approach
Resumed from the checkpoint. The feature was already in place; this session fixed the conformance failures. It restored the `api-keys` row the earlier session had dropped from `docs/engineering/core-domains.md`, and it declared the two unlisted files as `add-deliverable` amendments.

### Changes
- packages/core/src/court/bench-alerts.ts (+ test, index.ts): classifier, read model and notifier.
- packages/core/src/notices/poll.ts, jobs/definitions/notices-poll.ts: `onMatched` hook, wired to `notifyBenchNoticeAlerts`.
- packages/notifications/src/categories.ts (+ test): `bench_change` category.
- packages/notifications/src/push/payload.ts: generic push title (amendment, required by `Record<CategoryKey,string>`).
- packages/db/src/testing/cross-tenant-registry.ts and core `cross-tenant/services.test.ts`: registrations and real cases.
- apps/web: `bench-notice-alerts.tsx` (+ test, stories), `matter-overview.tsx`, matter page, today page, preferences form.
- packages/i18n: notices and notifications copy in en, ta and kn; generated files and translation status.
- docs/engineering/core-domains.md: court and notices rows. The `api-keys` row is restored.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/court/bench-alerts.ts (notifyBenchNoticeAlerts, dedupeKey `bench-notice:<id>`)
- R2 ✅ packages/core/src/court/bench-alerts.test.ts (category-based assignment)
- R3 ✅ packages/core/src/court/bench-alerts.ts
- R4 deferred (judge matching, contract amendment already in the contract)
- R5 ✅ packages/notifications/src/categories.ts
- R6 ✅ apps/web/components/courts/bench-notice-alerts.tsx, matter page, today page

### Verification
V1 to V5 pass, run with TESTCONTAINERS_RYUK_DISABLED=true because Ryuk cannot start on this host. V3's `-t bench` is case-sensitive and skips all 180 cases, so I also ran `-t Bench`: 2 passed. `forgedock check` passes. The new tests fail without the fix because they import the new module.

### Notes
No migration, no new dependency, no env vars. Judges are never read.

### Follow-up
e2e/tests/courts/courts.spec.ts:99 does not enumerate courts components; recorded bench-notice-alerts and its stories as not_members in result.json. No code change.

### Merge re-check
The post-merge typecheck failure was `turbo: command not found` (PATH only, exit 127), not a code clash. `pnpm exec turbo run typecheck --filter='...[9820df68]'` passes (23/23 tasks). No source change was needed. Vitest suites need the Postgres testcontainer global setup, which is unavailable on this host; they run in CI.
