### Approach
Legal bodies are placeholder MDX (structure and `TODO(counsel)` markers only) loaded through the existing `compileMDX` pipeline, with legal frontmatter (status, version, history, effectiveDate) validated by a new strict schema. Dedicated `app/legal/*` pages own their slugs; the catch-all route and sitemap skip them, and drafts are `noindex` and out of the sitemap. A build gate (`scripts/legal-status.ts`) fails on drafts unless `ALLOW_DRAFT_LEGAL=1`.

### Changes
- apps/site/lib/frontmatter.ts: optional legal keys; `legalFrontmatterSchema`, `parseLegalFrontmatter`.
- apps/site/lib/legal.ts: loader, headings, metadata, draft check, feed items/RSS, manifest parity helper.
- apps/site/lib/legal-chrome.ts: en chrome strings, ta/kn stubs falling back to en.
- apps/site/lib/legal.test.ts: regression tests.
- apps/site/app/legal/**: index, five pages, `sub-processors/feed.xml/route.ts` (static RSS).
- apps/site/content/legal/{terms,privacy,dpa,ai-disclosure,sub-processors}.mdx and `sub-processors.ts`; infra/sub-processors.json.
- apps/site/components/legal/{legal-layout,draft-banner,subprocessor-table,version-history}.tsx; site-footer.tsx links.
- apps/site/scripts/legal-status.ts; package.json (`build` runs the gate first, `lint:legal`).
- .github/workflows/site.yml: build step split; `ALLOW_DRAFT_LEGAL` set for all refs except `main`; lighthouserc.json: legal URLs.
- (content)/[...slug]/page.tsx, sitemap.ts: skip legal-owned slugs; add non-draft legal pages.
- content/about.mdx: positioning sentence; README.md; e2e/site/legal.spec.ts, smoke.spec.ts.

### Acceptance Criteria Status
- R1 ✅ app/legal/*/page.tsx, components/legal/legal-layout.tsx (TOC, version, effective date, print CSS); e2e/site/legal.spec.ts
- R2 ✅ components/legal/draft-banner.tsx, lib/legal.ts (noindex), scripts/legal-status.ts, site.yml
- R3 ✅ content/legal/sub-processors.ts, components/legal/subprocessor-table.tsx
- R4 ✅ infra/sub-processors.json, lib/legal.test.ts (manifest parity)
- R5 ✅ content/legal/ai-disclosure.mdx
- R6 ✅ content/legal/dpa.mdx
- R7 ✅ frontmatter history, components/legal/version-history.tsx, feed route
- R8 ✅ terms.mdx, about.mdx, rule36 test
- R9 ✅ instrumented: e2e/site/legal.spec.ts axe, lighthouserc.json URLs (measured in CI)
- R10 ✅ instrumented: legal.spec.ts screenshots (baselines generated in CI)
- R11 ✅ lib/legal-chrome.ts, language note
- R12 ✅ privacy/dpa/terms positioning
- R13 ✅ placeholders only, no effective date

### Verification
- V1 vitest (lib/legal.test.ts, site-scaffold, developer-docs, learn): 45 passed. The new tests fail without the change (modules and content are absent).
- V2 legal-status with ALLOW_DRAFT_LEGAL=1 exits 0, without it exits 1, rule36 lint passes.
- V3 checks.mjs widened to full turbo because site.yml changed; per CLAUDE.md I did not run full lint. Ran site `tsc --noEmit` (clean), eslint on changed files (clean), prettier. `next build`, Playwright and Lighthouse were not run (CI only).

### Notes
- Added content/legal/sub-processors.mdx (amendment): version history comes from MDX frontmatter for all five pages.
- Production build fails while drafts exist (intended); `ALLOW_DRAFT_LEGAL` is passed outside turbo (strict env).
- TOC is a collapsible `<details>` below 1280 px (no sheet at 768) and sticky from 1280.
- Sub-processor effective dates (2026-10-25), hosting provider name and Sentry region are placeholders for counsel/infra to confirm.

### Recovery pass: CI `build` job failure (no log available)
Could not reproduce locally. Every step of the `site build` job that can run here passes: legal-status (with ALLOW_DRAFT_LEGAL=1), rule36 lint, `tsc --noEmit`, `eslint .` in apps/site, vitest (46 tests), and a react-dom/server render of all five legal pages with correct `noindex` metadata. Only `next build` and `write-headers` (CI only per CLAUDE.md) remain unverified. No speculative code change made; the CI log is needed to identify the failing step.

### Recovery pass 2
Re-ran tsc, vitest (46 pass), eslint on all of apps/site, prettier on changed files, legal-status, rule36 lint and an MDX compile of every content page: all clean. Still no CI log, so the failing step is unidentified; no speculative change. Needs the log of job 121303516579.
