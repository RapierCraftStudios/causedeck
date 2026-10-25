// Playwright config for the static marketing site (apps/site, #89). Unlike playwright.config.ts it
// needs no database and no apps/web build: it serves apps/site/out (build it first with
// `pnpm --filter @causedeck/site build`) through site/static-server.mjs, which applies out/_headers.
// Projects: Chromium at 360, 768 and 1280 px, each in light and dark. Baselines are generated in the
// pinned Playwright image only (`--update-snapshots`, see apps/site/README.md).
import { defineConfig, devices, type Project } from '@playwright/test';

// eslint-disable-next-line no-process-env -- Playwright's own CI switch.
const isCI = Boolean(process.env.CI);
const PORT = 3300;
const VIEWPORTS = {
  360: { width: 360, height: 780 },
  768: { width: 768, height: 1024 },
  1280: { width: 1280, height: 800 },
} as const;

const projects: Project[] = Object.entries(VIEWPORTS).flatMap(([width, viewport]) =>
  (['light', 'dark'] as const).map((colorScheme) => ({
    name: `site-${width}-${colorScheme}`,
    use: {
      ...devices['Desktop Chrome'],
      viewport,
      colorScheme,
      contextOptions: { reducedMotion: 'reduce' as const },
    },
  })),
);

export default defineConfig({
  testDir: './site',
  outputDir: './test-results-site',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : '50%',
  timeout: 30_000,
  updateSnapshots: 'none',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-site' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  use: { baseURL: `http://localhost:${String(PORT)}`, locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  projects,
  webServer: {
    command: `node site/static-server.mjs ../apps/site/out ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/robots.txt`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
});
