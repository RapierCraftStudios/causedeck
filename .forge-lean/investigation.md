**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield UI; the merged outward backend has no screen, and the inbox "Ready to send" list is permanently empty)
**Task Type**: feature

### What Was Claimed
Part 2 of #69: build the web side of outward update drafts. This covers server actions with cross-tenant registration, draft editor, Ready-to-send integration via `registerReadyProvider`, share menu (copy, `wa.me`, `mailto`, download), language switcher, diff view, keyboard shortcuts, banner, all states, an `outward` i18n namespace (en/ta/kn) with the catalog test, and Storybook stories with interaction tests and a11y. Depends on #735.

### What We Found
Verified on the current base (HEAD cc377aae, which contains #735 via PR #739).
- Dependency #735 is met: `packages/core/src/outward/index.ts:3-15` exports `composeUpdate`, `saveEdit`, `diffDraft`, `guardOutward`, `recordShared`, `recordCopied`; subpath `./outward` at `packages/core/package.json:37`; validators subpath at `packages/validators/package.json:15` (`DraftRequest`, `DraftEdit`, `ShareRecord`, `Audience`, `Language`, `Tone`, `ShareChannel`, `MAX_DRAFT_BODY` in `outward-draft.ts:9-69`). ADR `docs/adr/0039-outward-drafts-no-send-path.md`; core-domains entry exists (`docs/engineering/core-domains.md:42`).
- Services take `(deps: OutwardDeps, actor: {workspaceId,userId}, input)` and open their own workspace scope (`packages/core/src/outward/context.ts:42-50`, `compose.ts:244`, `diff.ts:99`, `share.ts:27`). Authorization is `draft.write` (`packages/auth/src/policy/actions.ts:16`, min role junior at `matrix.ts:33`), so a clerk is denied.
- **Gap: core has no read model for drafts.** No `listDrafts` or `getDraft` exists (index lists only writers). The "ready to send" list and the editor need drafts with matter, audience, language, tone, status, age, the latest version body, the system version body (for the diff) and facts (jsonb, provenance). Needs a new `packages/core/src/outward/views.ts` exported from `index.ts` (same scope and `draft.write`/matter-visibility rules as `saveEdit`, `diff.ts:105-122`).
- `registerReadyProvider` exists (`apps/web/lib/inbox/ready-providers.ts:38`) with `ReadyItemProvider{id,list,markSent}` and `ReadyAction` of kind `copy` or `open{app,href}`; NO provider is registered anywhere (grep: only the registry, inbox page `inbox/page.tsx:12` and `inbox/actions.ts:16` use it). `markSent` must map to `recordShared`. The inbox list component is `apps/web/components/inbox/ready-to-send-list.tsx`.
- The `/w/[slug]/drafts` route is a placeholder: `apps/web/app/(app)/w/[slug]/drafts/page.tsx:1-3`; it is already in the shell nav, so it is the natural home of the split-view editor.
- Action convention: `workspaceAction(schema, handler, {action})` in `apps/web/lib/workspace-action.ts`, strict zod, `assertCan`, lazy core imports, `revalidatePath` (model `inbox/actions.ts`, `memory/actions.ts`). New `'use server'` actions must be added to `ACTIONS` plus probe inputs in `apps/web/__tests__/cross-tenant-actions.test.ts:131` (memory actions imported at line 119 as the pattern).
- i18n: namespace list in `packages/i18n/src/catalog.ts` (`obligations`, `memory` near lines 40-41); files at `packages/i18n/src/messages/{en,ta,kn}/*.json`; there is no `outward` namespace. Catalog guard: `packages/i18n/src/__tests__/catalog.test.ts`. The issue/parent paths `packages/i18n/messages/...` are outdated.
- Storybook for web picks up `apps/web/components/**/*.stories.@(ts|tsx)` only (`apps/web/.storybook/main.ts:14`), so stories must live under `apps/web/components/`, not under `app/.../_outward` and not `packages/ui/src/patterns/outward` (that dir does not exist). `packages/ui` has textarea, toggle-group (segmented), badge, sheet, sonner, shortcuts-dialog; there is no diff-view primitive, so the diff view is a web component rendering `DiffPart[]` (`diff.ts:21`) with text markers (+/-) as well as colour.
- Shortcuts registry: `apps/web/lib/shortcuts/registry.ts` (Cmd/Ctrl+Enter copy, `l` language, `d` diff, Esc close per #69 design).
- No-send static test (`packages/core/src/outward/__tests__/no-send.test.ts`) covers core only; web must open `wa.me`/`mailto:` hrefs client-side with `window.open(..., 'noopener')`, and the server action only records the share.
- E2E/visual (`e2e/product|visual`) belong to sibling #737 (open), not this issue.

### Root Cause
Greenfield: the backend (#735) is merged but no read model, actions, provider, components or catalog consume it.

### Affected Files
`packages/core/src/outward/{views.ts,index.ts}` (+ test in `__tests__/`), `packages/core/src/__tests__/cross-tenant/services.test.ts` (read cases); `apps/web/app/(app)/w/[slug]/_outward/actions.ts`; `apps/web/app/(app)/w/[slug]/drafts/{page,loading,error}.tsx`; `apps/web/components/outward/*` (draft-editor, draft-list, share-menu, language-switcher, diff-view, banner, states, stories, tests); `apps/web/lib/outward/{ready-provider.ts,share-links.ts}`; `apps/web/app/(app)/w/[slug]/inbox/page.tsx` (import to register the provider); `apps/web/__tests__/cross-tenant-actions.test.ts`; `packages/i18n/src/{catalog.ts,messages/{en,ta,kn}/outward.json}`, `__tests__/catalog.test.ts`.

### Sibling Sweep
Other placeholder routes backed by merged services (`calendar`, `briefs`, `news`) belong to their own issues. The "Ready to send" registry is empty for every provider; only outward drafts (this issue) are in scope. `apps/web` has no other caller of `@causedeck/core/outward`.

### History
Backend: #735 / PR #739 (merged, `feat/issue-735-lean`). Registry and inbox list: #48. No earlier UI attempt for #736 (the `.forge-lean` files inherited from the base belong to #73).

### Recommendation
One lane, ordered: (1) core read model `listDrafts`/`getDraft` + tests; (2) i18n `outward` namespace + catalog registration; (3) `lib/outward` share-link builders and ready provider, registered from the inbox page; (4) `_outward/actions.ts` (compose, saveEdit, markShared per channel) + cross-tenant ACTIONS entries; (5) components with all states (skeleton, empty, error with retry, offline, denied), banner, shortcuts, `lang` per draft, aria-live announcements; (6) `drafts` page, loading, error; (7) stories with play tests and a11y. Visual baselines and Playwright e2e belong to #737 and CI.

### Related Issues
#69 (parent), #735 (dependency, merged), #737 (sibling: e2e and visual baselines, open), #48 (Ready to send registry).
