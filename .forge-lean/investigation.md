**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (feature; no live defect)
**Task Type**: feature

### What Was Claimed
Ship the v1 system template set (PRD DR-1) for Madras HC and Karnataka HC (mention/adjournment memo, early-listing memo, memo of appearance, certified-copy application, client covering letter) plus A0 forum adjournment note and client letter, as seeded system `template` rows (null `workspace_id`) consumed by the #767 engine, with a scaffold banner, checksum-idempotent seeding, citation and advice lints, i18n stubs and a doc. Depends on #768 (merged, `ec1ced21`).
(Note: the `.forge-lean/*` files on disk before this run described #768 and were stale; they are replaced.)

### What We Found
- No system templates exist: `packages/drafting/src` has only `blocks.ts, slots.ts, narrative.ts, presets/{madras-hc,karnataka-hc}.ts, render/*`; no `system-templates/`, no `packages/db/src/seed/system-templates.ts`, no `drafting-templates` i18n namespace (`packages/i18n/src/catalog.ts:7` NAMESPACES; messages live in `packages/i18n/src/messages/{en,kn,ta}/`, not `packages/i18n/messages` as the issue says).
- `template` table (`packages/db/src/schema/drafting.ts:36-56`): `workspace_id` null = system, unique `(workspace_id, code)` nulls-not-distinct, has `version`, `enabled`; NO `checksum`, `reviewed_by` or `is_system` column. Idempotent "update only on checksum change", the banner rule and `is_system = true` need a migration (latest: `packages/db/migrations/20261025225346_drafting_export.sql`).
- RLS already makes `template` read-only to workspaces for system rows: policies `ws_isolation`, `global_read` (SELECT), `owner_catalogue` (ALL) asserted at `packages/db/src/__tests__/rls/sql.test.ts:301`.
- Block language is closed (`packages/validators/src/drafting.ts:13-24`): slot resolvers are only matter/party/hearing/advocate/workspace/date; there is NO client resolver, so a client covering letter cannot today read client data. `Facts` is at `packages/drafting/src/slots.ts:7`. Clients are `person` rows with `kind='client'` (`packages/db/src/schema/people.ts:38`), linked to matters by `role_edge`.
- `TEMPLATE_KINDS` = notice, petition, affidavit, reply, memo, other (`validators/src/drafting.ts:48`); `DRAFTING_LOCALES` en/kn/ta; presets `madras_hc`, `karnataka_hc` exist (`packages/drafting/src/presets/`).
- Case-type catalogue is owned by adapters: `MADRAS_HC_CASE_TYPES`, `caseTypeInfo` (`packages/adapters/src/madras-hc/config/case-types.ts:128,136`) and `packages/adapters/src/karnataka-hc/config/case-types.ts` (partial, `verified` flag). `@causedeck/drafting` does not depend on `@causedeck/adapters` (`packages/drafting/package.json`); boundaries allow it (`packages/config/eslint/boundaries.js:8-10`, only `core`/`ui` are barred), and adapters does not depend on drafting, so no cycle.
- `@causedeck/db` may import only config, i18n, validators (`boundaries.js` DB_DEPENDENCIES), so the db seed cannot import the drafting registry. Precedent: the forum catalogue seed is owner-run from `packages/db/scripts/migrate.ts` (`seedForumCatalogue`, `packages/db/src/seed/forum-catalogue/index.ts`).
- Export + audit exist from #768: `packages/core/src/drafting/export.ts:184-190` records `draft.exported` with metadata `{format, versionHash}` only (no banner state); `renderDraft`/`service.ts:372` already looks up the template row. `RenderOptions` (`packages/drafting/src/render/common.ts:12`) has no banner option.
- Script fallback for Tamil/Kannada already exists in PDF (`packages/drafting/src/render/pdf.ts:47-120`).
- Copying a system template into a workspace is not in core (user-owned templates are #81, out of scope per the issue).

### Root Cause
Greenfield feature: the engine, presets and tables exist but there is no template content, no seeding path, no review/banner state and no client slot.

### Affected Files
`packages/drafting/src/system-templates/**` (+ `index.ts` registry, lints), `packages/drafting/src/{slots.ts,render/common.ts,render/docx.ts,render/pdf.ts,index.ts}`, `packages/drafting/package.json`, `packages/validators/src/drafting.ts`, `packages/db/src/schema/drafting.ts` + migration/snapshot/journal, `packages/db/src/seed/system-templates.ts` (+ export in `packages/db/package.json`), `packages/core/src/drafting/{service.ts,export.ts}` + a seed glue + `packages/core/package.json`, `packages/i18n/src/messages/{en,ta,kn}/drafting-templates.json` + `catalog.ts` + generated catalogs, `docs/engineering/drafting-templates.md`, tests.

### Sibling Sweep
Same class (catalogue data seeded by the owner, global-or-workspace reads): `forum`, `court_hall`, `bench` via `seedForumCatalogue`. Registry guards to keep green: i18n `catalog.test.ts`/`check-catalogs.test.ts`, `packages/validators/src/drafting.test.ts` (resolver list), `packages/db/src/__tests__/rls/sql.test.ts`, `core/src/__tests__/cross-tenant` (no new core runtime export is a service unless `seedSystemTemplates` is exported from the core index; keep it out of `packages/core/src/index.ts` or list it in `NOT_A_SERVICE`).

### History
`d78af9e4` (#767) engine and presets; `#766` data layer; `#768` core service and export (PR #817). No earlier system-template work.

### Recommendation
Single lane with an ordered checklist (about 25 files, under the split threshold): (1) migration adding `template.checksum`, `reviewed_by`, generated `is_system`; (2) add `client.name` resolver and `Facts.client`, loaded by core only from `person.kind='client'` linked to the matter; (3) render banner option and `bannerShown` in audit; (4) template files, registry with semver+sha256, lints; (5) db seeder taking entries, plus core glue run as owner; (6) i18n; (7) doc. The counsel covering letter named in the prose is not in the v1 catalogue table and needs a non-client recipient slot, so it is deferred.

### Related Issues
#75 (parent, closed), #768 (dependency, merged), #77, #79, #81 (out of scope), #1.
