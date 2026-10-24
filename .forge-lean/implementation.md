### Approach
Own-workspace aggregates: `getCourtInsights` reads proceedings, listings, hearings and disposal state changes inside the caller's RLS transaction. A pure `summariseCells` computes the metrics and withholds any metric with fewer than `MIN_CELL_SIZE` (5) observations. A static guard pins that no judge, bench or party word and no internal bench store appears in the user-facing code.

### Changes
- packages/intelligence/src/analytics/index.ts: aggregation, query and `MIN_CELL_SIZE`.
- packages/intelligence/src/analytics/analytics.test.ts, static-guard.test.ts: unit tests and the guard with a mutation case.
- packages/intelligence/src/index.ts: export.
- apps/web/app/(app)/w/[slug]/courts/insights/page.tsx, apps/web/components/courts/court-insights.tsx (+ test): the page and view.
- packages/i18n: `court-insights` namespace in en/ta/kn, catalog list, generated files, translation-status, catalog test.
- docs/engineering/court-analytics.md: definitions and rules.

### Acceptance Criteria Status
- R1 ✅ packages/intelligence/src/analytics/static-guard.test.ts:30
- R2 ✅ packages/intelligence/src/analytics/index.ts (summariseCells, getCourtInsights)
- R3 ✅ static-guard.test.ts (internal stores check); query selects no bench columns
- R4 ✅ index.ts MIN_CELL_SIZE; no title or party columns read
- R5 ✅ apps/web/app/(app)/w/[slug]/courts/insights/page.tsx
- R6 ⏭ deferred in the contract (#487 closed not planned)
- R7 ✅ static-guard.test.ts
- R8 ✅ analytics.test.ts (boundary 5 shown, 4 withheld)
- R9 ✅ apps/web/components/courts/__tests__/court-insights.test.tsx (values, window, coverage)
- R10 ⏭ deferred by amendment

### Verification
- V1 intelligence vitest: pass (24 tests); new tests fail without the fix (the module does not exist).
- V2 web vitest: pass (11 tests).
- V3 i18n catalog test: pass (20 tests).
- tsc --noEmit for intelligence, i18n and web: clean. eslint on changed files: clean (web needed a larger heap; the pre-commit eslint hook ran out of memory, so the commit used LEFTHOOK_EXCLUDE=eslint after a manual lint). forgedock check: PASS.

### Notes
- No env vars, tables or migrations. D8 (court-nav link) not changed: the nav lists no sibling pages. The page has no menu entry yet, so it is reached by URL.
- The ta and kn strings are marked draft in translation-status.json.
- The data scope is the caller's own workspace only; network aggregates are not built.

### Stale-list follow-up
- catalog.test.ts already lists courtInsights. The other flagged tests enumerate unrelated things (nav, actions, routes, packages); recorded as not_members in result.json.

## CI fix
Added apps/web/components/courts/court-insights.stories.tsx (courts-stories guard requires a stories file per courts component).
