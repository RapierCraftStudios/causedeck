### Approach
Copied the stage-badge capsule for a CitationStatus pattern (local status union, glyph plus text label) and added a `drafting` i18n namespace under one top-level `drafting` key (top-level `offline`/`shortcuts` already exist elsewhere).

### Changes
- packages/ui/src/patterns/citation-status/{citation-status.tsx,.test.tsx,.stories.tsx}: new pattern, test, story.
- packages/ui/src/patterns/index.ts: exports.
- packages/i18n/src/messages/{en,ta,kn}/drafting.json: list, states, panels, findings, aiDrafted, acknowledgement, export, shortcuts, offline.
- packages/i18n/src/catalog.ts, __tests__/catalog.test.ts: namespace registered, top-level key list and copy test.
- packages/i18n/translation-status.json: ta/kn drafting keys as draft; `drafting.export.pdf` allowed untranslated.
- packages/i18n/src/generated/*: regenerated with i18n:types.

### Acceptance Criteria Status
- R1 ✅ packages/ui/src/patterns/citation-status/citation-status.tsx:45, index.ts export
- R2 ✅ packages/i18n/src/messages/en/drafting.json
- R3 ✅ packages/i18n/src/catalog.ts, catalog.test.ts

### Verification
- V1 `vitest run --project unit` on citation-status, boundaries, provenance-chip: pass (50 tests). The default project also launches a Storybook browser project that needs Playwright browsers, so it was skipped.
- V2 i18n catalog and check-catalogs tests: pass (39).
- V3 i18n:check: in sync.
- New tests fail without the change (module and key missing).
- Typecheck of ui and i18n passed; eslint on changed files clean.

### Notes
No env vars. Tamil/Kannada text is marked draft for review. The scoped checks.mjs commands cover dependents (apps/web); not run locally per host rules.

### Round 5
- Added CitationStatus exports to packages/ui/src/index.test.ts list; added required stories (Loading, WithIcon, RtlNeutral, Tamil, Kannada). ui index and citation-status tests pass (30). Other flagged tests are not lists of these symbols (see result.json not_members).
