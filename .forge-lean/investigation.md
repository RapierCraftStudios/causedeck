**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (P3 greenfield data importer; part 2 of #495)
**Task Type**: feature

### What Was Claimed
Rescoped 2026-10-24: build the importer, not the data. Define a JSON snapshot format for eCourts establishments (code, state, district, establishment, provenance), a validator (unique/valid codes, known states, provenance required), and an import into the forum catalogue as generated typed seed data at A0, bumping `FORUM_CATALOGUE_VERSION`. Idempotent; per-state A1/A2 is a data flag. Ship with a small fictional/test snapshot. No fetching from the portal and no uncleared data (the real list is #640).

### What We Found
- The previous run (checkpoint 7fd3037b) planned against the old scope (fetch from the portal) and stopped needs-human; its investigation and contract are superseded. The rescope removes that blocker.
- Catalogue assembled at `packages/db/src/seed/forum-catalogue/index.ts:22-44`: version `'2026-10-21.3'` (:22); `parseForumCatalogue` (:28) validates with `ForumSeedSchema` and rejects duplicate codes; list is a spread of per-forum files (:36-42).
- Seed shape `packages/validators/src/forum.ts:93-108`: `FORUM_CODE_PATTERN` (:24), `adapterLevel` limited to A0/A1 (:102), `config.hosts` >= 1 bare hostname (:70).
- A0 precedent `chennai-district.ts:1-63` (shared `DISTRICT` base, host `services.ecourts.gov.in`, `jurisdictionKind:'district'`).
- `@causedeck/db` has no direct `zod` dependency (`packages/db/package.json:42` has only `@causedeck/validators`), so the snapshot validator is hand-written TypeScript, not zod.
- Tests pin the catalogue: `forum-catalogue.test.ts:80-87` (exact enabled/disabled code lists), `:137-138` (A1 count). Shipping a fictional snapshot into the real FORUM_CATALOGUE would break those pins and seed fake courts into production, so the fictional snapshot is test-only; the shipped committed snapshot is empty.
- Upsert is one insert (`index.ts:63-110`); with a real list of thousands of rows the 65535-parameter limit matters (12 cols => ~5400 rows). Chunking is cheap and in scope for a bulk importer.
- Workspace forums are rows with non-null `workspace_id`; seed inserts `workspaceId:null` only and soft-disables only `isNull(workspaceId)` rows (`index.ts:113-126`), so workspace forums are untouched.

### Root Cause
Greenfield: no snapshot format or importer exists; only hand-written Chennai/Bengaluru district forums.

### Affected Files
- new `packages/db/src/seed/forum-catalogue/ecourts/snapshot.ts` (types, validator, `snapshotToForumSeeds`, per-state level map)
- new `packages/db/src/seed/forum-catalogue/ecourts/snapshot.json` (committed reviewed snapshot; empty `establishments` until #640)
- new `packages/db/src/seed/forum-catalogue/ecourts/index.ts` (`ECOURTS_DISTRICT`, built from the committed snapshot)
- `packages/db/src/seed/forum-catalogue/index.ts` (spread in, bump version, chunk insert)
- new `packages/db/src/seed/forum-catalogue/ecourts/snapshot.test.ts` (+ fictional fixture inside the test file), `packages/db/src/seed/README.md`

### Sibling Sweep
Other enumerators of the catalogue (`packages/core/src/court/forums.test.ts:81`, `intelligence/src/generic-a0/__tests__/config.test.ts`) are unaffected while the shipped snapshot is empty; they stay valid when #640 lands real rows as long as rows are A0 with hosts only.

### History
`FORUM_CATALOGUE` from #34 (ADR 0014); Chennai/Bengaluru A0 forums hand-written then. Parent #495 closed not_planned, split into #634, #635, #636; data is #640.

### Recommendation
Snapshot JSON: `{version, source, licence, retrievedOn, establishments:[{code, state, district, establishment}]}`; states keyed by a fixed list of 36 states/UTs with codes (`tn`, `ka`, ...), `levels` map in snapshot.ts (`Partial<Record<StateCode,'A0'|'A1'>>`, default A0) as the per-state data flag. `validateSnapshot(raw)` throws an error listing every problem: duplicate establishment codes, unknown state, bad code pattern, missing/blank provenance (source, licence). `snapshotToForumSeeds` maps to ForumSeed: code `in.<state>.<district-slug>.<est-slug>-<est-code>`, court `<District> District Courts`, adapterId `in.<state>.district`, A0, enabled, host services.ecourts.gov.in, languageProfile `{primary:'en'}`; skip establishments whose code collides with an existing hand-written catalogue code. Bump version to `2026-10-24.1`. Chunk the insert (e.g. 2000 rows) inside the same transaction. No network calls anywhere.

### Related Issues
#495 (parent), #640 (real data, needs a person), #634, #636, #34.
