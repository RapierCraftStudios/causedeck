**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (feature; replaces a placeholder route, no defect)
**Task Type**: feature

### What Was Claimed
Part 2 of #79: replace the placeholder `drafts` page with an RSC list (title, matter, template, last edited, citation and consistency chips; matter filter), `components/drafting/template-picker.tsx`, `loading.tsx`, `error.tsx` (request id), empty/offline/permission-denied states, a create-draft server action in `drafts/actions.ts` listed in `ACTIONS`, stories for every component and state, next-intl strings, never send/share/file.

### What We Found
- `apps/web/app/(app)/w/[slug]/drafts/page.tsx:1-3` is `placeholderPage('drafts')`; no `loading.tsx`, `error.tsx`, `actions.ts`; `apps/web/components/drafting/` does not exist.
- Core is ready (#824 merged): `listDrafts`, `listTemplates`, `createDraft` exported from `packages/core/src/drafting/index.ts:42-49,8-13`. `listDrafts(deps,actor,{matterId})` returns `DraftListItem` with `citations{verified,not_found,unknown}` and `consistency|null` (`read.ts:41-55,116`); `listTemplates` returns up to 5 `TemplateSuggestion` (`read.ts:63,283`); `createDraft({templateId,matterId,title})` throws on bad input, FORBIDDEN for clerks (`service.ts:155-208`). Clerks have no `draft.*` permission (`policy.ts:3`).
- `CitationStatus` UI pattern and `drafting` i18n namespace exist (#825). `drafting.json` `list` has only `title,newDraft,pickTemplate,empty,updated,untitled`; `states`/`offline` exist; no keys for matter filter, column labels, citation/consistency chip text, permission denied, request id, create-form (title, matter, submit, errors). New keys must be added to en/ta/kn plus `translation-status.json` and regenerated `src/generated/messages/*` (see the #825 notes in CLAUDE.md i18n checks).
- Page pattern to copy: `notices/page.tsx` (RSC, `getWorkspaceContext`, dev `?__state=`, `PermissionDeniedPage`, `EmptyState`), `notices/loading.tsx`, `notices/error.tsx`; request id (digest) shown in `[slug]/error.tsx:29-50`. Matter filter options: `lib/matters/graph-deps.ts:86-100` `loadMatterFilterOptions`; offline banner/hook: `components/matters/matters-offline-banner.tsx` (`useOnline`, `MattersOfflineBanner`).
- Action pattern: `news/actions.ts` (`workspaceAction`, `WorkspaceScoped`, ActionError mapping, async wrapper exporting). Registry: `apps/web/__tests__/cross-tenant-actions.test.ts:129` `ACTIONS` plus import at ~:97 and probe inputs; test asserts exported names equal `ACTIONS` keys (:916).
- `apps/web/__tests__/workspace-shell.test.tsx:139,163-174`: `drafts` is rendered as a placeholder page; once real it must go into `REAL_PAGES`.
- No `'use server'` outside `actions.ts`; core exports unchanged, so no core cross-tenant registry change.

### Root Cause
Not a defect: the studio list route has not been built (placeholder only).

### Affected Files
`apps/web/app/(app)/w/[slug]/drafts/{page.tsx,loading.tsx,error.tsx,actions.ts}`; `apps/web/components/drafting/{template-picker,drafts-list,...}.tsx` and `.stories.tsx`; `apps/web/lib/drafting/*` (view mapping); `packages/i18n/src/messages/{en,ta,kn}/drafting.json`, `translation-status.json`, `src/generated/messages/*`; `apps/web/__tests__/cross-tenant-actions.test.ts`, `workspace-shell.test.tsx`; a new page/component test.

### Sibling Sweep
Other pages built on the same recipe (notices, matters) each carry loading/error/denied/offline states and dev `?__state` previews; copy those. Siblings #827/#828 build the studio itself and need the list's links (`drafts/[id]`), so link targets must not 404 the list: link rows to `/w/{slug}/drafts/{id}` (route owned by #827).

### History
Placeholder from the workspace shell; core read services #824 (43591adb), UI/i18n #825 (c76d3d0a, 4ad140fd).

### Recommendation
Implement against `milestone/drafting-citations-research`: server loader in `lib/drafting` calling `listDrafts`/`listTemplates` via `inWorkspace`, mapping FORBIDDEN to permission-denied; page with matter filter via `?matter=` search param (validated UUID); template picker dialog with title + matter + submit calling `createDraftAction`, which uses `workspaceAction` and `createDraft({db: ctx.tx})` and redirects/returns the new id; no enqueue of external effects, no send/share/file. Add missing i18n keys, stories for each component/state, register the action, tests.

### Related Issues
Parent #79; depends on #824, #825 (merged); siblings #827, #828, #829.
