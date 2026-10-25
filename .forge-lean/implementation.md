### Approach
Build the #73 memory surface on the #72 core domain. Core gains read models (`views.ts`) and review completion (`review.ts`); `apps/web` gets the memory screen, review stepper, matter Memory tab and zod-validated, `can()`-gated server actions; `@causedeck/ui` gains ScopeChip and ProposalTray and extends MemoryCard.

### Changes
- packages/validators/src/memory.ts (+test): key `M1.last_memory_review`.
- packages/core/src/memory/views.ts, review.ts, index.ts (+tests): proposals, usage, last-used, review candidates, `getLastMemoryReview`, `completeMemoryReview`; cross-tenant registry entries.
- packages/ui/src/patterns: ScopeChip, ProposalTray (s/e/x shortcuts), MemoryCard extensions, stories, tests.
- apps/web/app/(app)/w/[slug]/memory/*: page, actions, loading, error, cards, dialogs, list, used-in, tenure panel, review stepper; matter Memory tab (`matters/[id]/memory/page.tsx`, `lib/matters/tabs.ts`).
- packages/i18n: `memory` namespace (en complete, ta/kn), matters tab label, catalog.
- Tests: cross-tenant-actions, memory-actions, memory-page, matter-tab-registry, workspace-shell; e2e/tests/memory/*.

### Acceptance Criteria Status
- R1–R10, R12, R15–R17 ✅ (apps/web/app/(app)/w/[slug]/memory/page.tsx, _components/*, packages/core/src/memory/views.ts, review.ts)
- R11, R13, R14 ✅ instrumented only: CI Lighthouse, bundle budget, Playwright visual and axe (e2e/tests/memory/memory.visual.spec.ts, memory.spec.ts); not run locally.

### Verification
- V1 validators memory.test.ts: pass (7).
- V2 core memory + cross-tenant memory/registry: pass (79).
- V3 ui patterns: pass (53) with `--project unit`; the default run also launches browser projects needing Chromium, which is not installed on this host.
- V4 i18n catalog.test.ts: pass (21).
- V5 web cross-tenant-actions, workspace-shell, memory-page, memory-actions (+ matter-tab-registry): pass (117).
- The new tests fail without the fix: the modules, actions and page do not exist.

### Notes
No env vars. Behaviour change: the matter tab list gains Memory for roles with `memory.read` (junior and above).

### Follow-up: stale sibling lists
- packages/ui/src/index.test.ts: added DEFAULT_SCOPE_CHIP_LABELS and DEFAULT_PROPOSAL_TRAY_LABELS to the pattern export list.
- scope-chip and proposal-tray stories now carry the shared states (real Default/LongText/RtlNeutral/Tamil/Kannada/Disabled, n/a declared for static ones); this fixed the pattern story check.
- Not members (recorded in result.json): MEMORY_REVIEW_AFTER_DAYS (constant, in NOT_A_SERVICE), the new ui exports in activity-item/proposal-card tests, Paused story in check-stories.test.ts.
