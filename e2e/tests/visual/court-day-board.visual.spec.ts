import { existsSync } from 'node:fs';

import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

// `@visual` runs in every viewport × theme project (360/768/1280, light and dark) with the clock
// frozen. Baselines are generated only by the e2e workflow's `update_snapshots` dispatch.
for (const day of ['today', 'tomorrow'] as const) {
  test(`court-day-${day}`, { tag: '@visual' }, async ({ page, asUser }, testInfo) => {
    const baseline = testInfo.snapshotPath(`court-day-${day}.png`, { kind: 'screenshot' });
    test.skip(
      testInfo.config.updateSnapshots === 'none' && !existsSync(baseline),
      'no baseline yet: dispatch the e2e workflow with update_snapshots',
    );
    await asUser('owner', { path: `/${day}` });
    await contentReady(page);
    await expect(page).toHaveScreenshot(`court-day-${day}.png`, { fullPage: true });
  });
}
