**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P2 feature: roadmap work for the #498 B2B portfolio product, no existing defect)
**Task Type**: feature

### What Was Claimed
#662 (part 2 of #498): add DRT/DRAT status and cause-list parsers and NCLT benches nationally (extending nclt-blr, #38) with golden fixtures, registered in the adapter registry and forum catalogue config. SARFAESI DM/CMM matters use the eCourts sources already present. Acceptance: parsers pass golden fixtures offline.

### What We Found
- The `.forge-lean/*` files present at start described #517 (coverage tracker). They were stale and have been replaced.
- Only NCLT Bengaluru has an adapter: `packages/adapters/src/nclt-blr/index.ts:31-33` (id, forum code and version are all `in.nclt.bengaluru`) and `:155-158` (`forumCodes: [NCLT_FORUM_CODE]`). It parses cause lists only; status is `none` (`:41-46`) and `parseOrderHeader` is a stub.
- No DRT/DRAT code exists in `packages/adapters`. The catalogue lists only `in.drt.bengaluru-1/-2` at A0 with no `adapterId` (`packages/db/src/seed/forum-catalogue/tribunals.ts:45-67`). There are no DRAT forums and only one NCLT bench (`tribunals.ts:28-43`).
- Status parsers are HTML label/value specs over `readStatusPage` (`packages/adapters/src/status/ecourts-district.ts:7-21`, `status/html.ts:84`). The template list is closed (`status/types.ts:8`). The dispatcher is `status/index.ts:12-16`, and `core/src/case-watch/lookup.ts:13,36` consumes the type.
- The eCourts cause-list parser is an HTML table parser, anchored on the case-number cell (`ecourts/cause-list.ts:1-60`). It is the template for a DRT cause-list parser.
- Registration points:
  - `adapters/src/registry.ts:25-51` rejects a duplicate id or forum code, so each forum code can map to only one adapter.
  - `config/loader.ts:63-68` (`BUNDLED_ADAPTER_CONFIGS`).
  - `workbench/index.ts:13-18` (`WORKBENCH_ADAPTERS`). `src/__tests__/fixture-regression.test.ts:30-32` requires `fixtures/accuracy-baseline.json` to list exactly these adapters.
  - `core/src/import/batch.ts:107-111`.
- Fixture conventions: `fixtures/README.md`; `fixtures/<adapter-id>/manifest.json` plus `*.input.*`/`*.expected.json`, run by `runGolden`. Status fixtures live in `fixtures/status/manifest.json`, run by `src/status/fixtures.test.ts`. Both are in `vitest.golden.config.ts`, so they run offline with no database.
- Catalogue guard tests: `forum-catalogue.test.ts:45-47` (expected codes), `:138` (exactly 4 forums at A1), `:167` (every forum has hosts). The version string is `FORUM_CATALOGUE_VERSION` in `forum-catalogue/index.ts:25`. The catalogue is seeded on deploy, so no migration is needed for forum rows.
- SARFAESI DM/CMM: covered by the eCourts district sources and parsers already merged (#634-#636); no work needed.

### Root Cause
Not a defect. The adapter framework, the NCLT table parser and the HTML status/cause-list patterns exist for 4 forum families, but nothing covers DRT/DRAT, and NCLT is bound to the Bengaluru bench.

### Affected Files
- New: `packages/adapters/src/status/{drt,nclt}.ts` (label specs), `src/drt/` (cause-list parser, `createDrtAdapter`, forum code list, config), `src/nclt-blr/config/benches.ts` (national bench codes), and fixtures under `fixtures/status/{drt,nclt}/` and `fixtures/in.drt/`.
- Edit: `status/{types,index,fixtures.test}.ts`, `src/index.ts`, `nclt-blr/index.ts` (forumCodes), `config/loader.ts`, `workbench/index.ts`, `fixtures/accuracy-baseline.json`, `fixtures/status/manifest.json`.
- Catalogue: `packages/db/src/seed/forum-catalogue/tribunals.ts` (or a new file imported by `index.ts`), `index.ts` (version bump), `forum-catalogue.test.ts`.
- Check: `packages/core/src/case-watch/lookup.ts` (it must still typecheck if the template union grows).

### Sibling Sweep
- Other code that maps a forum or adapter to its parsers: `core/src/import/batch.ts:107` (the dedicated parser list; DRT is HTML, so add it only if a layout input can reach it) and `core/src/court/forums.test.ts` (uses `in.nclt.bengaluru` and DRT codes).
- `grep CaseStatusTemplate` found only `lookup.ts` and the status package.
- The `adapter_version` and `access_mode_registry` DB rows for new adapter ids (cf. migration `0052_nclt_adapter_v1.sql`) are not required for parsing. The loader falls back to `BUNDLED_ADAPTER_CONFIGS`. Adding them is a follow-up if activation through the DB is wanted.

### History
NCLT adapter #38 (merge 2b5b4eea, migration 0052, ADR 0020). eCourts template parsers #634 (fc5b3844), status parsers #590, district status sources #636. Parent #498 was closed not_planned, but its parts #661 and #663-#666 stay open.

### Recommendation
1. Keep the NCLT adapter id `in.nclt.bengaluru` (it is pinned by migration 0052, the loader and the baseline). Extend its `forumCodes` with the national bench codes (`in.nclt.<bench>`) and seed those forums at A1 with `adapterId: 'in.nclt.bengaluru'`. Add one test that every bench resolves through the registry.
2. Add a `drt` adapter (id `in.drt`, forum codes: the DRT and DRAT forums seeded). It provides an HTML cause-list parser modelled on `ecourts/cause-list.ts`, access modes `user_supplied` or `none` as for NCLT (terms unread), and a bundled config.
3. Add `drt` and `nclt` status templates (`PageSpec` label maps) and parsers, with synthetic FICTIONAL fixtures and expected JSON.
4. Register in the loader, the workbench and the accuracy baseline, and add the DRT/DRAT/NCLT forums to the catalogue. Update the catalogue guard tests and bump the catalogue version.
5. Real DRT/NCLT page layouts are unverified, so fixtures are synthetic. This is the main risk (hence medium confidence).

### Related Issues
#498 (parent), #38, #634, #635, #636, #590, #661, #663, #664, #665, #666.
