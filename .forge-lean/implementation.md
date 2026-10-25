### Approach
Continued the interrupted lane: core/db/validators were already committed. This session added the web layer (Research tab link-out menu, notes, settings page), i18n namespaces, action registrations and tests.

### Changes
- apps/web/app/(app)/w/[slug]/matters/[id]/research/{page,actions}.ts(x): link-out menu from getResearchFacts, notes list/editor, denied state without memory.read; six note/authority actions (memory.write).
- apps/web/app/(app)/w/[slug]/settings/research/{page,actions,provider-form}: provider templates (workspace.manage); lib/settings-nav.ts entry.
- apps/web/components/research/*: link-out-menu, notes-list, note-editor and stories.
- packages/i18n: research.json (en/ta/kn), catalog NAMESPACES, settings.nav.research, translation-status, generated types.
- Tests: apps/web/__tests__/research/no-ai-no-iframe.test.ts, cross-tenant-actions, settings-shell, i18n catalog; e2e/tests/matters/research.spec.ts (CI only).

### Acceptance Criteria Status
- R1 ✅ packages/core/src/research/links.ts
- R2 ✅ links.ts, providers.ts, apps/web/__tests__/research/no-ai-no-iframe.test.ts
- R3 ✅ notes-service.ts researchFactsFromTags
- R4 ✅ providers.ts validateProviderTemplate; settings/research
- R5 ✅ notes-service.ts, cross-tenant services and actions tests
- R6 ✅ page.tsx notesDenied; notes-service memory.read/write
- R7 deferred (contract disposition)
- R8 ✅ notes-list.tsx states (verified out of band in CI e2e)
- R9 ✅ no-ai-no-iframe.test.ts
- R10, R11 ✅ instrumented in e2e/tests/matters/research.spec.ts (CI)
- R12 ✅ packages/i18n/src/messages/*/research.json

### Verification
V1–V5 pass (forgedock check PASS). Web tsc --noEmit clean. ESLint could not run locally (heap OOM on the type-aware config); CI lints. The new guard test fails without the components (files absent).

### Notes
- Link-out menu uses a DropdownMenu at all widths (no separate bottom Sheet at 360).
- e2e spec is at e2e/tests/matters/research.spec.ts (Playwright testDir is ./tests); amended as a deliverable.
- Settings nav gains a "research" entry (advocate+).

## Stale-list follow-up
Core research exports are registered in NOT_A_SERVICE; the other flagged lists do not enumerate them. Recorded in result.json not_members.

## Story export collision
Renamed notes-list story exports to NotesEmpty/NotesLoading/NotesErrorState/NotesDenied and link-out-menu Empty to NoLinks so they no longer collide with whatsapp-import stories. Nothing else references them.

## Lint fix
CI lint failed on two `@typescript-eslint/no-base-to-string` errors (`String(FormData.get(..) ?? "")`) in settings/research/provider-form.tsx and components/research/note-editor.tsx. Narrowed with `typeof value === "string"`. ESLint on all changed files is now clean (core/db/validators/i18n had no errors).
