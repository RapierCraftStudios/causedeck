forge-stamp: issue=1191 contract=2cc4555e6684

### Approach
Bulk-imported judgments store an archive-member provenance URL (`….tar#member.pdf`) that no browser opens. Every source link in Research, the copilot and the drafting studio now opens a new in-app reader, `/w/<slug>/research/judgments/<id>?page=N&para=M#cited`, built by one pure helper. The reader serves `redacted_text` only (D-053). It marks the cited paragraph and gives it the `cited` anchor, so the browser scrolls to it with no client script. It also shows the citable header and offers "Download PDF" through a route that redirects to a presigned GET from our own object store.

### Changes
- packages/core/src/corpus/reader.ts: `getJudgmentForReader(id)` returns the header plus per-page paragraphs from `redacted_text`, never `page_text`. It returns null when the judgment is absent or not yet redacted. `getJudgmentPdfKey(id)` returns the stored key only when the original may be served (not masked, not sensitive).
- packages/core/src/corpus/index.ts: exports the reader services and types.
- packages/db/src/testing/cross-tenant-registry.ts: both services are in NOT_A_SERVICE, because `judgment` is a global table.
- apps/web/lib/judgment-href.ts: `judgmentHref`, `slugOf`, `isBrowsableSourceUrl`, `CITED_ANCHOR`.
- apps/web/app/(app)/w/[slug]/research/judgments/[id]/page.tsx: the reader page (header, pages, cited mark and anchor, Download PDF, not-available state, permission denied, noindex).
- apps/web/app/api/judgments/[id]/pdf/route.ts: checks the session, then redirects with a 302 to a 60 s presigned GET of a `corpus/` key; returns 404 otherwise.
- apps/web/app/(app)/w/[slug]/matters/[id]/research/page.tsx: links go to the reader; the metadata now sets `robots: { index: false, follow: false }` like the matter copilot page. It is an authenticated page, so the public-page gate (design spec, 390/1440 screenshots, canonical, JSON-LD, sitemap) does not apply (f67a28b4).
- copilot-answer.tsx, authority-search.tsx, section-view.tsx, authority-drawer.tsx, matters/[id]/research/page.tsx: links go to the reader, same tab.
- citation-panel.tsx: the reader when a `judgmentId` is known. Otherwise only a browsable http(s) source opens in a new tab; archive URLs are never linked.
- i18n research.json (en/kn/ta), plus the generated catalogs and `messages.d.ts`: `research.reader.*` strings (translated, not copied).
- .forge/design/research-judgment-reader/DESIGN_SPEC.md: the design spec.
- Tests: judgment-links.test.tsx (repro), judgment-reader-page.test.tsx, reader.test.ts. Old-href assertions were updated in authority-search, section-view, copilot and authority-drawer tests.

### Acceptance Criteria Status
- R1 ✅ apps/web/lib/judgment-href.ts:20; copilot-answer.tsx:195; authority-search.tsx:523; section-view.tsx:173; authority-drawer.tsx:73; citation-panel.tsx:59-63; matters/[id]/research/page.tsx:149
- R2 ✅ apps/web/app/(app)/w/[slug]/research/judgments/[id]/page.tsx:156,174 (mark + `#cited` anchor on the cited page)
- R3 ✅ packages/core/src/corpus/reader.ts:46; reader page.tsx:105-126
- R4 ✅ reader page.tsx:136; apps/web/app/api/judgments/[id]/pdf/route.ts:38-42
- R5 ✅ apps/web/__tests__/judgment-links.test.tsx:189: the copilot link's href, rendered in the reader, marks paragraph 12 on page 4
- R6 deferred by the contract (post-deploy, optional importer change)
- R7 guidance followed: `redacted_text` only

### Verification
- V1 web vitest (7 files): pass, 80 tests
- V2 core reader.test.ts: pass, 3 tests
- V3 i18n catalog.test.ts: pass, 34 tests
- G1 db index.test.ts: pass, 4 tests
- `turbo run typecheck --filter=...[base]`: 23/23 tasks pass. Prettier `--check` on the changed files: clean. ESLint on the changed files: 2 `no-unnecessary-condition` errors in the reader page, fixed in e2a1ee2d; now clean.
- `forgedock check`: PASS (rerun after f67a28b4). The page gate's `pageFiles` finds no public page in the diff.
- judgment-reader-page.test.tsx: a new case asserts that the matter research page is noindex (fails without f67a28b4)
- Repro "no tar links" fails without the fix: the base components render `${sourceUrl}#page=N`, so the `.tar` href assertions fail.

### Notes
- Source links now open in the same tab inside the app; previously they opened the external URL in a new tab.
- The draft citation report (`authority.resolution`, packages/core/src/drafting/citations.ts:225) stores no judgment id, so the drafts page cannot pass `judgmentId` yet. Until it does, the citation panel suppresses non-browsable archive URLs instead of linking them (recorded as a decision amendment).
- "Download PDF" is offered only for a stored, unmasked and non-sensitive original (the original carries unmasked names).
- The matter relevant-judgments page is now noindex (it was indexable by omission; it sits behind sign-in either way).
- No new env vars.

### Visual Check
not rendered: running `next build` or a dev server with a browser is forbidden on this shared host (repo CLAUDE.md); the layout follows the design spec and the neighbouring `/research` statute pages.

## Page-gate conformance (matters/[id]/research)
- The gate flagged `apps/web/app/(app)/w/[slug]/matters/[id]/research/page.tsx` as a public page. It is an
  authenticated workspace page; commit f67a28b4 declares `robots: { index: false, follow: false }` in its
  `generateMetadata` (tested in judgment-reader-page.test.tsx), so it is no longer in the public page set:
  forgedock `pageFiles()` over `git diff origin/staging...HEAD` returns `[]`. Canonical URL, JSON-LD,
  sitemap entry, design spec and screenshots therefore do not apply; recorded as a decision amendment
  plus `page_gate.sitemap_justification` in result.json.
- Re-ran V1 (81 tests), V2, V3 and G1 on HEAD: all exit 0.

## Decision anchor fix
The matters/[id]/research decision anchored a test file that is new in this branch (not on base). It now anchors only the existing page.tsx:35-39.
