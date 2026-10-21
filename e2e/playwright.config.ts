// Playwright config for the e2e harness (#16). See README.md for the moving parts.
//   - `E2E_SCOPE=ship|full` trims the matrix (see `scope` below; D-046).
//   - Projects: Chromium at 360, 768 and 1280 px, each in light and dark (`chromium-<w>-<theme>`),
//     plus a WebKit 360 px smoke project (`@smoke` tests only).
//   - `webServer`: support/server-pool.ts checks the Docker stack, builds apps/web (`E2E_BUILD=1`,
//     dev sign-in provider kept) and serves it on 3100 against the template database; global
//     setup then seeds the template and warms one session per role. Each worker runs its own
//     server on its own database clone (fixtures/db.ts).
import { defineConfig, devices, type Project } from '@playwright/test';

import { BASE_PORT, originFor } from './support/server-pool.ts';

// eslint-disable-next-line no-process-env -- Playwright's own CI switch.
const isCI = Boolean(process.env.CI);

// `ship` (ship PRs, D-046): every functional spec on chromium-1280-light, `@smoke` on 360-light and
// WebKit, no visual specs. `full` (default locally, nightly): the whole matrix plus visual specs.
// eslint-disable-next-line no-process-env -- the scope switch is read before Playwright loads projects.
const scope = process.env.E2E_SCOPE ?? 'full';
if (scope !== 'ship' && scope !== 'full') {
  throw new Error(`e2e: E2E_SCOPE must be "ship" or "full", got "${scope}"`);
}
const isShip = scope === 'ship';

const VIEWPORTS = {
  360: { width: 360, height: 780 },
  768: { width: 768, height: 1024 },
  1280: { width: 1280, height: 800 },
} as const;
const THEMES = ['light', 'dark'] as const;

const chromiumProjects: Project[] = Object.entries(VIEWPORTS).flatMap(([width, viewport]) =>
  THEMES.map((colorScheme) => ({
    name: `chromium-${width}-${colorScheme}`,
    use: {
      ...devices['Desktop Chrome'],
      viewport,
      colorScheme,
      // Visual baselines need motion off; the rest of the suite gets the same, deterministic UI.
      contextOptions: { reducedMotion: 'reduce' },
    },
  })),
);

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/../__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : '50%',
  timeout: 30_000,
  // Never write baselines by accident: only `--update-snapshots` (the workflow dispatch) does.
  updateSnapshots: 'none',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(isCI ? ([['github']] as const) : []),
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  testIgnore: isShip ? ['**/*.visual.spec.ts'] : [],
  projects: [
    ...(isShip
      ? chromiumProjects
          .filter(({ name }) => name === 'chromium-1280-light' || name === 'chromium-360-light')
          .map((project) =>
            // The 360 project only carries the smoke subset; 1280 runs everything.
            project.name === 'chromium-360-light' ? { ...project, grep: /@smoke/ } : project,
          )
      : chromiumProjects),
    {
      name: 'webkit-360',
      grep: /@smoke/,
      use: { ...devices['iPhone 13'], viewport: VIEWPORTS[360], colorScheme: 'light' },
    },
  ],
  webServer: {
    command: 'node --experimental-strip-types --no-warnings support/server-pool.ts serve',
    url: `${originFor(BASE_PORT)}/healthz`,
    reuseExistingServer: !isCI,
    // Includes the `next build`.
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
