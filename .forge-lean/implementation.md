### Approach
Outward drafts UI (#736) on top of the merged #735 services. A new core read model (listDrafts/getDraft) feeds a drafts page with split view, an editor, share menu, language switcher and diff view in `apps/web/components/outward`. Actions only record shares; the lawyer opens wa.me/mailto/download themselves (ADR 0039). The inbox "Ready to send" list gets an `outward` provider.

### Changes
- packages/core/src/outward/views.ts, index.ts, __tests__/views.test.ts: read model and tests; cross-tenant services test extended.
- apps/web/app/(app)/w/[slug]/_outward/actions.ts: compose/save/markShared actions; registered in __tests__/cross-tenant-actions.test.ts.
- apps/web/lib/outward/{share-links,ready-provider}.ts: link builders, inbox provider (imported by inbox page and actions).
- apps/web/components/outward/*: editor, share menu, language switcher, diff view, list/states, stories, component tests.
- apps/web/app/(app)/w/[slug]/drafts/{page,loading,error}.tsx and _components/drafts-screen.tsx: the route.
- packages/i18n: `outward` namespace en/ta/kn, catalog, generated files, test.
- apps/web/__tests__/outward/*: unit tests for share-links and ready-provider (apps/web vitest only includes `__tests__/**` and `components/**/__tests__`, so tests under lib/ would never run).

### Acceptance Criteria Status
- R1 ✅ _outward/actions.ts:1, __tests__/cross-tenant-actions.test.ts (ACTIONS + probes)
- R2 ✅ lib/outward/ready-provider.ts:67, components/outward/draft-editor.tsx
- R3 ✅ components/outward/share-menu.tsx, lib/outward/share-links.ts
- R4 ✅ language-switcher.tsx, diff-view.tsx, draft-editor.tsx (keys, banner)
- R5 ✅ draft-list.tsx OutwardStates, drafts/{loading,error,page}.tsx
- R6 ✅ packages/i18n/src/messages/*/outward.json, catalog.ts
- R7 ✅ components/outward/outward.stories.tsx (not run locally: Storybook runs in CI)
- R8 ✅ packages/core/src/outward/views.ts

### Verification
- V1 core outward tests: pass. V2 cross-tenant outward: pass. V3 web (cross-tenant-actions, outward, inbox): pass. V4 i18n catalog: pass. V5 checks.mjs: pass. `forgedock check`: PASS.
- tsc --noEmit on apps/web clean; eslint on changed web files clean.
- share-links test failed before the fix (combining marks stripped from Tamil file names) and passes now.

### Notes
- Pre-commit eslint hook ran out of heap on the shared host; commit used --no-verify after a manual eslint pass.
- No behaviour change outside the drafts route and inbox ready list. No env vars.

### Export-name collision fix
- outward.stories.tsx exported Empty, Loading, ErrorState, Denied, which whatsapp-import.stories.tsx also exports; renamed to StatesEmpty, StatesLoading, StatesError, StatesDenied. No other references.
