**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature; milestone drafting-citations-research, DR-3)
**Task Type**: feature

### What Was Claimed
Build the DR-3 consistency checker: compare a draft version against the matter graph for party names, case numbers, court/bench, dates and annexure references; deterministic, no AI, explainable findings (span + graph fact + provenance); `applyFix` only on explicit confirm (L2); workspace-scoped; idempotent per `draft_version_id` and invalidated when graph facts change; job `drafting.consistency.check`.

### What We Found
- No consistency code exists: `packages/drafting/src` has only blocks/slots/narrative/presets/render (`packages/drafting/src/index.ts:1-24`); no `consistency` dir, no `packages/validators/src/consistency.ts`, no `packages/core/src/drafting/consistency-service.ts`.
- `packages/drafting` has no db dependency (`packages/drafting/package.json:13-22`, depends on `@causedeck/ai` and validators). The issue's `checkConsistency(tx, wsId, draftVersionId)` therefore cannot live there; loading must be in core, like `loadDraftFacts` (`packages/core/src/drafting/service.ts:243-282`) which feeds pure resolvers (`packages/drafting/src/slots.ts:7-20`).
- Jobs live in `packages/core/src/jobs/definitions/` and are registered in `packages/core/src/jobs/registry.ts:48,189,250`, not `apps/worker/src/jobs` (does not exist). Model: `drafting-export.ts` (singleton + idempotencyKey, `PermanentError` for refusals). Worker guard list: `apps/worker/src/__tests__/registry.test.ts:146`.
- Draft content is an immutable block tree (`draft_version.content` jsonb, `packages/db/src/schema/drafting.ts:97-123`, hash via `contentHash` `service.ts:~56`); new versions only via `insertVersion` (`service.ts:92-120`, private), `saveVersion`/`restoreVersion` (`service.ts:196-244`). Block types: heading, paragraph, section, list, slot, narrative, page_break (`packages/validators/src/drafting.ts:11-19`).
- Graph facts available: `person.name` + `aliases text[]` with provenance (`packages/db/src/schema/people.ts:29-47`); `proceeding.caseTypeCode/caseTypeRaw/number/year/cnr/titlePetitioner/titleRespondent` with provenance (`packages/db/src/schema/proceedings.ts:40-68`); `listing.listDate/canonical/benchId` (`packages/db/src/schema/docket.ts:50-72`); `order.orderDate/benchId/nextDate` (`docket.ts:180-196`); `hearing.heldOn/nextDateConfirmed` (`docket.ts:105-115`). Provenance columns sourceType/sourceRef/anchorId (`packages/db/src/columns.ts:76-84`). Core reads these only through `matter-graph/index.ts` (domain rule in CLAUDE.md).
- Annexures: `document.kind='annexure'` exists (`packages/db/src/schema/enums.ts:106`) but `document` has NO label/number column and no link to a draft (`packages/db/src/schema/documents.ts:71-100`; link is via `matterId` only). "Uploaded annexure referenced" needs a mapping rule (see Recommendation).
- Case-line parsing precedent: `packages/adapters/src/karnataka-hc/case-line.ts`, `packages/adapters/src/ecourts/codes.ts`; drafting must not depend on adapters, so the catalogue is passed in / static variants table used.
- Persistence for "idempotent + invalidated when graph facts change" does not exist; needs a new tenant table (latest migration `packages/db/migrations/20261025225346_drafting_export.sql`).
- Dependency #768 is merged (HEAD ec1ced21), so drafts/versions exist.

### Root Cause
Greenfield: DR-3 was never implemented. Spike #1 §2 puts the checker in `packages/drafting`, but that package is pure and has no db access, so the issue's file layout needs adjusting (pure checker in drafting, loader/service/job in core).

### Affected Files
New: `packages/drafting/src/consistency/{extract-entities,match-names,match-case-numbers,match-dates,annexures,check,index}.ts`; `packages/validators/src/consistency.ts`; `packages/core/src/drafting/consistency-service.ts`; `packages/core/src/jobs/definitions/drafting-consistency-check.ts`; `packages/db/src/schema/drafting.ts` (+ migration, `draft_consistency_report`); tests under `packages/drafting/src/consistency/__tests__/` (the package's vitest has no `test/` dir convention; tests sit in `src/**/__tests__`).
Edited: `packages/drafting/src/index.ts`, `packages/validators` exports/package.json, `packages/core/src/drafting/index.ts`, `packages/core/src/jobs/registry.ts`, `packages/core/src/matter-graph/index.ts` only if a needed read is not exported, `docs/engineering/core-domains.md`, registries listed in CLAUDE.md (cross-tenant registry + services test, db index/RLS/seeders, worker registry test).

### Sibling Sweep
Same class (new core runtime export / table / job needing registration): `drafting.export` (#768) touched `cross-tenant-registry.ts`, `services.test.ts`, `registry.test.ts`, `core-domains.md`; mirror it. No other checker with name/date matching exists (`grep` of `packages/core/src` finds no annexure logic); citation checker (#77) is separate.

### History
Drafting data layer #766, engine #767, service/export #768 (merge ec1ced21, PR #817). No prior consistency work; #75 closed not_planned (decomposed).

### Recommendation
Single lane, deliver all. Design:
1. Pure checker in drafting: `checkDraft({blocks, facts}) => Finding[]`; `Facts` for consistency are richer than slot `Facts` (all parties with aliases + provenance, proceedings, canonical listing, orders, bench, annexure documents). Spans = `{blockKey, start, end}` over block text (never logged).
2. Names: NFC + casefold, strip honorifics (Mr/Mrs/Smt/Shri/Dr/Thiru/Sri...), initials expansion, alias set from `person.aliases`; script differences accepted only when an alias exists. Case numbers: normalise `W.P.No.1234 of 2025`, `WP 1234/2025`, `W.P. (MD) No. 1234 of 2025` variants vs `caseTypeCode/number/year`; >=10 variants per Madras and Karnataka in tests. Dates: dd/mm/yyyy, dd.mm.yyyy, `1st January 2025`, ordinal words; compare with canonical listing / order dates and report both values. Annexures: distinct rules `annexure.missing`, `annexure.duplicate`, `annexure.gap`, `annexure.unreferenced`.
3. Annexure mapping (K-decision): with no label column, the n-th `kind='annexure'` document of the matter (ordered by createdAt, id) is `Annexure P-n`; no schema change to `document`.
4. Persistence: table `draft_consistency_report` (workspace_id, draft_version_id, graph_revision text, report jsonb, unique(draft_version_id, graph_revision)); `graphRevision` = sha256 of canonical facts so a new listing/order yields a new revision, the stale row is superseded, same inputs return the stored row.
5. `applyFix(deps, actor, {draftVersionId, findingId, confirm})` requires literal `confirm: true`, re-runs the check, replaces only that finding's span via a new version (export `insertVersion`-based helper from service.ts), audit event; no other write path. Needs `draft.write`.
6. Job `drafting.consistency.check` payload `{workspaceId, draftVersionId}` (+ `userId` as actor like export), singleton on `draftVersionId`.
7. Static test: no `@causedeck/ai` import under `consistency/`. Perf test: 30-page synthetic draft < 2 s (assert generous bound on the pure checker).
Run `checks.mjs` for scoped typecheck/lint/tests; add migration with next free number.

### Related Issues
#1 (parent), #768 (dependency, merged), #75 (closed, decomposed), #77 (citation checker, out of scope), #79 (studio panel, out of scope).
