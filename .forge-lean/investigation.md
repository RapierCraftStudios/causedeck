**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (P3 greenfield, legal-gated; ships dark)
**Task Type**: feature

### What Was Claimed
Before taking a matter, a chamber must check whether it appears for the opposite party in any matter. Needs a `packages/core/src/conflicts/` name matcher (transliteration-aware for Tamil and Kannada, organisation aliases) over the chamber's own matters and parties (optionally cause-list history), a conflict check on new-matter intake in `apps/web` that never auto-blocks, an audit log of every check, no data leaving the workspace, and a flag that stays off until counsel signs off (#486).

### What We Found
- Dependency #486 is merged on base (`7afc0e6d`), so the issue is not blocked.
- No `packages/core/src/conflicts` exists; no conflict flag in `packages/flags/src/keys.ts:38-115` (registry ends at `workspace.export`, :110).
- Party data: `person` (`name`, `aliases[]`, `kind` incl. `party`/`client`) and `organisation` (`name`, `aliases[]`) at `packages/db/src/schema/people.ts:34-90`; `role_edge` kinds `represents|appears_for|opposes` at `packages/db/src/schema/enums.ts:93-99`, targeting a matter at `people.ts:92-100`. All tenant tables under FORCE RLS, so a check inside `withWorkspace` cannot see another workspace.
- Cause-list history in a workspace is `listing` (`packages/db/src/schema/docket.ts:50`); it holds no party names, so history matching can only go through proceedings/people. Treat as out of this change (issue says "optionally").
- No transliteration utility exists. Adapters keep Karnataka names "never transliterated" (`packages/adapters/src/karnataka-hc/advocate-keys.ts:3-5`), `packages/intelligence/src/structure/match-matter.ts` ranks case numbers only.
- Flag gating pattern: `requireFlag` -> `isEnabled(key, {workspaceId,userId})` -> `ActionError('NOT_FOUND')` (`apps/web/app/(app)/w/[slug]/settings/case-watch/actions.ts:50-57`). Legal-gated flags need `legal_ack_by` (`packages/flags/src/evaluate.ts:6-8,47-60`); `flag(key, desc, true, [owners])` at `keys.ts:28`; table mirrored in `docs/engineering/flags.md:25-26` (checked by `packages/flags/src/__tests__/docs.test.ts`).
- Intake: `createMatterAction` / `searchMattersAction` at `apps/web/app/(app)/w/[slug]/matters/actions.ts:50,110`, dialog `apps/web/components/matters/new-matter-dialog.tsx:39-57`, messages in `packages/i18n/src/messages/{en,kn,ta}/matters.json` (generated copies under `src/generated`).
- Audit: actions registered in `packages/core/src/audit/events.ts` (`AUDIT_ACTIONS`); writer `record` exported from `packages/core/src/audit/index.ts:65`.
- Registries: `packages/config/eslint/core-domains.js:28-36` and `docs/engineering/core-domains.md:25-26,186-187`; cross-tenant `SERVICE_TESTS`/`NOT_A_SERVICE` in `packages/db/src/testing/cross-tenant-registry.ts` (~:181, :946); `apps/web/__tests__/cross-tenant-actions.test.ts:103-184` (`ACTIONS`); `packages/core/package.json:22` export map.

### Root Cause
Greenfield. No matcher, flag, action or UI exists.

### Affected Files
- new `packages/core/src/conflicts/{index,normalize,match,check}.ts` (+ tests); `packages/core/src/index.ts`, `packages/core/package.json` (`./conflicts` export)
- `packages/flags/src/keys.ts`, `docs/engineering/flags.md`
- `packages/core/src/audit/events.ts` (+ `docs/engineering/audit.md` if its table is test-checked)
- `apps/web/app/(app)/w/[slug]/matters/actions.ts`, `apps/web/components/matters/new-matter-dialog.tsx` (+ story), `packages/i18n/src/messages/{en,kn,ta}/matters.json` and generated copies
- `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, `apps/web/__tests__/cross-tenant-actions.test.ts`

### Sibling Sweep
Other legal-gated features follow the same shape (`court.case-status` in case-watch actions, `invoices.enabled`, `limitation.enabled`): flag in registry + docs table, `requireFlag` in each action. Same registries apply as for `case-watch`/`notices` domains. No migration needed (reads existing tables).

### History
Related data layer: `person`/`role_edge` #348; DPDP posture #486 (merged, `docs/legal/court-data-posture.md`). The comment on the issue titled "Investigation Report" describes #586 (notices), not this issue; ignored. No prior attempt at #500.

### Recommendation
Add `conflicts.check` legal-gated flag (owner [500, 486]). Core `checkConflicts(deps, actor, {parties:[{name, role: 'client'|'adverse', kind: 'person'|'organisation'}]})` runs in the caller's workspace transaction: loads `person`/`organisation` with names/aliases and their `role_edge` to matters (respecting matter restriction via existing matter-graph read helpers where available), normalises names (NFKC, case-fold, honorific and `M/S`, `Pvt Ltd`/`Limited` suffix stripping with organisation alias table, Tamil U+0B80-0BFF and Kannada U+0C80-0CFF to a Latin phonetic key, vowel-length/aspirate collapse, token-order independent) and scores matches. A hit is: new adverse party equals an existing matter's client (chamber represents them) or new client equals an existing adverse party. Return hits with matter id/title, matched name, role, and `source` (person/organisation/alias). Always write one audit event (ids and counts, no names). Web: `checkConflictsAction` (flag-gated, workspace-scoped, no external calls) invoked from the new-matter dialog; results shown with sources, never blocks submission. Cause-list history deferred.

### Related Issues
#486 (merged dependency), #480, #348, #311.
