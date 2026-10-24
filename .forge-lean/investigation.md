**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: low (P3 greenfield data import; part 2 of #495)
**Task Type**: feature

### What Was Claimed
Import every eCourts establishment as a forum (code, state, district, establishment) at adapter level A0, from the portal's own option lists, as generated typed seed data under `packages/db/src/seed/forum-catalogue/`. Bump `FORUM_CATALOGUE_VERSION`, keep codes unique and valid, and make the per-state A1/A2 upgrade a data flag. Acceptance: the catalogue contains every eCourts establishment, with codes [integration].

### What We Found
- Catalogue assembled in `packages/db/src/seed/forum-catalogue/index.ts:22-44`: the version is `'2026-10-21.3'` (:22); `parseForumCatalogue` (:28) already rejects duplicate codes and validates each entry with `ForumSeedSchema`; the list is a spread of per-forum files (:36-42).
- Entry shape `packages/validators/src/forum.ts:93-108`: code must match `FORUM_CODE_PATTERN` (:24, lowercase, `.`-separated, digits and hyphens); `adapterLevel` is limited to A0/A1 (:102); `config.hosts` needs at least one bare hostname (:70).
- Existing A0 precedent: `chennai-district.ts:1-63`, `bengaluru-district.ts` (shared `DISTRICT` base, host `services.ecourts.gov.in`, `jurisdictionKind:'district'`, `adapterId` per district). Chennai and Bengaluru district complexes are already catalogued by hand, so the import must not duplicate their establishments or codes.
- Existing tests pin the catalogue: `forum-catalogue.test.ts:35-55` (exact enabled and disabled code lists), `:131-` (A1 count), and `packages/core/src/court/forums.test.ts:81-90` (every deep link resolves to a catalogue host). New A0 rows must be handled there; with no deep links they are unaffected by the forums.test check.
- The seed upserts on `(workspace_id, code)` and soft-disables rows that are no longer listed (`index.ts:87-135`). Thousands of rows go in a single insert; check Postgres's 65535-parameter limit (12 columns, so roughly 5,400 rows) and chunk it if exceeded.
- Portal data: `https://services.ecourts.gov.in/ecourtindia_v6/` is reachable from the host, but the state, district and complex lists load via JS or AJAX behind a session and `app_token`. A plain curl of the case-status page returned no `<option>` elements. The lists therefore need a session-aware fetch, which I did not verify end to end. No eCourts establishment data exists in the repo.
- Sibling lanes: #634 (parsers) and #636 (delegated lookups) are independent; no code from them is needed here.

### Root Cause
Greenfield: the catalogue only has hand-written Chennai and Bengaluru district forums. National district courts have no forum rows (#495 Problem).

### Affected Files
- new `packages/db/scripts/generate-ecourts-catalogue.ts` (fetches the option lists and writes the data files; run by a human or CI, never at seed time)
- new `packages/db/src/seed/forum-catalogue/ecourts/` (generated per-state typed files plus `index.ts` exporting `ECOURTS_DISTRICT`)
- `packages/db/src/seed/forum-catalogue/index.ts` (spread in, bump version, chunk inserts if needed)
- `packages/db/src/seed/forum-catalogue/forum-catalogue.test.ts`, `packages/db/src/seed/README.md`

### Sibling Sweep
Same defect class (catalogue coverage): tribunals (`tribunals.ts`) and the HCs are hand-listed and out of scope. Any test that enumerates the catalogue (`core/src/court/forums.test.ts:81`, `intelligence/src/generic-a0/__tests__/config.test.ts`, `core/src/court/__tests__/courts-pages-perf.test.ts`) needs a check that it tolerates thousands of rows.

### History
`FORUM_CATALOGUE` introduced in #34 (ADR 0014). District forums added for Chennai and Bengaluru (A0). Parent #495 closed not_planned and split into #634, #635, #636.

### Recommendation
Write a generator that walks state, district and establishment via the portal's own option lists and emits typed seed files with codes `in.<state>.<district>.<est-slug>-<est-code>`. The establishment code makes each code unique, and rows for the hand-written Chennai and Bengaluru complexes are skipped or merged by code. Keep each row at `adapterLevel:'A0'` with a shared `adapterId` per state (`in.<state>.district`), and put the upgrade in a per-state data constant. Add an integration test: every code is unique and valid, every state appears, and the per-state counts match a committed manifest. Bump the version. If the portal can't be fetched in the lane, say so and commit the data that was fetched, with the manifest stating coverage; don't invent establishments.

### Related Issues
#495 (parent), #634, #636, #34.
