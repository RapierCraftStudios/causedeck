### Approach
Recovery pass for ci.red. Three CI causes fixed on top of the earlier #499 work; nothing re-derived.

### Changes
- apps/web/lib/matters/workspace.ts: `agreement` accepts `undefined` (exactOptionalPropertyTypes typecheck error).
- apps/web/components/matters/next-date-card.tsx: chip keys resolve under the `matters` namespace (`workspace.confidence.*`), so the matters i18n key guard finds them.
- apps/web/__tests__/matter-workspace-page.test.tsx: mock `@causedeck/core/facts` and give the logger mock `warn`; a failed agreement load now degrades to no chip instead of failing the page.
- Prettier applied to apps/admin/lib/data/index.ts, date-conflict-card.tsx, 0080_snapshot.json, staff-console-schema.test.ts.

### Acceptance Criteria Status
- R1 ✅ apps/web/components/matters/date-conflict-card.tsx
- R2 ✅ apps/admin/app/(console)/data-ops/page.tsx
- R3 ✅ packages/core/src/facts/agreement.ts
- R4 ✅ apps/web/components/matters/date-conflict-card.tsx
- R5 ✅ apps/web/components/matters/next-date-card.tsx
- R6 ✅ packages/core/src/sources/ops.ts

### Verification
V1-V4 not run locally (verify.mode ci); CI runs them. Prettier 3.9.10 with the repo config was run on the changed files. The page-test regression (logger.warn mock) is the existing matter-workspace-page suite, which failed on CI before this fix.

### Notes
No behaviour or env changes.

## Migration renumber
Base took 0080 (news) and 0081 (api_keys). Lane migration renumbered to 0082_staff_conflict_rate (SQL byte-identical). Snapshot 0082 is the 0081 snapshot with new id/prevId (custom SQL-only migration); journal entry idx 82 appended. drizzle-kit/pnpm were unavailable offline, so the generator was not run.
- Rerun: merged origin/milestone/court-data-network (conflicts in core-domains.md and matter-workspace-page.test.tsx resolved keeping both sides). Fixed two test bugs in bench-alerts.test.ts (scoped forum read outside its workspace; "another forum" case named its own forum). V1-V5 now pass, run with a scratch NODE_OPTIONS shim for node 22.12's missing zstd and TESTCONTAINERS_RYUK_DISABLED=true (host env). V3's `-t bench` is case-sensitive and matches no test (exit 0); the two real cases pass with `-t BenchNoticeAlerts`.
