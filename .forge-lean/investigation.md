**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature; /today and /tomorrow are placeholders, hero surface missing)
**Task Type**: feature

Note: the earlier FORGE:INVESTIGATION comment on #59 describes a WhatsApp-link settings UI (a different issue). It is stale and was ignored; this plan follows the issue body (Court-Day Board).

### What Was Claimed
Build the Court-Day Board on `/today` and `/tomorrow`, rendering the `getCourtDay` read model (#58) as complex -> hall -> item with stage badges, clash cards, list-diff banner/sheet, manual court-is-at marker, readiness rings, carry lists, delegation chips, an adapter-failure banner keeping last-known data (UJ-9), keyboard, a11y, i18n, stories and e2e/visual specs.

### What We Found
- `apps/web/app/(app)/w/[slug]/today/page.tsx:1-72` is the placeholder (`placeholderPage('today')`) plus `LiveHalls` and `BenchNoticeAlerts` sections; `tomorrow/page.tsx:1-3` is only `placeholderPage('tomorrow')`. No `loading.tsx` or `error.tsx` in either; no `_court-day/` dir.
- Read model exists: `packages/core/src/court-day/query.ts:81` `getCourtDay(deps, actor, {date, scope})`, exported via `@causedeck/core/court-day` (`packages/core/package.json:18`). Items carry `carryCount` (`query.ts:110,293`). Scope `workspace` needs `court_day.view_all` (`query.ts:96-101`).
- Marker service exists: `packages/core/src/court-day/markers.ts` exports `setCurrentItem`/`clearCurrentItem` (`index.ts:12`). Clash detection `clashes.ts`, list diff `diff.ts` (`index.ts:10-11`), live halls `board.ts:362`.
- No service or column for "carried" toggling (`grep carried` in db schema/core finds nothing relevant), so `toggleCarriedAction` has no backing store.
- No web consumer of `setCurrentItem`/`getCourtDay` in `apps/web`.
- i18n: `packages/i18n/src/messages/en/court-day.json` holds only `courtDay.liveHalls`; `court-day` already in `NAMESPACES` (`catalog.ts`) and `catalog.test.ts:96` lists top-level key `courtDay`. Issue path `packages/i18n/messages/...` is wrong; real path is `packages/i18n/src/messages/{en,ta,kn}/court-day.json`. Generated catalogs in `packages/i18n/src/generated/` are regenerated with `pnpm --filter @causedeck/i18n i18n:types`.
- UI patterns: `packages/ui/src/patterns/{court-item-chip,stage-badge,states,...}`, barrel `patterns/index.ts`; `packages/ui` exports `./patterns`.
- e2e specs live in `e2e/tests/<area>/` (e.g. `e2e/tests/product/`), not `e2e/product/`. ADR dir `docs/adr` ends at 0038 (+README index row).
- Cross-tenant guards: any new `'use server'` file must be added to `ACTIONS`/inputs in `apps/web/__tests__/cross-tenant-actions.test.ts:128`; core is not changed so `cross-tenant-registry.ts` is untouched. `packages/validators/src` is not touched, so `packages/db/src/index.test.ts` is not affected.

### Root Cause
Missing feature: #58 shipped the read model and #493 left a placeholder, so the board UI was never built.

### Affected Files
- `apps/web/app/(app)/w/[slug]/today/{page,loading,error}.tsx`, `tomorrow/{page,loading,error}.tsx`
- new `apps/web/app/(app)/w/[slug]/_court-day/*` (board, header, ribbon, attention strip, hall column/rail, marker, item card, clash card, readiness ring, list-diff sheet, quick-actions sheet, day rail, `use-court-day-data.ts`, `keyboard.ts`, `actions.ts`)
- new `packages/ui/src/patterns/court-day/*` (+ stories, barrel export in `patterns/index.ts`)
- `packages/i18n/src/messages/{en,ta,kn}/court-day.json`, regenerated `packages/i18n/src/generated/**`; `packages/i18n/src/__tests__/catalog.test.ts` only if top-level keys change
- `apps/web/__tests__/cross-tenant-actions.test.ts` (register new actions module)
- new `e2e/tests/product/court-day-board.spec.ts`, `e2e/tests/visual/court-day-board.spec.ts` (CI-only)
- new `docs/adr/0039-court-day-board-interaction-model.md` + index row in `docs/adr/README.md`
- Enumerating tests to run: `apps/web/__tests__/cross-tenant-actions.test.ts`, `packages/i18n/src/__tests__/catalog.test.ts`, `packages/ui/src/patterns/boundaries.test.ts`.

### Sibling Sweep
`/today` and `/tomorrow` are the only court-day placeholders. Other `placeholderPage` routes (calendar, etc.) belong to other issues (#66). `components/court-day/live-halls.tsx` and `components/courts/bench-notice-alerts.tsx` must be preserved on `/today`.

### History
`today` placeholder from the shell scaffold; live halls added in #493, bench alerts in #496; read model in PR #697 (#58). No prior board UI attempt. Siblings #60/#61 (brief) are open/needs-human.

### Recommendation
One lane: server-rendered board over `getCourtDay` under `workspaceAction`-style loaders, `?hall=` URL state, client islands only for rail, sheets, keyboard and marker. Deliver `setCurrentItemAction` (calls `setCurrentItem`/`clearCurrentItem`). Defer `toggleCarriedAction` and persisted carry toggling (no service/table; needs core+db work); show the derived carry list (`carryCount`) read-only. Defer the `/design` pipeline and design label (process outside code). Lighthouse/bundle/p95/visual/e2e are CI-measured (`out_of_band`). ta/kn keys stubbed per issue.

### Related Issues
#1 (parent), #58 (read model, closed), #65 (offline seam `useCourtDayData`), #61, #62, #63, #64, #66, #145.
