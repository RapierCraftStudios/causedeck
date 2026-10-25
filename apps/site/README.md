# @causedeck/site

Static marketing site (Next.js `output: 'export'`, deployed to Cloudflare Pages). No server runtime,
no middleware, no tenant data and no secrets.

## Commands

- `pnpm --filter @causedeck/site dev` runs the dev server on port 3200.
- `pnpm --filter @causedeck/site build` runs the Rule 36 lint, `next build` (writes `out/`) and
  `scripts/write-headers.ts` (appends per-page CSP script hashes to `out/_headers`).
- `pnpm --filter @causedeck/site test`, `typecheck`, `lint`, `lint:rule36`.

## Content

MDX pages live in `content/**/*.mdx` and are compiled at build time (`lib/mdx.ts`). Frontmatter is
validated by `lib/frontmatter.ts`: `title`, `description`, `date` (YYYY-MM-DD) and optional
`noindex`. Invalid frontmatter or a duplicate title or description fails the build. Plain markdown
under `content/learn` and `content/developers` has its own loaders in `src/`.

### Legal pages

`content/legal/*.mdx` (terms, privacy, dpa, ai-disclosure, sub-processors) are rendered by
`app/legal/*`. Counsel supplies the text (#117); until then each page is placeholder structure with
`TODO(counsel)` markers and `status: draft`. Legal frontmatter adds `status` (`draft|final`),
`version`, `history` (date and summary, newest shown first) and `effectiveDate`, which is set only
when counsel approves (a draft must not carry one, a final page must).

- A draft page renders the `Draft pending counsel review` banner and `noindex`, and stays out of the
  sitemap.
- `scripts/legal-status.ts` runs first in `build` and fails while any page is a draft unless
  `ALLOW_DRAFT_LEGAL=1`. `site.yml` sets it for every build except `main` (production), so
  production fails until counsel's text lands and the pages are marked `final`.
- The sub-processor table is `content/legal/sub-processors.ts`. `infra/sub-processors.json` is the
  manifest of services the infrastructure uses; `lib/legal.test.ts` fails when a manifest service is
  missing from the public list. Change the data's `effectiveDate` (and add a history entry in
  `sub-processors.mdx`) on a material change: both feed `/legal/sub-processors/feed.xml`.

Public copy must pass the Rule 36 lint (no rankings, testimonials, outcomes or directory copy).

## Environment (all public, build time)

- `NEXT_PUBLIC_SITE_URL`: canonical origin (default `https://causedeck.example`).
- `NEXT_PUBLIC_APP_URL`: the product app origin for sign-in links.
- `NEXT_PUBLIC_ANALYTICS_SRC`: cookie-less analytics script URL. Unset by default; no script ships.

## Deploy

`.github/workflows/site.yml` builds, runs Lighthouse CI (`lighthouserc.json`) and Playwright
(`e2e/site`), then deploys with wrangler: `main` is production, each PR gets a preview URL. The
deploy job skips when `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is absent. Visual baselines
are generated only in CI (`update_snapshots` input).
