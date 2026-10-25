**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield UI; the memory engine #72 has no screen, so nothing it proposes can be confirmed by a person)
**Task Type**: feature

### What Was Claimed
Build `/w/[slug]/memory` (Memory Cards by layer, proposal tray with Save/Edit/Dismiss, edit sheet, delete dialog with 24 h purge note, pause per item and all, "Used in" popover, tenure panel with table alternative, permission-denied for clerks), `/memory/review` (monthly stepper recording the review date), and a matter-workspace Memory tab. Includes all states, i18n, stories, e2e/visual baselines, a11y and perf budgets. Deps #72 (engine) and #145 (patterns) are both closed.

### What We Found
Verified on `origin/milestone/follow-up-continuity-memory` (HEAD 03a3b808; #68 just merged).
- Route is a placeholder: `apps/web/app/(app)/w/[slug]/memory/page.tsx:1-3` (`placeholderPage('memory')`). No loading/error/actions/review/_components. No `apps/web/lib/memory/`.
- Engine is exported at `@causedeck/core/memory` (`packages/core/package.json:34`, `packages/core/src/memory/index.ts:5-51`): `listMemory` (`read.ts:242`, active+paused, optional layers/matterId, scope enforced in SQL), `getMemory`, `confirmMemory` (`confirm.ts:76`, optional corrected `value`), `dismissMemoryProposal` (`:146`), `editMemory` (`:225`), `pauseMemory(itemId, paused)` (`:256`), `deleteMemory` (`:278`), `setSharedWithChamber` (`:305`, owner only), `setMemoryPauseAll` (`:334`), `isMemoryPaused` (`:359`), `createMemoryNote` (`:171`), `tenureMetrics` (`review.ts:42`, owner/advocate only), `monthlyReview` (`review.ts:137`, counts only, stale = 90 days via `MEMORY_STALE_AFTER_DAYS`, `review.ts:14`).
- Service gaps the UI needs (no read path exists): (a) **no function lists pending proposals** (only `toProposal` helper, `propose.ts:79`, not exported from index); (b) **no function lists `memory_usage` rows** for an item (only `recordUsage`, `read.ts:299`; table `packages/db/src/schema/memory.ts:195`, columns itemId/usedIn/outputRef/usedAt); (c) **no list of items "not confirmed or used in 60 days"** (monthlyReview only counts, at 90 days); (d) **no read/write of the last review date**: `M1.last_memory_review` is not in `MEMORY_KEYS` (`packages/validators/src/memory.ts:47-110`) and `workspace_settings` (`packages/db/src/schema/workspace.ts:22-52`) has no column; `completeReview` does not exist; (e) no last-used timestamp on `MemoryItem` (`validators/src/memory.ts:232-250`); card "last-used time" needs a usage aggregate.
- Every new runtime export of core must be registered: `packages/db/src/testing/cross-tenant-registry.ts:875-905` (memory block uses `memoryDenies` -> `packages/core/src/__tests__/cross-tenant/memory.test.ts`).
- Layer enum is `M1,M2,M3,M4,M6,M7` (`schema/memory.ts:36`); issue tabs (Profile, Preferences, Matters, Court notes, Clients, Recognition) map 1:1. Scope values `user|workspace|matter` map to chips Only you / Chamber / This matter; chamber sharing only via `setSharedWithChamber` (M4 notes, owner only).
- Policy: `memory.read|write` are `junior`+ in `packages/auth/src/policy/matrix.ts:23-24`, so clerk is denied by `can()`; the engine itself allows a clerk layers `M1,M2,M6,M7` (`scope.ts:41`), but the issue wants a denied screen for clerks, so gate the page on `can(role,'memory.read')`.
- UI: pattern exists at `packages/ui/src/patterns/memory-card/` (not `patterns/memory/` as the issue says): `MemoryCard` takes `scope: M1..M7` layer meta (`memory-card.tsx:10-24`), source, confirm/edit/delete, offline/viewOnly/error; it has no scope chip (Only you/Chamber/This matter), paused state, last-used, or "Used in" slot. `ProposalCard`, `ProvenanceChip`, states exported from `packages/ui/src/patterns/index.ts:46,100-123`. Components for tabs/sheet/dialog/popover/switch/chart/sonner/drawer exist in `packages/ui/src/components`; no Stepper component.
- Conventions to copy: sibling #68 route `apps/web/app/(app)/w/[slug]/obligations/` (page with `?__state=` dev previews, `actions.ts` via `workspaceAction`, `_components/`, `lib/obligations/queue-state.ts`); core runs on `ctx.tx` (see `inbox/actions.ts:1-60`, lazy `import('@causedeck/core/...')`).
- Matter Memory tab: tabs register via `registerMatterTab` in `apps/web/lib/matters/tab-registry.ts:1-40` listed in `apps/web/lib/matters/tabs.ts:44` (comment names #73); label keys under `matters.workspace.tabs`; layout `matters/[id]/layout.tsx`. No memory tab yet, and the #68 obligations tab is also not registered there.
- i18n: no `memory` namespace in `packages/i18n/src/catalog.ts:20-45`; messages live in `packages/i18n/src/messages/{en,ta,kn}/` (issue's `packages/i18n/messages/en/memory.json` path is outdated). Cross-tenant action guard: `apps/web/__tests__/cross-tenant-actions.test.ts` needs `ACTIONS` + probes for each new `'use server'` export. E2E lives in `e2e/tests/<area>/` (see `e2e/tests/obligations/`), not `e2e/product|visual`.
- Shell test `apps/web/__tests__/workspace-shell.test.tsx` references placeholder pages; replacing the memory placeholder may need that test updated.

### Root Cause
Greenfield: engine (#72) and patterns (#145) exist, but no page, actions, review flow, proposal/usage/review read models, pattern additions or catalog consume them.

### Affected Files
`apps/web/app/(app)/w/[slug]/memory/{page,loading,error}.tsx`, `memory/actions.ts`, `memory/review/page.tsx`, `memory/_components/*`; `apps/web/app/(app)/w/[slug]/matters/[id]/memory/page.tsx` + `_memory/matter-memory-panel.tsx`; `apps/web/lib/memory/*` (URL params, view models); `apps/web/lib/matters/tabs.ts`; `packages/core/src/memory/{views.ts,review.ts,index.ts}` (listMemoryProposals, listMemoryUsage, listReviewCandidates, getLastMemoryReview, completeMemoryReview); `packages/validators/src/memory.ts` (+test) for `M1.last_memory_review`; `packages/ui/src/patterns/{scope-chip,proposal-tray}/*`, `memory-card/*`, `patterns/index.ts`; `packages/i18n/src/{catalog.ts,messages/{en,ta,kn}/memory.json}` + catalog test and `matters.json` tab label; cross-tenant registry + tests; `e2e/tests/memory/*`.

### Sibling Sweep
Other placeholder routes backed by merged services: `calendar`, `briefs`, `drafts`, `news` (own issues #69/#70/#74/#79). Same hub-registration trap as #68: new core exports need the cross-tenant registry. `MemoryCard` has no `apps/web` caller (grep), so extending its props breaks no app code, only its stories/tests and `__fixtures__`.

### History
Memory engine added by #72 (ADR 0038); patterns by #9/#145; sibling UI #68 merged as PR #738 as the template. No prior attempt at #73 (the earlier FORGE:INVESTIGATION comment on the issue describes #68 and is not about this issue).

### Recommendation
One lane, ordered checklist: (1) validators: register `M1.last_memory_review` (workspace scope, non-strategy) with test; (2) core read models: `listMemoryProposals`, `listMemoryUsage`, `listReviewCandidates` (60 days), `getLastMemoryReview`/`completeMemoryReview`, last-used aggregate, hide the review key from lists, with cross-tenant registry + tests; (3) UI patterns: ScopeChip, ProposalTray, MemoryCard paused/last-used/used-in additions with stories and tests; (4) i18n `memory` namespace (en complete, ta/kn stubs) + matter tab label; (5) `lib/memory` + server actions (confirm/edit/delete/pause/pauseAll/completeReview) with cross-tenant action probes; (6) `/memory` page, states, review stepper, tenure panel (chart + table); (7) matter Memory tab; (8) e2e + visual specs (CI-only baselines). Use only existing deps; no migration.

### Related Issues
#1 (parent), #72 and #145 (deps, closed), #9, #74 (uses memory in outputs, out of scope), #81 (playbooks, out of scope), #68 (sibling template, merged).
