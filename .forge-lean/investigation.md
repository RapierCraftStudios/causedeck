**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (feature; no defect)
**Task Type**: feature

### What Was Claimed
Part 4 of #79: add `components/drafting/{citation-panel,consistency-panel,ack-dialog,export-dialog}.tsx` with stories and dialog interaction tests, wired into the studio (#827). Citation panel lists verified/not found/unknown and jumps to the span; not-found blocks export until the ack dialog is confirmed and audited (`acknowledgeUnverified`). Consistency panel groups by severity, confirm-first "Fix to graph value" (`applyFix`, new version), Undo for 7 days via Activity Feed. Export dialog: DOCX/PDF, court preset, AI-assisted state, presigned download (`createDraftExportDownload`); no send/share/file. Actions in `drafts/[id]/checks-actions.ts` listed in `cross-tenant-actions.test.ts`.

### What We Found
(verified on origin/milestone/drafting-citations-research)
- #827 landed: `apps/web/app/(app)/w/[slug]/drafts/[id]/{page,studio,actions}.tsx|ts`; `studio.tsx:82` `type Panel = 'facts' | 'versions'`, panels lazy via `next/dynamic` (`studio.tsx:42-51`), tabs at `studio.tsx:443-455`. No `checks-actions.ts`, none of the four components exist.
- Core is ready and exported from `packages/core/src/drafting/index.ts`: `checkDraft` (`citations.ts:161`, `draft.write`), `getCitationReport` (`:267`), `acknowledgeUnverified` (`citation-ack.ts:68`, `draft.export`, input `{draftVersionId,citationIds,reason}`, audits `draft.citations.acknowledged`), `exportBlockedByCitations`, `runConsistencyCheck`/`listFindings` (`consistency-service.ts:183,250`), `applyFix` (`:264`, needs `confirm:true`, saves new version, audits `draft.fix_applied`), `exportDraft` (`service.ts:435`, needs `enqueue` dep; `enqueueDraftingExport` in `packages/core/src/jobs/definitions/drafting-export.ts:80`), `createDraftExportDownload` (`export.ts:243`, 60 s presigned, needs `ObjectStore`; web store: `apps/web/lib/storage.ts:9` `objectStore()`).
- `CitationStatus` pattern exists (`packages/ui/src/patterns/citation-status/citation-status.tsx:48`).
- i18n `drafting.json` already has `panels.citations`, `panels.consistency`, `findings`, `acknowledgement`, `export` (title, docx, pdf, unverifiedWarning, action, failed). The existing `acknowledgement.statement` text differs from the issue's "I have verified these authorities myself"; keys for severity groups, fix/undo/confirm, court preset, AI-assisted, download are missing. New keys must go to en/ta/kn, `translation-status.json`, generated messages.
- Undo gap: `applyFix` only writes an audit record (`consistency-service.ts:~318`), not an `activity` row with `undoExpiresAt`. The Activity Feed undo works through `activity` rows plus a `ProposalHandler.undo` (`automation/undo.ts:170`, `handlers/index.ts`, window `UNDO_WINDOW_DAYS=7` `automation/levels.ts:30`); `kind` there is a typed proposal kind, so wiring a draft fix in means core + possibly schema changes.
- Registry: `apps/web/__tests__/cross-tenant-actions.test.ts` `ACTIONS` + probe inputs (own-workspace test pattern at :1660 for #827). No core export changes planned, so no core cross-tenant registry change.

### Root Cause
Not a defect: the studio has no checks/ack/export UI or actions.

### Affected Files
`apps/web/app/(app)/w/[slug]/drafts/[id]/{checks-actions.ts,page.tsx,studio.tsx}`; `apps/web/components/drafting/{citation-panel,consistency-panel,ack-dialog,export-dialog}.tsx` + stories + `__tests__`; `packages/i18n/src/messages/{en,ta,kn}/drafting.json`, `translation-status.json`, `src/generated/messages/*`; `apps/web/__tests__/cross-tenant-actions.test.ts`.

### Sibling Sweep
Other drafting actions (`drafts/[id]/actions.ts`) use `workspaceAction` + `rethrow` mapping; copy. Dialog patterns: `components/activity/undo-dialog.tsx`. The export enqueue must pass ids only; the export job is already registered (`apps/worker/src/__tests__/registry.test.ts:146`).

### History
Core services #768 era; read services #824, UI pattern #825, studio shell #827 (on base). #826 list on base.

### Recommendation
Add `checks-actions.ts` with `workspaceAction` actions: run checks (`checkDraft` + `runConsistencyCheck`, `draft.write`), acknowledge (`draft.export`), fix (`confirm: z.literal(true)`), export (`exportDraft` with `enqueueDraftingExport`, and a download action returning `createDraftExportDownload` URL). Build the four components as client components, lazy-loaded in the studio as new `Panel` values, with jump-to-span via existing finding navigation. Fix Undo: in-lane Undo restores the pre-fix version with `restoreVersion` (new version); the Activity Feed 7-day undo needs an `activity` row + handler in core and is deferred. Ack text: use the issue's wording in a new key (keep the old key untouched).

### Related Issues
Parent #79; depends on #827 (on base); siblings #826, #829 (e2e, open).
