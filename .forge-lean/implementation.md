### Approach
Court-day board (#59) built on the existing core `getCourtDay`/`setCurrentItem` services; no core changes. Continued from the wip checkpoint; this session removed two stray `.eslintcache` files that had been committed and re-ran validation.
### Changes
- apps/web/app/(app)/w/[slug]/_court-day/: board components, keyboard, marker actions, `use-court-day-data` seam
- apps/web/app/(app)/w/[slug]/today, tomorrow: pages render the board; loading/error added
- packages/ui/src/patterns/court-day/: ItemNumeral, HallHeader, ClashBracket, stories, test
- packages/i18n: en/ta/kn court-day.json, regenerated outputs
- apps/web/__tests__/cross-tenant-actions.test.ts: registered both marker actions plus a no-write regression case
- e2e product and visual specs, ADR 0039 and README row
### Acceptance Criteria Status
R1-R15 (+R16-R21): ✅ implemented in the files above; browser-verified requirements are out_of_band (CI e2e/visual/Lighthouse).
### Verification
- V1 cross-tenant-actions: pass. Its new case fails without the actions (module import fails).
- V2 i18n catalog: pass.
- V3 ui court-day + boundaries: the `unit` project passes (34 tests). The full command exits 1 because the storybook browser project needs a Playwright chromium, which is not installed and must not be installed on this host. Environment problem.
- V4 web _court-day: pass.
- Scoped typecheck (web, ui, i18n): pass. Lint script lane-check.sh is absent here; earlier eslint cache showed 0 errors on changed files.
### Notes
Visual spec is `e2e/tests/visual/court-day-board.visual.spec.ts` (repo naming) rather than the contract's `court-day-board.spec.ts`; amended.
