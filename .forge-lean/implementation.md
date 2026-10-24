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

## Merge-check follow-up
The reported failure (`turbo: command not found`, exit 127) was an environment PATH issue, not a code conflict. Re-ran via `pnpm turbo run typecheck --filter=...[base]`: 23/23 pass. V1-V3 pass. No source change needed.

## Merge-check rerun (turbo not found)
The merged-tree typecheck failed with exit 127 (`turbo: command not found`): an environment PATH problem, not a code or symbol conflict. No source change was needed. With `node_modules/.bin` on PATH, scoped `turbo run typecheck` passes (23/23) and V1-V3 pass.

### Merge verification
After merging the base, the scoped typecheck (`pnpm exec turbo run typecheck --filter='...[e39ede8b]'`, 23 tasks) passes. The earlier failure (exit 127) was `turbo` missing from PATH on the check host, not a code defect (the binary is `node_modules/.bin/turbo`, run through `pnpm exec`). No duplicate keys or same-named symbols were found; no source change was needed. V1-V3 pass again.

## CI `test` failure (run 40088051117): not reproduced
No log was available. V1-V3, the full intelligence and i18n suites and the courts/messages web tests pass. Scoped `turbo run test` fails only in container-backed packages (db, adapters, etc.) with testcontainers "Log stream ended and message /.*Started.*/ was not received": no Docker on this host, not a code defect. No source change made.
