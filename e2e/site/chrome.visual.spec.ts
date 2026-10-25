import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';

// Header, footer and 404 in every viewport x theme project. Baselines live in
// e2e/site/__screenshots__ and are only generated in the pinned Playwright image
// (site workflow dispatch with update_snapshots); see apps/site/README.md.
const SHOTS = [
  { name: 'header', path: '/', selector: 'header' },
  { name: 'footer', path: '/', selector: 'footer' },
  { name: '404', path: '/no-such-page/', selector: 'main' },
];

for (const shot of SHOTS) {
  test(`${shot.name} @visual`, async ({ page }, testInfo) => {
    const file = `${shot.name}.png`;
    test.skip(
      testInfo.config.updateSnapshots === 'none' &&
        !existsSync(testInfo.snapshotPath(file, { kind: 'screenshot' })),
      'no baseline yet: dispatch the site workflow with update_snapshots',
    );
    await page.goto(shot.path);
    await expect(page.locator(shot.selector).first()).toBeVisible();
    await expect(page.locator(shot.selector).first()).toHaveScreenshot(file);
  });
}
