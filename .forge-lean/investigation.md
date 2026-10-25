**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield UI; the follow-up surface the obligation service #67 feeds has no screen)
**Task Type**: feature

### What Was Claimed
Build the Obligation Queue UI at `/w/[slug]/obligations`: grouped (Overdue/Today/This week/Later/Undated), keyboard-first and swipeable, with mandatory-reason close and reschedule, a drafted next step per item, Defects and Certified-copies tabs, filters in the URL, all states, i18n, stories, e2e and visual baselines. It renders `queryQueue` from #67 and uses #145's patterns.

### What We Found
Verified on `origin/milestone/follow-up-continuity-memory` (05be6ee8 = HEAD; #67 and #145 are merged).
- The route is a placeholder: `apps/web/app/(app)/w/[slug]/obligations/page.tsx:1-3` (`placeholderPage('obligations')`); no `loading.tsx`, `error.tsx`, `actions.ts` or `_components/`.
- Service is ready: `@causedeck/core/obligations` (`packages/core/package.json:35`, `src/obligations/index.ts`) exports `queryQueue` (`queue.ts:32`, five groups, filters matterId/ownerMemberId/source/sourceType/limit, returns raw `ObligationRow`s), `closeObligation` (`close.ts:61`, `CloseInput` reason type + note), `reopenObligation`, `updateObligation` (`update.ts:25`, reschedule needs a reason via `ObligationPatch`), `createObligation` (`create.ts:95`), `raiseDefect/cureDefect/representFiling`, `applyForCertifiedCopy/transitionCertifiedCopy`.
- Gaps in the service: there is NO read function for defects or certified copies (only writers: `defects.ts:52,111,164`, `certified-copies.ts:33,90`). The Defects and Copies tabs need `listDefects` / `listCertifiedCopies` (workspace-scoped, matter-visibility filtered). `queryQueue` rows carry no matter title, case number, owner name or source quote; the UI needs a join/hydration step.
- Kind = `obligation.source` (enum `OBLIGATION_SOURCES`, `packages/db/src/schema/enums.ts:66-75`); a task is `source='internal'` (`update.ts:35`). Closed reasons are `task_completed|lawyer_action|not_applicable` (`docket.ts:227`).
- Policy: `obligation.read|write|track` (`packages/auth/src/policy/actions.ts:14`); clerks get `track` only (tasks, defects, copies). There is no strategy-text column, so "clerk without strategy text" is satisfied by the clerk seeing only `internal` rows' write controls and not `court_order` actions; `queryQueue` already hides what the role cannot read (`queue.ts:~83`).
- Existing UI to reuse: `packages/ui/src/patterns/obligation-row/obligation-row.tsx` (row with due state, avatar, ProvenanceChip, swipe, overflow menu, offline/viewOnly; but its swipe is left=Done/right=Snooze, threshold 80 px, with `snooze` wording; issue wants right=Done, left=Reschedule, threshold 72 px), `provenance-chip`, `proposal-card`, `stage-badge`, `states/*` (`packages/ui/src/patterns/index.ts:97`). UI primitives exist for dialog, sheet, tabs, popover, date-picker, command, sonner, checkbox, shortcuts-dialog, collapsible (`packages/ui/src/components`). The issue's path `packages/ui/src/patterns/obligation/*` does not exist; the pattern dir is `obligation-row/`.
- Action conventions: `workspaceAction(schema, handler, { action })` in `apps/web/lib/workspace-action.ts`, strict zod, `assertCan`, lazy `import('@causedeck/core/...')`, `revalidatePath` (model: `inbox/actions.ts`). Every exported `'use server'` action must be in `ACTIONS` plus probe inputs in `apps/web/__tests__/cross-tenant-actions.test.ts:128` (no obligation entries today).
- i18n: namespaces listed in `packages/i18n/src/catalog.ts:~20-45` with files under `packages/i18n/src/messages/{en,ta,kn}/`; there is no `obligations` namespace. The issue's path `packages/i18n/messages/en/obligations.json` is outdated.
- Next steps: #69 (client letters) is open, so per the issue a letter step becomes a plain internal task via `createObligation({source:'internal'})`; the reminder to the clerk is likewise an internal task. Nothing sends.
- E2E specs live in `e2e/tests/<area>/` (e.g. `e2e/tests/inbox/inbox.spec.ts`), not `e2e/product/`; visual specs follow `*.visual.spec.ts` (`e2e/tests/inbox/whatsapp-import.visual.spec.ts`). Baselines are generated only in CI.
- Shell already lists the route (`components/shell/mobile-nav.tsx:28`), so no nav change.

### Root Cause
Greenfield: the service (#67) and patterns (#145) exist but no page, actions, read models for defects/copies, or catalog consume them.

### Affected Files
`apps/web/app/(app)/w/[slug]/obligations/{page,loading,error}.tsx`, `actions.ts`, `_components/*` (queue-view, queue-group, obligation-row, swipe-row, use-swipe, close-dialog, reschedule-popover, next-step-card, queue-filters, defects-tab, copies-tab, detail-sheet); `apps/web/lib/obligations/*` (URL params, view hydration, next-step suggestion); `packages/core/src/obligations/{views.ts,index.ts}` (read models); `packages/ui/src/patterns/obligation-row/*` and `patterns/index.ts` (DueLabel, GroupHeader, swipe direction); `packages/i18n/src/{catalog.ts,messages/{en,ta,kn}/obligations.json}` and `__tests__/catalog.test.ts`; `apps/web/__tests__/cross-tenant-actions.test.ts`; `packages/db/src/testing/cross-tenant-registry.ts` + `packages/core/src/__tests__/cross-tenant/services.test.ts` (new core exports); `e2e/tests/obligations/*`.

### Sibling Sweep
Same defect class (placeholder routes backed by merged services): `calendar`, `briefs`, `drafts`, `memory`, `news` still use `placeholderPage`; each belongs to its own issue (#69, #70, #74), not here. The `ObligationRow` pattern has no `apps/web` caller (grep: only `packages/ui` index, fixtures `__fixtures__/trust.ts`, stories and tests incl. `states/*.browser.test.tsx`), so changing its swipe direction breaks no app code, only those fixtures/tests.

### History
`obligation` table came with the docket tables; #67 (PR #725, merged) added the service, events, defects and copies; #145 completed the pattern library. No prior attempt at #68.

### Recommendation
One lane, ordered checklist: (1) core read models `listDefects`/`listCertifiedCopies` + a queue hydration view (matter title/case number, owner name, source quote) with cross-tenant registry cases; (2) UI pattern changes (swipe right=Done, left=Reschedule, 72 px, DueLabel, GroupHeader) with stories; (3) i18n `obligations` namespace (en complete, ta/kn stubs) and catalog registration; (4) `lib/obligations` URL-state and next-step helpers; (5) `actions.ts` (close/reschedule/reassign/add/use-next-step) via `workspaceAction`, register in the cross-tenant action test; (6) page, loading, error and `_components`; (7) e2e product, a11y and visual specs (CI only). Performance budgets, Lighthouse, visual baselines and axe over e2e are CI-measured. Group-collapse persistence per member: store in a cookie/localStorage keyed by member (no new table) unless the lane finds a member-preferences store.

### Related Issues
#1 (parent), #67 and #145 (deps, merged), #9, #69 (letter drafts, open), #70, #74.
