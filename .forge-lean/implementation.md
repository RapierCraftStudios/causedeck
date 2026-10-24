### Approach
Case-status watch/refresh on the web path: `court.case-status` legal-gated flag, `workspaceAction` server actions over `@causedeck/core/case-watch`, a governed web fetcher (`@causedeck/fetch`), device-first `refreshStatus` with server fallback and provenance, an OCR worker behind a typed protocol, i18n namespace `case-watch`.
### Changes
- settings/case-watch/{actions,page,loading,watch-form}: five actions, settings page, skeleton, list form.
- components/matters/{proceeding-tree,status-watch-panel,refresh-status-button}.tsx, proceedings/page.tsx: Refresh status / Watch on the Proceedings tab (writers, flag on).
- lib/case-watch/{fetcher,refresh,solver-client,solver.types}.ts, workers/captcha-solver.worker.ts: fetcher, orchestrator, solver.
- apps/web/package.json, pnpm-lock.yaml: `@causedeck/fetch`, `tesseract.js`.
- packages/flags (keys, test), docs/engineering/flags.md; packages/i18n (catalog, messages en/kn/ta, generated, catalog test).
- __tests__/cross-tenant-actions.test.ts: five actions registered with probes; new case-watch-actions.test.ts and case-watch-page.test.tsx.
### Acceptance Criteria Status
- R1 ✅ settings/case-watch/actions.ts, cross-tenant-actions.test.ts
- R2 ✅ watch-form.tsx, status-watch-panel.tsx (no captcha/iframe), case-watch-page.test.tsx
- R3 ✅ lib/case-watch/refresh.ts, fetcher.ts, workers/captcha-solver.worker.ts
- R4 ✅ packages/i18n/src/catalog.ts, case-watch.json, catalog.test.ts
### Verification
Verification runs on CI (V1–V5 not run locally). Lint (lane-check, changed files) and prettier pass; forgedock check PASS. New tests would fail without the actions/refresh code (modules absent).
### Notes
Flag `court.case-status` (kill switch KILL_COURT_CASE_STATUS) off by default. The device transport is injectable; none is wired, so the server fallback is the working path today (browser CORS).

## Stale-list fix
Added refresh-status-button.stories.tsx and status-watch-panel.stories.tsx (matters-stories.test.ts requires a story per component). Other flagged lists (nav ids, routes, API dirs) are not members; recorded in result.json not_members.

## Duplicate-export fix
Renamed case-watch `WatchForm` to `CaseWatchForm` (and its props type) to avoid colliding with court-watch/watch-form.tsx; updated page.tsx and case-watch-page.test.tsx. Prettier clean.

## Dotted message keys fix (CI web shard: sign-in.test.tsx and 6 more files)
The `caseWatch.source` messages were keyed by status source ids (`in.tn.…:case_status`), and next-intl rejects "." in keys (INVALID_KEY logged for every provider using the full catalog). Keys are now `in_tn_chennai-district_case_status` etc. (source JSON, generated JSON and d.ts), looked up via `lib/case-watch/source-key.ts`. Added the ta/kn `caseWatch.*` draft entries to translation-status.json (i18n:check was failing). Fixed case-watch-actions.test.ts: the result shape is `error.code`, and calls run sequentially because concurrent first imports of the mocked auth module race in vitest.
