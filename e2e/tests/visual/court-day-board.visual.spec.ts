import { existsSync } from 'node:fs';

import { seedCourtDay } from '../../fixtures/court-day-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

// `@visual` runs in every viewport × theme project (360/768/1280, light and dark) with the clock
// frozen. Baselines are generated only by the e2e workflow's `update_snapshots` dispatch. The board
// reads the real IST date on the server, so the date line and the read time are masked; the day's
// listings are the seeded chamber day (fixtures/court-day-data.ts).
for (const day of ['today', 'tomorrow'] as const) {
  test(`court-day-${day}`, { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    const baseline = testInfo.snapshotPath(`court-day-${day}.png`, { kind: 'screenshot' });
    test.skip(
      testInfo.config.updateSnapshots === 'none' && !existsSync(baseline),
      'no baseline yet: dispatch the e2e workflow with update_snapshots',
    );
    await seedCourtDay(db);
    await asUser('owner', { path: `/${day}` });
    await contentReady(page);
    await expect(page).toHaveScreenshot(`court-day-${day}.png`, {
      fullPage: true,
      mask: [page.locator('[data-day-meta]'), page.locator('[data-adapter-failure] p:last-child')],
    });
  });
}
