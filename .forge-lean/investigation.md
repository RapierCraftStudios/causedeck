**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: low (P3 feature, greenfield; no live defect)
**Task Type**: feature

### What Was Claimed
Issue #80: research link-outs (pre-filled Indian Kanoon, SC/HC judgment search, workspace-configured SCC Online/Manupatra) built from matter facts, opened in a new window, never framed or scraped; a per-matter "Research notes" area (own notes plus links to chosen authorities) with RLS and clerk denied; pinning an authority into a draft for D03 to check; per-workspace provider templates with unsafe schemes rejected; no AI on the route.
Note: the "FORGE:INVESTIGATION" comment on the issue describes a different issue (WhatsApp link card, #502 part 4) and does not apply; ignore it. The `.forge-lean/*` files committed in the tree were also for that other issue and are overwritten.

### What We Found
- Base is `origin/milestone/drafting-citations-research` (== HEAD 1071d473). None of the claimed code exists: `packages/core/src/research/` holds only `alerts.ts` and `index.ts`; no `links.ts`, `providers.ts`, `notes-service.ts`, `packages/validators/src/research.ts`, `research_note` table, or `components/research/`.
- A Research tab already exists (#497): `apps/web/lib/matters/tabs.ts:34` (`registerResearchTab`, order 40, `matter.read`), page `apps/web/app/(app)/w/[slug]/matters/[id]/research/page.tsx:25` (issue tags + `listRelevantJudgments`), `actions.ts:36` (`addTagAction` etc. via `workspaceAction`). The link-outs and notes are added to this page, not a new route.
- Tags carry statute/section/issue: `packages/db/src/schema/matter-issue.ts:33-47` (`matter_issue_tag`; proposed/confirmed/dismissed). Only confirmed tags should feed queries.
- Access helper to copy: `packages/core/src/research/alerts.ts:101` `asMatterMember` (membership role, `mayReadMatter`, NOT_FOUND for unreadable matter, `can(...)` for write). Core `research` already depends on `workspaces`, `citations` (`docs/engineering/core-domains.md:242`); `@causedeck/validators` is already a dependency of core and web (`packages/core/package.json:71`, `apps/web/package.json:65`).
- Roles: `packages/auth/src/policy/matrix.ts:19-24`: `memory.read`/`memory.write`/`strategy.read` = junior, so clerk (rank below junior) is denied; `matter.read` = viewer; `workspace.manage` = advocate. Notes are "memory-adjacent", so gate on `memory.read`/`memory.write`; issue keywords on `strategy.read`.
- `matter` has `title`, `practiceArea`, `synopsis` (`packages/db/src/schema/matter-graph.ts:29-37`); court comes from the proceedings/forum (`packages/db/src/schema/court.ts` `forum`; `ForumSummary` in `packages/core/src/matter-graph/read-models.ts:87`). Matter id, CNR and party names must never enter a URL (issue "Security and conduct").
- No drafting studio or draft model: `apps/web/app/(app)/w/[slug]/drafts/page.tsx` is a `placeholderPage('drafts')`; no `apps/web/components/drafting/`, no draft tables in `packages/db/src/schema` (grep), and D03/#77 and #81 are open. "Pin into a draft block" and `research-menu-slot.tsx` have nothing to attach to.
- Settings has no research section: `apps/web/app/(app)/w/[slug]/settings/` has audit, case-watch, court-watch, danger, export, integrations, members, notifications, privacy, profile, roles, support, usage; nav is fixed lists in `apps/web/lib/settings-nav.ts`.
- i18n: namespaces are listed in `packages/i18n/src/catalog.ts:7` and asserted in `packages/i18n/src/__tests__/catalog.test.ts`; files live in `packages/i18n/src/messages/<locale>/` (not `packages/i18n/messages`). The existing `matters.workspace.research` keys (matters.json) cover the #497 panel.
- Latest migration on base: `packages/db/migrations/20261025040000_whatsapp_inbound.sql` (+ `meta/20261025040000_snapshot.json`, `_journal.json`); the next is `20261025050000_...` (renumber if the lane moved).

### Root Cause
Greenfield feature: the research tab shows tags and verified judgments only; there is no link builder, provider registry, notes store or provider settings.

### Affected Files
- new `packages/core/src/research/providers.ts`, `links.ts`, `notes-service.ts`, `provider-service.ts`; export from `packages/core/src/research/index.ts`
- new `packages/db/src/schema/research-note.ts` (+ `research_provider` table), `schema/index.ts`, migration + snapshot + journal
- new `packages/validators/src/research.ts` (+ `index.ts` export)
- `apps/web/app/(app)/w/[slug]/matters/[id]/research/{page.tsx,actions.ts}`; new `apps/web/components/research/{link-out-menu,notes-list,note-editor}.tsx` + stories
- new `apps/web/app/(app)/w/[slug]/settings/research/{page.tsx,actions.ts}`, `apps/web/lib/settings-nav.ts`
- `packages/i18n/src/messages/{en,kn,ta}/research.json`, `catalog.ts`, catalog test, regenerated `generated/**`
- registries: `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, `apps/web/__tests__/cross-tenant-actions.test.ts`, `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/two-tenants.ts`, `docs/engineering/core-domains.md`
- `e2e/product/research.spec.ts` (CI only)

### Sibling Sweep
Same class (matter tab feature needing registry updates): every new action module must be listed in `cross-tenant-actions.test.ts:116-209` style `ACTIONS`; new core exports in `SERVICE_TESTS`/`NOT_A_SERVICE`; new tenant tables in the RLS catalog and seeders. Outbound-link safety: grep shows existing external links use `rel="noreferrer noopener" target="_blank"` (research page); reuse that and add a unit check that no `iframe` exists in `apps/web/components/research`.

### History
`research` domain and Research tab introduced by #497 (D-048). No prior attempt at #80. Dependency #394 is merged (matter workspace complete).

### Recommendation
Deliver: provider registry + pure `buildResearchLinks` (https only, host allow-list, `encodeURIComponent`, only statute/section/confirmed-issue keywords/court), per-workspace provider templates (advocate, `workspace.manage`; reject non-https and any host not matching the template's own host), `research_note` table and CRUD gated on `memory.read`/`memory.write` plus matter access, the Research tab UI (link-out menu with exact-URL preview, notes list/editor, clerk permission-denied for notes, offline read-only via `useOfflineSince`), i18n en/kn/ta, registries. Issue keywords only when the actor has `strategy.read`. Notes store authorities as `{label, citation?, url?, pinned}`; `pinned` is data only.
Defer: inserting a pinned citation into a draft block and the studio `research-menu-slot` (no draft model/studio on this lane; follows #77/#81). Visual/axe/e2e criteria are CI-only (out_of_band).

### Related Issues
#1 (parent), #394 (dependency, merged), #77 (citation checker, D03), #81 (playbooks), #497 (existing research tab).
