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

Public copy must pass the Rule 36 lint (no rankings, testimonials, outcomes or directory copy).

## Environment (all public, build time)

- `NEXT_PUBLIC_SITE_URL`: canonical origin (default `https://causedeck.example`).
- `NEXT_PUBLIC_APP_URL`: the product app origin for sign-in links.
- `NEXT_PUBLIC_ANALYTICS_SRC`: cookie-less analytics script URL. Unset by default; no script ships.
- `NEXT_PUBLIC_STATUS_URL`: where `/status` fetches `status.json` (root-relative or absolute https;
  default `/status/status.json`). An absolute origin is added to the CSP `connect-src`.
- `NEXT_PUBLIC_STATUS_VERIFY_KEY`: HMAC key the browser uses to verify the snapshot (default: the
  development key). It is public, so verification catches corruption, not a forger who can read it.
  The `/status/feed.xml` and `/status/atom.xml` feeds are built at build time from the verified
  snapshot, so they refresh only when the site is rebuilt.

## Deploy

`.github/workflows/site.yml` builds, runs Lighthouse CI (`lighthouserc.json`) and Playwright
(`e2e/site`), then deploys with wrangler: `main` is production, each PR gets a preview URL. The
deploy job skips when `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is absent. Visual baselines
are generated only in CI (`update_snapshots` input).
