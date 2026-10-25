**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature; no live defect; legal pages are a launch prerequisite)
**Task Type**: feature

### What Was Claimed
Scaffold five legal pages (Terms, Privacy, DPA, AI disclosure, sub-processors) plus an index on the static site: versioned MDX under `apps/site/content/legal/`, data-driven sub-processor list checked against `infra/sub-processors.json`, draft banner + `noindex`, a build gate on drafts (`ALLOW_DRAFT_LEGAL=1`), RSS feed for sub-processor changes, Rule 36 compliance, e2e/visual/Lighthouse checks, `en` chrome strings with `ta`/`kn` stubs. Legal wording is never written by engineering (#117).

### What We Found
Verified at HEAD a99c9235 (contains #89 scaffold, so the dependency is satisfied; the `origin/milestone/...` ref was not resolvable locally, base-in-HEAD check passed).
- #89 scaffold exists: `apps/site/{app,components,lib,scripts,content,public}`, `next.config.ts:9-18` (`output: 'export'`, `trailingSlash`), no middleware/rewrites/headers() (asserted by `src/site-scaffold.test.ts:19-27`).
- `apps/site/content/legal/` holds only `draft-notice.mdx` (noindex). No `terms|privacy|dpa|ai-disclosure|sub-processors` content, no `app/legal/`, no `components/legal/`, no `scripts/legal-status.ts`, no `e2e/site/legal.spec.ts`.
- `infra/` has only `docker`, `runbooks`, `scripts`: **`infra/sub-processors.json` does not exist**.
- `lib/frontmatter.ts:11-16` is a `z.strictObject` with only `title, description, date, noindex`; legal keys (status, version, effectiveDate, history) would be rejected, so the schema must be extended.
- `lib/mdx.ts:43-67` `loadAllMdx` loads every `content/**/*.mdx` and asserts unique title and description; `app/(content)/[...slug]/page.tsx:15-18` generates a route for every MDX slug and `app/sitemap.ts:10-19` lists them all. Legal MDX would therefore also get a catch-all route (`/legal/terms/`) that collides with the dedicated `app/legal/terms/page.tsx`, and drafts must stay out of the sitemap.
- `scripts/rule36-lint.ts:64-76` already scans `content`, `app`, `components` (mdx/ts/tsx); new legal files are covered automatically. `DENYLIST` (`:11-22`) includes "testimonials?" etc.
- `content/about.mdx:19` says "software, not a legal service" but not the required phrase `software for advocates, not legal services`; `components/site-footer.tsx:5-9` links only `/legal/draft-notice/`.
- No i18n mechanism in the site (`grep locale|i18n` in app/components/lib: none). No Storybook in `apps/site` (no `.storybook`); `packages/ui` provides Badge, Accordion, Table, Separator, Sheet.
- Security page does not exist yet (#91, open, L03); the DPA must link to it, so the link target `/security/` is forward-looking.
- `.github/workflows/site.yml:46-57` build runs `pnpm turbo run lint typecheck test build` for the site, then e2e (`playwright.site.config.ts`, `testDir ./site`, 6 projects = 360/768/1280 x light/dark) and Lighthouse on `/index.html` only (`lighthouserc.json:5`). The deploy job (`:~140-175`) builds once and deploys the same artifact for `main` (production) and PR previews, so an `ALLOW_DRAFT_LEGAL` gate must be per-environment.
- `e2e/site/smoke.spec.ts:10-14` ROUTES lists three routes; axe helper `e2e/fixtures/a11y.ts` is reusable.
- Real infra for the manifest: SES/Bedrock/Sarvam/Razorpay/Sentry per `docs/engineering/env.md:21,116-118` (#110-#115); VPS host, Cloudflare, Indian Kanoon per spike §1/§6.

### Root Cause
Greenfield: the site scaffold (#89) shipped without legal pages; spike #1 §6/§9 and PRD §9 specify them but nothing implements them.

### Affected Files
`apps/site/lib/frontmatter.ts` (legal fields), `lib/legal.ts` (loader, status, version history), `lib/legal-chrome.ts` (en + ta/kn stub strings), `lib/mdx.ts` (optional filter), `app/legal/{page,terms/page,privacy/page,dpa/page,ai-disclosure/page,sub-processors/page,sub-processors/feed.xml/route}.ts(x)`, `app/(content)/[...slug]/page.tsx` + `app/sitemap.ts` (skip legal-owned slugs; add non-draft legal), `content/legal/{terms,privacy,dpa,ai-disclosure}.mdx`, `content/legal/sub-processors.ts`, `content/about.mdx`, `components/legal/*`, `components/site-footer.tsx`, `scripts/legal-status.ts`, `infra/sub-processors.json`, `package.json` (build script), `.github/workflows/site.yml`, `e2e/site/legal.spec.ts`, `e2e/site/smoke.spec.ts`, `apps/site/README.md`.

### Sibling Sweep
- Other MDX pages (`about.mdx`, `draft-notice.mdx`) go through the same strict frontmatter; the schema change must keep them valid (new keys optional outside `legal/`).
- `.md` learn/developer content (`src/learn`, `src/developer-docs.test.ts`) must not be touched.
- CLAUDE.md registries: no core export, server action, table, job, i18n catalog namespace (the site has its own chrome strings, not `packages/i18n`), or core-domain import is added, so none apply. Site must not import core/db/auth.
- Adding legal TSX/MDX widens the Rule 36 scan; counsel placeholder text must avoid denylisted phrases.

### History
Scaffold from #89 (merged as a99c9235 via PR #786); `draft-notice.mdx` is the only legal artifact. No prior attempt at #95.

### Recommendation
One lane, ordered: (1) extend frontmatter + `lib/legal.ts` with unit tests; (2) sub-processor data, `infra/sub-processors.json`, manifest-parity test; (3) components and pages, feed route; (4) MDX placeholders (structure + `TODO(counsel)` markers, no invented legal text) with required statements on AI disclosure/DPA/Terms/About; (5) `legal-status.ts` gate wired into `build`, `ALLOW_DRAFT_LEGAL=1` in site.yml build/preview, absent for `main` production deploy (so production fails until counsel text lands: intended); (6) e2e spec + smoke routes + footer. Visual baselines and Lighthouse/axe across 6 projects are measured by CI (`site.yml`), not locally.

### Related Issues
#1 (parent), #89 (dependency, done), #90 (landing), #91 (security page the DPA links to), #117 (counsel text), #110-#115 (providers listed as sub-processors).
