**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (largest part of the drafting studio epic #79; user-facing, offline/outbox and bundle-budget risk)
**Task Type**: feature

### What Was Claimed
Part 3 of #79: build the drafting studio at `apps/web/app/(app)/w/[slug]/drafts/[id]/` (RSC shell, client editor, save/restore actions), `components/drafting/facts-panel.tsx` and `version-drawer.tsx`, responsive layouts (1280/768/360), keyboard shortcuts, finding navigation, offline read-only cache plus edits queued in the outbox, lazy editor chunk (initial JS <= 180 KB gzip), stories, and registration of the new actions in `cross-tenant-actions.test.ts`.

### What We Found
- Nothing exists yet: `apps/web/app/(app)/w/[slug]/drafts/` holds only `page.tsx:1-3` (a `placeholderPage('drafts')`, owned by sibling #826); no `[id]` route, no `apps/web/components/drafting/`.
- Core services are ready (deps #824/#825 merged): `getDraft`, `listVersions`, `saveVersion`, `restoreVersion` exported from `packages/core/src/drafting/index.ts` (subpath `@causedeck/core/drafting`, `packages/core/package.json:28`). `getDraft` returns `{draft, version{blocks}, versions}` (`read.ts:57-61`); `saveVersion`/`restoreVersion` take `DraftingDeps {db, enqueueCitationCheck?}` (`service.ts:87-92,210,245`) and need `draft.write` (junior+, `packages/auth/src/policy/matrix.ts:31`); clerks get FORBIDDEN, unreadable drafts NOT_FOUND (`policy.ts:87,119`).
- Action pattern to copy: `workspaceAction(schema, handler, {action})` with `WorkspaceScoped` (`apps/web/lib/workspace-action.ts:34-50`), dynamic `import('@causedeck/core/...')`, `ctx.tx` as db (`app/(app)/w/[slug]/matters/actions.ts:30-52`), `Result<T>` return and `export async function xAction(raw: unknown)`.
- Block model: `Block` union heading/paragraph/page_break/slot/narrative/section/list, all `.strict()` (`packages/validators/src/drafting.ts:79-124`), helpers `walkBlocks`/`collectSlots`/`blockKeys` in `packages/drafting/src/blocks.ts:16-64`. There is NO field for an "AI-drafted" marker, no `[[missing]]` marker handling and no stored edit diff: marker/diff must be client-state derived (see Recommendation). Narrative text is produced by `draftNarratives` (`service.ts:326`) at render time, not stored in blocks.
- i18n namespace `drafting` exists (`packages/i18n/src/messages/en/drafting.json`): states, panels.facts/citations/consistency/versions, findings, aiDrafted, shortcuts (save/checkCitations/togglePanel/export), offline (banner, queued, synced). Missing for this issue: "Offline, changes queued" state wording, `[`/`]` finding navigation, Cmd+K draft actions, restore diff preview, live-region announcements, tab labels. Add keys to en/ta/kn plus `translation-status.json` and regenerated `src/generated/*` (guard: `catalog.test.ts`).
- Shortcuts: registry in `apps/web/lib/shortcuts/registry.ts:1-60` (fixed `SHORTCUT_GROUPS`, `ShortcutAction` union, help dialog lazy-loaded via `provider.tsx:44-52`); the studio needs page-scoped entries (provider supports page-registered shortcuts with palette commands, `provider.tsx:66+`).
- Outbox (`apps/web/lib/pwa/outbox/db.ts:8-31,53-62`) is file/blob oriented (`channel: 'share'|'upload'|'camera'|'voice'`, encrypted blob, presign/PUT upload in `uploader.ts`; Dexie db `causedeck-outbox` v1 `items`,`keys`); `sync.ts` has `online`/visibility triggers and a Web Lock. Draft edits are not files, so they need either a new channel/kind with its own uploader branch or a separate small Dexie table; encryption via `crypto.ts` should be reused (draft text is privileged).
- Budget: `apps/web/__tests__/bundle-budget.test.ts` and `apps/web/scripts/check-bundle-budget.mjs` enforce 180 KB gzip initial JS and per-route manifests (MATTERS/TIMELINE); a drafts route entry may be added there. Editor must be `next/dynamic`/`import()` loaded; Playwright/Lighthouse/`next build` cannot run locally.
- `apps/web/__tests__/cross-tenant-actions.test.ts:129-267`: `ACTIONS` map must list every exported action (`:916` asserts exact list), with probe inputs in `inputs(...)`.
- `packages/ui` has `CitationStatus` (#825) and ProvenanceChip (`apps/web/components/matters/next-date-card.tsx` uses it) for fact chips.

### Root Cause
Not a defect: the studio UI was not built; it is the third slice of #79 after #824 (services) and #825 (pattern + i18n).

### Affected Files
New: `apps/web/app/(app)/w/[slug]/drafts/[id]/{page.tsx,studio.tsx,actions.ts,loading.tsx,error.tsx}`, `apps/web/components/drafting/{facts-panel.tsx,version-drawer.tsx,editor/*, ...stories,tests}`, `apps/web/lib/drafting/{blocks-edit.ts,offline-queue.ts,...}`.
Changed: `apps/web/__tests__/cross-tenant-actions.test.ts`, `apps/web/lib/shortcuts/registry.ts` (+provider if needed), `apps/web/lib/pwa/outbox/*` (draft-edit kind), `packages/i18n/src/messages/{en,ta,kn}/drafting.json`, `packages/i18n/translation-status.json`, `packages/i18n/src/generated/*`, possibly `apps/web/scripts/check-bundle-budget.mjs` + its test, `apps/web/lib/nav.ts` untouched.

### Sibling Sweep
Other studio pieces (#826 list page, #828 citation/consistency panels and dialogs, #829 e2e) are separate; keep their slots (panels area, export/ack dialogs) as props/slots in `studio.tsx` and do NOT touch `drafts/page.tsx`. Any new i18n keys must avoid duplicating top-level keys (single `drafting` root). Same stories-naming collision class as #80 (story export names must be unique across the stories corpus, commit e09b7321).

### History
`22df2adf` externalised drafting render libs in Next apps; #824 `43591adb` added read services, #825 `c76d3d0a` added pattern/i18n. No prior studio code.

### Recommendation
Single lane, ordered checklist: (1) actions `saveDraftAction` (`draft.write`, `{workspaceId, draftId, blocks, baseVersionNo}`; reject stale base with CONFLICT if feasible) and `restoreDraftVersionAction` (`draft.write`), plus a loader helper used by the RSC page (`getDraft` via `inWorkspace`; NOT_FOUND -> `notFound()`); (2) pure block-edit and diff helpers with unit tests (text diff of paragraph/narrative, AI-drafted marker cleared on first edit with `{blockKey, before, after}` recorded in client state and in the offline queue payload; versions themselves are the persisted diff); (3) editor components with `[[missing]]` detection, slot underline, narrative left rule; (4) facts-panel, version-drawer with restore diff preview; (5) responsive layout and reduced motion; (6) shortcuts and live region; (7) offline: cache last `getDraft` payload read-only (Dexie/Cache, encrypted) and queue edits as encrypted draft-edit items flushed through `saveDraftAction` on `online`; (8) lazy editor chunk + budget; (9) stories + tests + cross-tenant registration + i18n keys. Confidence is medium because the AI-marker/diff persistence and the outbox shape are under-specified in the issue.

### Related Issues
Parent #79 (closed not_planned); deps #824, #825 (merged); siblings #826, #828, #829 (open).
