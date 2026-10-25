### Approach
Continued the checkpointed branch: the static Next.js site was largely in place. Finished the remaining contract deliverables (README, scaffold regression test, `@causedeck/config` in transpilePackages) and fixed lint errors.

### Changes
- apps/site/next.config.ts: transpilePackages now includes @causedeck/config (D4).
- apps/site/README.md: commands, content, env, deploy (D36).
- apps/site/src/site-scaffold.test.ts: regression tests for R1-R6, R12 (D37).
- apps/site/lib/mdx.ts, scripts/rule36-lint.ts, scripts/write-headers.ts: lint fixes only.
- Earlier session: all other deliverables (see git diff).

### Acceptance Criteria Status
- R1 ✅ next.config.ts:11, build output verified (V5)
- R2 ✅ lib/frontmatter.ts, lib/mdx.ts
- R3 ✅ lib/seo.ts, app/sitemap.ts, app/robots.ts
- R4 ✅ lib/seo.ts, src/site-scaffold.test.ts (JSON-LD test)
- R5 ✅ scripts/rule36-lint.ts
- R6 ✅ lib/env.ts, app/layout.tsx
- R7 ✅ app/fonts.ts
- R8 ✅ app/layout.tsx, globals.css, theme-toggle.tsx
- R9 ✅ (instrumented) lighthouserc.json, .github/workflows/site.yml
- R10 ✅ (instrumented) e2e/site/smoke.spec.ts
- R11 ✅ (instrumented) site.yml deploy job
- R12 ✅ public/_headers, scripts/write-headers.ts
- R13 ✅ (instrumented) e2e/site/chrome.visual.spec.ts

### Verification
V1 vitest: pass (28 tests). V2 tsc: pass. V3 rule36 lint: pass. V4 eslint: pass. V5 build + artifact checks: pass. `forgedock check` PASS. The scaffold test file did not exist before this change, so it cannot pass without the site code.

### Notes
pnpm-lock.yaml growth (about 1000 lines) is generated dependency resolution for the new site deps (hotspot-exempt amendment). Duplicate `metadata`/`dynamic` export names are Next.js route-file conventions.
Env vars: NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_ANALYTICS_SRC (unset by default). No devdocs freshness script in repo.

### Duplicate export names (reviewed, intentionally kept)
`metadata` (layout.tsx, page.tsx, not-found.tsx) and `dynamic` (opengraph-image.tsx, robots.ts, sitemap.ts) are Next.js App Router file-convention exports. Next reads them by exact name from each route file, so renaming one silently drops that page's metadata or its force-static setting (and `output: 'export'` needs the latter on robots, sitemap and the OG image). They are per-route file exports, not shared module APIs: nothing imports them, and no registry, map or test is keyed by them. No code change made.

### CI lint fix
CI lint log was unavailable; reproduced locally. `eslint .` in apps/site linted the gitignored `out/` static export (thousands of errors in minified chunks): added `out/**` to the ignores in apps/site/eslint.config.js. `e2e/site/smoke.spec.ts` had a `no-unnecessary-condition` error on `document.activeElement?.`: rewritten with an explicit `Element | null` check. Site and e2e eslint, prettier and e2e tsc pass.
