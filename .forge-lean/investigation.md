**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature; large surface)
**Task Type**: feature

### What Was Claimed
Chamber delegation of appearances (PRD EX-4, J-C2, CO-2): owner/advocate assigns appearances to juniors with capacity and note, juniors see only their own list, system only suggests (L2), owner sees outcomes live. Depends on #58 (court-day) and #20 (`can()`).

### What We Found
Verified against `origin/milestone/prepare-execute` (c18c312d).
- Dependencies landed despite the issue states: #58 shipped as PR #697 (`packages/core/src/court-day/query.ts`, `clashes.ts`, `scope.ts`); `can()` exists in `packages/auth/src/policy/can.ts` (#20 closed NOT_PLANNED, superseded by #231). Not blocked.
- No `packages/core/src/delegation/`, no `packages/validators/src/delegation.ts`, no `apps/web/.../tomorrow/plan/`; `tomorrow/page.tsx:1-3` is a placeholder page.
- `appearance` table (`packages/db/src/schema/docket.ts:141-170`) has `hearing_id, member_id, capacity, appearing_for_person_id` only: no `assigned_by`, no `note`. A migration is needed (latest: `packages/db/migrations/20261025061924_brief_state.sql`).
- No `appearance.assign` action: `packages/auth/src/policy/actions.ts:4-23` and `matrix.ts:8-41` (Record<Action, Role>, so a new action needs a matrix row; `docs/engineering/permissions.md` is generated from it and snapshot-tested in `packages/auth/src/policy/__tests__`).
- `Mine` scope already includes appearances: `packages/core/src/court-day/query.ts:101-104` (`matter owner = me or exists appearance.member_id = me`). Needs check that a junior sees only matters they may read (restrictions applied further down the same function) and that unassigned items stay hidden.
- `court_day.view_all` is advocate+, with `advocatesCanViewAllCourtDay` setting (`matrix.ts:31`, `can.ts:40`); there is no `advocatesCanAssign`-style setting yet ("advocate with owner setting").
- Offboarding hook exists: `ReassignProvider`/`registerReassignProvider` in `packages/core/src/workspaces/offboarding.ts:14-34`; delegation must register one (reassign is by userId, appearance is by member id).
- Audit goes through `record` from `packages/core/src/audit/index.ts` (used in `court-day/markers.ts:8`); in-app `notification` table exists (`packages/db/src/schema/index.ts:208`), no core helper located by name; implementer must find the existing notification insert path (`packages/core/src/jobs/definitions/notification-deliver.ts`, `case-watch/alerts.ts`).
- Clash data: `detectClashes` in `packages/core/src/court-day/clashes.ts`, exported from `court-day/index.ts`.
- Outcome confirmation (#62) and board (#59) are still open: no `hearing.outcome_confirmed` event wiring found; the live strip must consume whatever #62 emits, so keep the data source a core query (`chamberOutcomesLive`) with a 30 s poll.

### Root Cause
Greenfield: no delegation domain, missing columns on `appearance`, missing policy action.

### Affected Files
- `packages/db/src/schema/docket.ts` (+ migration, snapshot, `packages/db/src/__tests__/docket-schema.test.ts`)
- `packages/auth/src/policy/{actions,matrix,can}.ts`, permissions doc + snapshot
- `packages/validators/src/delegation.ts` (+ barrel `index.ts`)
- `packages/core/src/delegation/*` (+ `index.ts`, `packages/core/src/index.ts`, `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`)
- `apps/web/app/(app)/w/[slug]/tomorrow/{page.tsx,plan/*}`, `_court-day/*`, `apps/web/__tests__/cross-tenant-actions.test.ts`
- `packages/i18n/messages/{en,ta,kn}/delegation.json`, `packages/i18n/src/__tests__/catalog.test.ts`
- `packages/ui/src/patterns/delegation/*`, `e2e/tests/delegation/*`

### Sibling Sweep
Other places that read `appearance.member_id` and must tolerate the new columns/history: `court-day/query.ts:185-205`, `lifecycle/export/exporters.ts:276`, `lifecycle/deletion/erase.ts:101`. Writers of `appearance` in matter-graph: none found in core non-test source.

### History
`appearance` introduced by #347 (part 4 of #32). Court-day by PR #697. No prior delegation attempt.

### Recommendation
Single lane, ordered: (1) db column migration + policy action, (2) validators, (3) core assign/suggest/view + offboarding provider, (4) registries/guards, (5) web actions + UI + i18n + stories, (6) e2e/visual specs (CI only). Do not touch #59/#62/#64 code beyond hooking the quick action.

### Related Issues
#1 parent; #58, #20 deps (landed); #59, #62, #64 out of scope; #18 offboarding flows.
