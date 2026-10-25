**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature; no live defect)
**Task Type**: feature

### What Was Claimed
Replace the placeholder home page of the static marketing site with the CauseDeck landing page: hero with the Court-Day Board preview, problem strip, four-beat loop, provenance, trust, courts, FAQ, CTA band and a positioning line near the footer. It must be Rule 36 safe and use only fictional sample data. Copy goes through an i18n-ready layer (en complete, ta/kn stubbed). It needs visual baselines, axe, a Lighthouse score of at least 95 and a `/design` pipeline trail.

### What We Found
- The #89 scaffold is merged and in this tree (HEAD a99c9235). `apps/site/app/page.tsx:11-35` is an explicit placeholder ("the landing page (#90) replaces it"). It already exports `pageMetadata` and the `SoftwareApplication` JSON-LD (`lib/seo.ts:5-60`) and renders a "Sign in" button to `${siteEnv.appUrl}/sign-in`.
- `apps/site/lib/env.ts:12-18` gives `NEXT_PUBLIC_APP_URL` a default, so "app URL env var missing, so CTA falls back to /contact" cannot be detected today. `/contact` does not exist (no page under `apps/site/app` or `content`).
- `apps/site/app/layout.tsx:29-31` wraps every page in `<main class="max-w-[1200px] px-4 py-10">`. A full-bleed hero or band needs to work inside, or around, that container.
- `apps/site/components/site-footer.tsx:34-36` has a weaker line ("CauseDeck is software for advocates. Customer data is stored in India."). The required verbatim positioning line is not there. The footer is shared by every page, so the exact line can go in the footer, or in a landing section that sits directly above it.
- Rule 36 lint, `apps/site/scripts/rule36-lint.ts:9-20,64`, scans `content`, `app` and `components` for `.mdx` and `.tsx?` (so `content/landing.ts` and `components/landing/*` are covered). It has no check for verbs beyond L4 (`files`, `sends`, `handles for you`). `scanText` and `DENYLIST` are exported, so a unit test can reuse them.
- Fonts are in place: Geist, Newsreader and the Noto Tamil and Kannada faces, via `app/fonts.ts:9-50`. `globals.css` wires them into `--font-sans` and `--font-serif`.
- `@causedeck/ui` exports `./patterns` (`packages/ui/package.json:64`): `ProvenanceChip`, `StageBadge`, `STAGE_MAP`, the court item chip, `LevelBadge`/`LevelLegend` (`packages/ui/src/patterns/index.ts`). `./accordion`, `./badge`, `./button`, `./card` and `./separator` are exported as well. `@causedeck/ui` is already a dependency of the site. The pattern components may use client features (popover/hover). That affects the JS budget, so check it.
- The test harness exists: `e2e/playwright.site.config.ts` has 360/768/1280 x light/dark projects, reduced motion on, and the specs serve `apps/site/out`. `e2e/site/chrome.visual.spec.ts:19-27` skips when a baseline is missing, and baselines are generated only in the pinned image through the `update_snapshots` workflow dispatch (`.github/workflows/site.yml:12-17,130-160`). Lighthouse is `apps/site/lighthouserc.json`: category floors 0.95 and a script budget of 184320 B, but only the `/index.html` URL.
- `apps/site/lighthouserc.json` has no LCP assertion, and its script budget is 180 KB, not the 120 KB gzip the issue asks for.
- `apps/site/vitest.config.ts:7` only includes `src/**`, `lib/**` and `scripts/**` tests. Unit tests for `content/` therefore go under `src/`.
- The security page (#91) is open and does not exist yet, so "each claim links to the relevant section of the security page" can only target planned anchors (`/security/#...`).
- `.forge/design/` is gitignored (`git check-ignore`), so design artefacts need `git add -f`.
- There is no site i18n layer. `packages/i18n` is app-oriented (next-intl catalog, `catalog.test.ts`) and the site does not depend on it.

### Root Cause
Greenfield. #89 deliberately shipped a placeholder home page, and the landing page is this issue's work.

### Affected Files
`apps/site/app/page.tsx`, `apps/site/app/globals.css` (landing tokens, reveal/parallax motion with reduced-motion guard), `apps/site/components/landing/*` (new), `apps/site/content/landing.ts` (new), `apps/site/lib/env.ts` and a new `lib/landing.ts` (CTA fallback), `apps/site/app/contact/page.tsx` (new mailto page), `apps/site/components/site-footer.tsx`, `apps/site/lighthouserc.json`, `apps/site/src/landing.test.ts` (new), `e2e/site/landing.spec.ts` (new), `e2e/site/smoke.spec.ts` (ROUTES), `.forge/design/landing/*`.

### Sibling Sweep
- The same placeholder/fallback pattern does not exist elsewhere. `apps/admin` is a stub and out of scope.
- The footer text is shared by `/about`, `/legal/*` and `/contact`. Changing it affects the existing chrome visual baselines, which have to be regenerated in CI.
- No `@causedeck/core` export, `'use server'` action, table, job, i18n namespace or core-domain import is added, so none of the CLAUDE.md registries apply. The site must not import core, db or auth.
- The Rule 36 lint's other scanned dirs (`app`, `components`) are all covered by the new landing files, so no lint-scope change is needed.

### History
Placeholder from the #89 scaffold (merge a99c9235, PR #786). Spec: spike #1 §1/§7/§11. No earlier landing-page attempt.

### Recommendation
One lane, ordered checklist:
1. `content/landing.ts`: typed copy, `en` complete and `ta`/`kn` as `Partial` stubs that fall back to `en`.
2. Components under `components/landing/`: non-interactive `court-day-preview` built from `@causedeck/ui/patterns` with fictional Madras HC and Karnataka HC data. It is `aria-hidden`, with an adjacent text description and an "Illustrative, sample data" label.
3. Compose `app/page.tsx` with JSON-LD kept. Add the `/contact` mailto page and the CTA fallback via an `appUrlConfigured` flag in `lib/env.ts`.
4. Put the exact positioning line in the footer.
5. Add the unit tests: copy invariants, L4 verbs, no `LegalService`, Rule 36 scan.
6. Add the e2e spec and tighten Lighthouse. Visual baselines are generated by CI, never locally.
7. Write the design-spec artefacts, with a render-critique record produced from a local build.

Keep JS small: server components by default, CSS-only reveals and parallax (no animation library), and a client component only where the ui pattern requires it. The `/design` render loop, Lighthouse, the visual baselines and the Playwright run are out of lane and measured in CI (`site.yml`).

### Related Issues
#1 (parent), #89 (done, dependency), #91 (security page that the trust links target), #95, #117 (counsel sign-off on wording), #99, #107.
