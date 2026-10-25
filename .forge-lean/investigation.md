**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature, no live defect; blocks #90, #91, #95)
**Task Type**: feature

### What Was Claimed
Scaffold `apps/site` as a static marketing site: Next.js `output: 'export'`, MDX content with zod-validated frontmatter, per-page SEO metadata, sitemap/robots, build-time OG image, SoftwareApplication-only JSON-LD, Rule 36 copy lint, self-hosted fonts, `packages/ui` tokens with next-themes, `_headers`/`_redirects`, Cloudflare Pages workflow, Lighthouse CI, axe/e2e smoke, visual baselines, README. Depends on #134 (closed).

### What We Found
(Verified against `origin/milestone/site-onboarding-launch` = b1c3467a. The "Investigation Report" comment on #89 is about a WhatsApp settings UI, is unrelated to this issue, and was ignored. The existing `.forge-lean/*` files in the tree were stale from another issue and are overwritten.)
- `apps/site` is a stub, not an app: `apps/site/package.json:9` build script is `node -e "console.log('nothing to build yet')"`; devDependencies only config/types/eslint/ts/vitest (`package.json:13-19`). No next, react, mdx, zod, next-themes, `app/`, `public/`, `next.config.ts`, `lib/`, `components/`.
- Package name is `@causedeck/site` (`package.json:2`); the issue's `pnpm --filter site build` equals `pnpm --filter @causedeck/site build` (renaming would break `src/index.ts:2` and `src/index.test.ts`).
- Existing site content is plain `.md` with a different frontmatter schema (`slug/locale/title/order/law/fixture/reviewer/reviewedOn`): `apps/site/content/learn/**/{en,kn,ta}.md`, `content/developers/api.md`; consumed by `src/learn/*` and tested by `src/learn/learn.test.ts:59`, `src/developer-docs.test.ts:6`. The new MDX pipeline must not touch `.md` files or these.
- `apps/site/tsconfig.json:3` includes only `src` and `*.ts`; must add `app`, `lib`, `components`, `scripts`, `next-env.d.ts`, `.next/types`. ESLint already uses `@causedeck/config/eslint/next` (`eslint.config.js:1`); `APP_NAMES` already contains `site` (`packages/config/eslint/boundaries.js:151`).
- Reusable references in web: fonts via `next/font/local` from `packages/ui/fonts/*.woff2` (`apps/web/app/fonts.ts:10-50`, files incl. noto-sans-tamil/kannada present), token imports and Tailwind preset (`apps/web/app/globals.css:1-14`), `next.config.ts` `transpilePackages` list (`apps/web/next.config.ts:15-34`) and security headers (`:38-48`).
- Catalog (`pnpm-workspace.yaml`) has next 16.4.2 (`:146`), react 19.3.1, next-themes 0.4.6 (`:148`), zod 4.6.7 (`:190`), tailwind 4.3.3 / `@tailwindcss/postcss`, `@lhci/cli` (`:65`), `@playwright/test`, `@axe-core/playwright` (`:54`), tsx (`:179`), sharp. Missing: any MDX package, wrangler.
- CI: `turbo.json:5-7` build outputs list has no `out/**`; `ci.yml:188` build job runs `ci-affected.sh build` (so site's real build will run in CI). No `site.yml`. E2E harness (`e2e/playwright.config.ts:121-135`) has a single `webServer` building apps/web plus DB global setup, so site specs need their own config. Lighthouse configs are per-surface (`e2e/lighthouserc*.json`).
- No `rule36` lint, `_headers`, `_redirects`, sitemap, robots anywhere in the repo.

### Root Cause
Greenfield: #2 created the empty package; the site was never built (spike #1 §1/§2/§3.3 specify it).

### Affected Files
`apps/site/{package.json,tsconfig.json,next.config.ts,postcss.config.mjs,vitest.config.ts,eslint.config.js,README.md}`, `apps/site/app/**` (layout, page, `(content)/[...slug]`, sitemap, robots, not-found, opengraph-image, globals.css, fonts.ts), `apps/site/lib/{mdx,seo,env,frontmatter}.ts`, `apps/site/components/*`, `apps/site/content/**/*.mdx`, `apps/site/public/_headers|_redirects`, `apps/site/scripts/{rule36-lint,write-headers}.ts`, `apps/site/lighthouserc.json`, `.github/workflows/site.yml`, `e2e/site/smoke.spec.ts` + `e2e/playwright.site.config.ts`, `turbo.json`, `pnpm-workspace.yaml` + `pnpm-lock.yaml`, `docs/engineering/ci.md` (site job note).

### Sibling Sweep
- Other apps with next config: only `apps/web` (reference); `apps/admin` is a similar stub (out of scope).
- Registries from CLAUDE.md: no `@causedeck/core` export, `'use server'` action, table, job, i18n namespace, or core-domain import is added, so none apply. The site must not import `@causedeck/core`/db/auth (no tenant data).
- `.md` learn/developer content and `src/learn` keep working; the Rule 36 lint should scan MDX/TSX under `app`, `components`, `content/**/*.mdx` only, so existing legal-education `.md` (which legitimately mentions lawyers) is not flagged unless counsel-scope decides otherwise.

### History
Stub from db3e22d4 (#2) and 937e90fe (#3); content added by 1f599f4e (#627 API docs), edd19927 (learn modules), 8d6fd8da. No prior attempt at the app itself.

### Recommendation
One lane, ordered: (1) deps and config; (2) env/frontmatter/seo libs with unit tests; (3) layout/theme/fonts/components; (4) MDX route, sitemap, robots, OG, 404; (5) rule36 lint wired into `build`; (6) `_headers` generation; (7) CI workflow, lighthouse config, e2e spec, README. Use `next-mdx-remote/rsc` `compileMDX` (one new dep, works in static export, pure build-time) rather than `@next/mdx` + loader + react + types. CSP "without inline scripts" conflicts with Next's inline bootstrap scripts and next-themes' no-flash script, so a post-build step hashes each page's inline scripts into per-route `script-src 'sha256-…'` entries in `out/_headers` (no `unsafe-inline`). `build` = `next build && tsx scripts/write-headers.ts`, preceded by the rule36 lint. Browser/CI-only criteria (Lighthouse, axe, visual baselines, deploy) are delivered as config/spec/workflow and measured in CI, never run locally.

### Related Issues
#1 (parent), #134 (dependency, closed), #90, #91, #95 (consume the scaffold), #99, #107 (Cloudflare credentials), #117 (counsel sign-off).
