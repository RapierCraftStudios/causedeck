**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield UI; last part of #480, the stored notices and matches are not visible to anyone)
**Task Type**: feature

### What Was Claimed
Part 5 of #480: an `apps/web` Notices page listing notices matched to the member's forums and matters, with provenance and source links; a matter-level "affecting this matter" card; register any server actions in `apps/web/__tests__/cross-tenant-actions.test.ts`.

### What We Found
- Dependency #586 is present on the base: `packages/core/src/notices/{index,poll,match}.ts` exist (`index.ts:4-14` exports only `pollNotices`, `matchNotices` and types); nothing reads `notice`/`notice_match` for a page. No core list/read function exists.
- Data model: `packages/db/src/schema/notices.ts:50-80` (`notice`: global, `title`, `kind`, `issuedOn`, `effectiveOn`, `url`, provenance columns, `forumCodes`) and `:84-118` (`notice_match`: tenant RLS, `matterId`, `forumId`, `reason` forum|matter_forum). `notice.sourceId` -> `source` gives the source name/terms for the provenance line.
- No `apps/web` file references notices: `apps/web/app/(app)/w/[slug]/` has no `notices` route; `apps/web/lib/nav.ts:26-43` `WORKSPACE_ROUTES` has no `notices`; the matter overview `matters/[id]/page.tsx:80-109` renders `MatterOverview` with no notices card.
- Page pattern to copy: `courts/page.tsx:1-80` (server component, `getWorkspaceContext`, dynamic `import('@causedeck/core/runtime')` + `inWorkspace`, loading/error/empty/denied states, `loading.tsx`/`error.tsx`) and `matters/[id]/research/page.tsx:20-45` (matter-scoped read via core in `inWorkspace`, `can(role,'matter.read')`, another workspace's matter -> `notFound()`).
- Read-only: no mutation is needed, so no `'use server'` action is added and `apps/web/__tests__/cross-tenant-actions.test.ts:122` `ACTIONS` is unchanged.
- A new runtime export of `@causedeck/core` needs a `SERVICE_TESTS` entry plus a real case in `packages/core/src/__tests__/cross-tenant/services.test.ts` (pattern: `listRelevantJudgments: denies` at `cross-tenant-registry.ts:700`, case at `services.test.ts:2592`); notice_match seeder exists at `packages/db/src/testing/two-tenants.ts:921`.
- Core domain `notices` already allowed to import `sources` only (`packages/config/eslint/core-domains.js:33`); a source-name join must be done with the `source` table from `@causedeck/db` schema, not by importing another domain.
- i18n: a new namespace needs en/ta/kn json, `packages/i18n/src/catalog.ts`, generated files, `translation-status.json` and the expected list at `packages/i18n/src/__tests__/catalog.test.ts:85-125` (#593 did the same for `case-watch`).
- Nav: `apps/web/__tests__/nav.test.ts:9-39` asserts `WORKSPACE_ROUTES` equals `SPIKE_ROUTES`, and shell/nav tests enumerate routes; adding a route touches them. `packages/i18n/src/messages/en/nav.json:18` holds labels. The shell bundle budget was raised in #593 (42 KB): watch it.

### Root Cause
Greenfield: parts 1-4 store, parse, poll, match (and alert, #587) notices, but no read path or UI exists.

### Affected Files
- `packages/core/src/notices/list.ts` (new; `listWorkspaceNotices`, `listMatterNotices`), `packages/core/src/notices/index.ts`, test in `notices.test.ts`
- `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`
- `apps/web/app/(app)/w/[slug]/notices/{page,loading,error}.tsx`, `apps/web/components/notices/*` (list + matter card, tests)
- `apps/web/app/(app)/w/[slug]/matters/[id]/page.tsx` and `components/matters/matter-overview.tsx` (card slot)
- `apps/web/lib/nav.ts`, nav/sidebar/mobile/workspace-shell tests, `placeholder-page.tsx` if it keys on `WorkspaceRoute`
- `packages/i18n/src/{catalog.ts,messages/{en,ta,kn}/notices.json,messages/*/nav.json,generated/*,__tests__/catalog.test.ts}`, `translation-status.json`

### Sibling Sweep
Same read-page shape as courts, research and case-watch pages; all use `inWorkspace` and core read services. Alerts (#587) are separate and untouched. Document blobs (`documentKey`) are not served here: link only to the official `url`.

### History
Schema #584, parsers #585, poll/match #586 (merged on base), alerts #587 (open). Case-watch UI (#593) is the closest i18n/nav precedent.

### Recommendation
Add core read functions (join `notice_match` to `notice` and `source` inside the caller's `inWorkspace` tx; dedupe a notice matched by both forum and matter rows; newest `issuedOn` first; cap rows), a `/w/[slug]/notices` server page with the usual states and every role reading it, a matter overview card using `listMatterNotices` (hidden/empty state when none), source link as external `rel="noopener noreferrer"` anchor, provenance line (source name, fetched/recorded date). Add nav item and i18n in all three locales.

### Related Issues
#480 (parent), #586 (dependency, done), #587 (alerts), #584, #585, #593.
