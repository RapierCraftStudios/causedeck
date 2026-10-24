**Verdict**: BLOCKED
**Confidence**: high
**Severity**: P1 feature, legal-gated (ships dark); too large for one lane
**Task Type**: feature

### What Was Claimed
National district-court coverage through one eCourts template adapter (`packages/adapters/src/ecourts/`: status, cause list, orders parsers; state/district/establishment codes and case-type maps from the portal's option lists), a forum catalogue holding every eCourts establishment at A0 (upgraded to A1/A2 per state once fixtures pass), golden fixtures for 5 states (TN, KA, MH, DL, UP), and delegated lookups (#483) with per-host rate budgets.

### What We Found
- Dependencies are closed: #479 (`packages/fetch`) and #483's sub-issues #589-#593 (`packages/core/src/case-watch/` exists, `lookup.ts:42-44` has `STATUS_SOURCES`). Not blocked on upstream.
- No `packages/adapters/src/ecourts/` exists. The only eCourts code is the status page parser `packages/adapters/src/status/ecourts-district.ts:1-21` (status + orders table of one template, no cause list parser, no state/district/case-type maps).
- Status fixtures cover only 3 templates, fictional: `packages/adapters/fixtures/status/{ecourts-district,madras-hc,karnataka-hc}`, enumerated by `packages/adapters/src/status/fixtures.test.ts:20-46` and `manifest.json`. `CASE_STATUS_TEMPLATES` is a closed 3-value list (`status/types.ts:8`).
- Forum catalogue lists only Chennai and Bengaluru districts: `packages/db/src/seed/forum-catalogue/index.ts:44-50`, `chennai-district.ts`, `bengaluru-district.ts`; all A0 with hand-written entries; version `FORUM_CATALOGUE_VERSION` at `index.ts:20` must be bumped on any data change.
- Delegated lookup wires only one eCourts source: `packages/core/src/case-watch/lookup.ts:42` (`in.tn.chennai-district:case_status`); sources registry in `packages/core/src/sources/registry.ts`. Per-host rate budgets live in `packages/fetch/src/rate-limit.ts`.
- Cause-list contract (`ParsedCauseList`, `packages/adapters/src/types.ts:231`) and the Madras/Karnataka cause-list parsers are the pattern for a new cause-list reader.

### Root Cause
Greenfield. District courts are A0 (generic parsing) and the eCourts template cluster (cause list, orders, state/district maps, national establishment list) has not been built.

### Affected Files
- new `packages/adapters/src/ecourts/**` (+ registry/index wiring, fixtures for 5 states x 3 page types, tests)
- `packages/db/src/seed/forum-catalogue/` (new generated establishment data, `index.ts` version bump, tests)
- `packages/core/src/case-watch/lookup.ts`, `packages/core/src/sources/*`, `packages/fetch` rate budgets, registries (cross-tenant, `docs/engineering/core-domains.md` if needed)

### Sibling Sweep
Same shape as the Chennai/Bengaluru district catalogues and the Madras/Karnataka adapters; those hand-written patterns do not scale to ~3000+ establishments, so the catalogue needs a generated, data-driven file. Fixtures must remain FICTIONAL per the manifest classification check (`fixtures.test.ts:30-33`).

### History
Status parsers: #590; case-watch core/worker/web: #591-#593; fetch layer: #479. Decomposed tracker #483 closed not_planned in favour of its sub-issues. No prior attempt at #495 in tree (the stale `.forge-lean` files from #500 were removed).

### Recommendation
Split into three sub-issues with disjoint files: (0) eCourts template adapter, parsers and 5-state fixtures; (1) forum catalogue import of all establishments (generated data, from the portal's own option lists, with codes); (2) delegated lookup wiring, sources registry rows and per-host rate budgets, depending on 0 and 1. Estimated 45+ files, 4000+ lines, above the 25 files / 1500 lines budget.

### Related Issues
#479, #483, #589-#593, #590, #34 (forum catalogue).
