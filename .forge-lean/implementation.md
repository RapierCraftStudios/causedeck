### Approach
Replace the #89 placeholder home page with the landing page: copy in a typed, locale-keyed `content/landing.ts`, server-component sections, and one client component (the illustrative Court-Day Board built from `@causedeck/ui/patterns`). Motion is CSS-only and removed under reduced motion. The CTA helper falls back to `/contact/` (a mailto page) when `NEXT_PUBLIC_APP_URL` is not set.

### Changes
- `apps/site/content/landing.ts`: copy (en complete, ta/kn stubs falling back), the positioning line, the sample label, fictional Madras HC and Karnataka HC sample board.
- `apps/site/components/landing/{hero,court-day-preview,sections}.tsx`: hero, aria-hidden and inert board preview, problem strip, loop, provenance, trust, courts, FAQ, CTA band.
- `apps/site/app/page.tsx`: composes the sections, keeps metadata and SoftwareApplication JSON-LD.
- `apps/site/lib/env.ts`, `lib/landing.ts`: `appUrlConfigured`, sign-in CTA href and contact address.
- `apps/site/app/contact/page.tsx`: mailto-only contact page.
- `apps/site/components/site-footer.tsx`: exact positioning sentence.
- `apps/site/app/globals.css`: snap strip, one-cycle change animation, scroll-driven parallax and reveal, all under `prefers-reduced-motion: no-preference`.
- `apps/site/lighthouserc.json`: script budget 120 KB, LCP under 2000 ms.
- `apps/site/src/landing.test.ts`: unit tests. `e2e/site/landing.spec.ts`, `e2e/site/smoke.spec.ts`: e2e spec and the /contact/ route.
- `.forge/design/landing/{DESIGN_SPEC,CRITIQUE}.md`: design spec and critique log (force-added, the dir is gitignored).

### Acceptance Criteria Status
- R1 ✅ (manual) `.forge/design/landing/DESIGN_SPEC.md:1`, `CRITIQUE.md:3`; a render critique on real pixels is not possible on this host, so the follow-ups are recorded for the CI render.
- R2 ✅ `components/landing/hero.tsx:12-35`, `e2e/site/landing.spec.ts:19`
- R3 ✅ `content/landing.ts:51-55`, `src/landing.test.ts:33`
- R4 ✅ `src/landing.test.ts:46-56`
- R5 ✅ `content/landing.ts:9`, `components/site-footer.tsx`, `e2e/site/landing.spec.ts:47`
- R6 ✅ `content/landing.ts` (SAMPLE_BOARD, SAMPLE_LABEL), `components/landing/court-day-preview.tsx`
- R7 ✅ `content/landing.ts` trust claims, `components/landing/sections.tsx` TrustSection
- R8 ✅ `src/landing.test.ts` automation test
- R9 ✅ `lib/landing.ts:6`, `src/landing.test.ts` CTA tests
- R10 ✅ instrumented: `apps/site/lighthouserc.json` (not measured here)
- R11 ✅ instrumented: `e2e/site/landing.spec.ts` axe test; CSS reduced-motion guards in `globals.css`
- R12 ✅ instrumented: `e2e/site/landing.spec.ts` @visual test; PNG baselines come from the CI update_snapshots dispatch
- R13 ✅ `content/landing.ts` `landingCopy`, `src/landing.test.ts` locales tests
- R14 ✅ `app/page.tsx`, `src/landing.test.ts` metadata test

### Verification
- V1 `vitest run src/landing.test.ts src/site-scaffold.test.ts src/learn src/developer-docs.test.ts lib scripts`: 44 passed. The new test file fails without the change (its imports do not exist before it).
- V2 `tsx scripts/rule36-lint.ts`: passed.
- V3 `tsc --noEmit` in `@causedeck/site`: clean.
- V4 `eslint app components content lib scripts src`: clean. `e2e` spec files also lint clean. Prettier applied to changed files.
- Not run locally by rule: `next build`, Playwright, Lighthouse.

### Notes
- The CTA falls back to `/contact/` when `NEXT_PUBLIC_APP_URL` is unset, so CI builds without that variable link to the contact page; the e2e accepts either target.
- `/contact/` is not in the sitemap (`app/sitemap.ts` is not a deliverable).
- Trust links point at `/security/#...` anchors that #91 must provide.
- The JS size of the Provenance Chip (client) is unmeasured until CI runs Lighthouse.
- The footer line changed, so the existing footer visual baselines need regenerating in CI.

- Fix: board preview column labels are now <p>, not <h3>, so the heading order is h1 → h2 (court-day-preview.tsx).
