// Storybook visual regression (#134): every story, light and dark, at 360/768/1280. Baselines are
// Linux Chromium screenshots from the pinned Playwright image (mcr.microsoft.com/playwright:
// v1.60.0-noble, see .github/workflows/storybook.yml), so they carry no platform suffix and are
// never generated on developer machines. Run `build-storybook` first.
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const PORT = 6007;
// eslint-disable-next-line no-process-env -- the runner's CI flag, not app configuration.
const CI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: dirname,
  testMatch: 'stories.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  outputDir: path.join(dirname, 'test-results'),
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(dirname, 'playwright-report') }],
  ],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
      scale: 'css',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}/`,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `tsx ${path.join(dirname, 'serve.ts')} ${path.join(dirname, '..', 'storybook-static')} ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/index.json`,
    reuseExistingServer: !CI,
  },
});
