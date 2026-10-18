# e2e

Playwright end-to-end, accessibility and visual suites for `apps/web`, plus Lighthouse CI (#16).
Everything runs locally against the Compose dev stack: no credentials, no external network.

## Running

```sh
pnpm stack:up                                  # Postgres, MinIO, Mailpit (#5)
pnpm --filter @causedeck/e2e test              # builds apps/web, seeds, runs every project
pnpm --filter @causedeck/e2e test --project=chromium-360-light tests/auth
pnpm --filter @causedeck/e2e test:ui           # Playwright UI mode
E2E_SKIP_BUILD=1 pnpm --filter @causedeck/e2e test   # reuse the last e2e build
```

`pnpm --filter e2e test` works too. Install the browsers once with
`pnpm --filter @causedeck/e2e exec playwright install chromium webkit`. Root `pnpm test` (Turborepo)
skips this package on purpose: it is the unit-test pipeline (see `support/playwright.mjs`).

| Project                                  | What runs                                          |
| ---------------------------------------- | -------------------------------------------------- |
| `chromium-{360,768,1280}-{light,dark}`   | every spec, `reducedMotion: 'reduce'`              |
| `webkit-360`                             | `@smoke` specs only                                |

Tags: `@smoke` (fast, also on WebKit and in the nightly flake job), `@a11y` (axe after the test),
`@visual` (screenshot baselines, clock frozen).

## How it works

1. **Build.** The Playwright `webServer` (`support/server-pool.ts serve`) checks the stack and runs
   `next build` with `E2E_BUILD=1 NODE_ENV=development` into `apps/web/.next-e2e`. A plain production
   build inlines `NODE_ENV=production`, which compiles out the dev sign-in provider; this build is
   optimised but keeps it. Real production builds are untouched. The server listens on `E2E_PORT`
   (3100), with `EMAIL_PROVIDER=console` and `AI_PROVIDER=mock`.
2. **Template database.** `global-setup.ts` creates `causedeck_e2e_template` from `template0`,
   applies the stack's init SQL, runs the migrations (owner role) and the `e2e` seed profile
   (`packages/db/src/seed/e2e.ts`). It then signs every seeded user in through the dev sign-in
   provider (`POST /api/auth/dev/sign-in`), saves one `storageState` per role in `e2e/.auth/`
   (gitignored), and seals the template.
3. **One database and one server per worker.** Our mechanism for the per-worker `DATABASE_URL`:
   the worker fixture (`fixtures/db.ts`) clones the template with
   `CREATE DATABASE causedeck_e2e_w<N> TEMPLATE causedeck_e2e_template`. It then starts its own
   `next start` from the e2e build on port `E2E_PORT + 1 + N` with that database's URL. `N` is
   Playwright's `parallelIndex` (`PW_WORKER_INDEX`). Workers share nothing, so `fullyParallel` is
   safe.
4. **Reset before every test.** The auto `db` fixture drops and re-clones the worker database (about
   0.2-0.4 s locally; CI fails any reset over 2 s via `E2E_ASSERT_RESET_MS=2000`). Every test
   starts from the seeded rows and the warmed sessions.

Worker servers send mail over SMTP to Mailpit rather than the console mailer: the logger redacts the
magic-link token, and tests need the real link. `readMagicLink(email)` reads it from the Mailpit API.

Environment knobs: `E2E_PORT` (3100), `E2E_DB_PREFIX` (`causedeck_e2e`, change it when two runs share
one Postgres), `E2E_DB_SUPERUSER_URL`, `E2E_MAILPIT_URL`, `E2E_SMTP_URL`, `E2E_SKIP_BUILD=1`,
`E2E_KEEP_DB=1` (keep the template after the run), `E2E_ASSERT_RESET_MS`.

## Writing specs

Import `test` and `expect` from `fixtures/index.ts`, never from `@playwright/test`:

```ts
import { expect, test } from '../../fixtures/index.ts';

test('owner sees today', { tag: '@smoke' }, async ({ page, asUser }) => {
  await asUser('owner'); // signed in, on /w/chennai-solo/today
  await expect(page.getByRole('main')).toBeVisible();
});
```

| Fixture                            | Gives you                                                              |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `asUser(role, { workspace, path })`| the page, signed in as that seeded role, on `/w/<workspace>/<path>`    |
| `db`                               | the worker database (`url`, `reset()`, `seed()`), already reset         |
| `readMagicLink(email)`             | the newest magic link this worker's server emailed during the test     |
| `a11y.expectNoViolations(page)`    | axe; fails on serious/critical violations and lists every node         |
| `clock.freeze(at?)`                | `page.clock` pinned to `2026-03-12T09:30:00+05:30`                     |

Until #18 lands, the app shell resolves workspaces from an in-memory dev stub
(`apps/web/lib/workspace-context.ts`). The seeded sessions are real, but `/w/chennai-solo/*` renders
the workspace not-found page, so shell specs use the stub's `demo` workspace for now.

Roles (from `packages/db/src/seed/e2e.ts`). Each workspace, `chennai-solo` and `bengaluru-chamber`,
has one user per role: `owner`, `advocate`, `junior`, `clerk` and `viewer`. Their email is
`<role>@<workspace>.e2e.test`.

### Deterministic data rules

- Only seeded, fictional data: fixed UUIDs and timestamps, `.e2e.test` emails, invented names. Never
  real people or parties.
- Specs never depend on order or on another spec's writes; the database is reset before each test.
- Time is frozen for `@visual` tests (automatic); call `clock.freeze()` before `page.goto` anywhere
  else time shows up.
- Motion is off (`reducedMotion: 'reduce'`, `animations: 'disabled'`, caret hidden); fonts are
  self-hosted.
- Mask anything still dynamic: `toHaveScreenshot({ mask: [page.getByTestId('…')] })`.
- No external network. If a feature calls out, stub it with `page.route`.

## Visual baselines

Baselines live in `e2e/__screenshots__/<project>/<spec>/<name>.png`. They are only ever generated in
the pinned Playwright image (`mcr.microsoft.com/playwright:v1.60.0-noble`), so local OS fonts and
rendering never leak into them:

1. Run the **E2E** workflow from the Actions tab (`workflow_dispatch`) on your branch, with
   `update_snapshots` ticked.
2. It regenerates every `@visual` screenshot in the image and opens a pull request with the new
   PNGs into that branch. Review the images, then merge.

The default is `updateSnapshots: 'none'`, so a local run never writes baselines. A `@visual` test
whose baseline does not exist yet is skipped, with a note pointing here. Diffs above
`maxDiffPixelRatio: 0.002` fail, and the expected, actual and diff images are uploaded with the
test results.

## Accessibility

Tag a spec or describe block `@a11y`. After the test body passes, axe (WCAG 2.x A/AA) runs on the
final page and any serious or critical violation fails it. Narrow the check with
`test.use({ a11yOptions: { exclude: ['selector'] } })`, and only for purely decorative content.

## Lighthouse

`pnpm --filter @causedeck/e2e lhci` runs `lighthouserc.json` against a production build of
`apps/web` (`pnpm --filter @causedeck/web build` first) on `/sign-in`, mobile. It fails unless
performance and accessibility are both >= 0.95. Set `CHROME_PATH` to a Chromium binary.

## Debugging

- HTML report: `pnpm --filter @causedeck/e2e exec playwright show-report`.
- Traces are recorded on the first retry (CI retries once). Open one with
  `pnpm --filter @causedeck/e2e exec playwright show-trace test-results/<test>/trace.zip`. In CI,
  download the `playwright-test-results-*` artifact.
- A failing test also gets `server-log.txt`: its worker server's log for that test.
- `E2E_KEEP_DB=1` keeps `causedeck_e2e_template` for inspection with psql.

## CI

`.github/workflows/e2e.yml`:

- **Pull requests and pushes:** two shards on the host. The Compose stack comes from
  `infra/scripts/dev-up.sh`, and Playwright runs inside the pinned image (`docker run --network
  host`). It uploads the HTML report and the test results, which include traces.
- **Lighthouse:** builds for production and runs `lhci`.
- **Nightly (`schedule`):** `@smoke` with `--repeat-each=5 --retries=0 --fail-on-flaky-tests`.
- **`workflow_dispatch` with `update_snapshots`:** regenerates the baselines (see above). Creating
  the PR needs "Allow GitHub Actions to create and approve pull requests" enabled in the repository
  settings.
