// Offline court-day visual baselines (#65 part 6, #747): the board and a brief served from the
// device store, light and dark at 360, 768 and 1280 px (the viewport and theme projects).
// Baselines are generated and compared in CI. `@visual` tests get a frozen clock; the board reads
// "today" on the client, so it is frozen at 09:30 IST on the real seeded date.
import { seedCourtDay, istDate, COURT_DAY } from '../../fixtures/court-day-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { SHELL_WORKSPACE, contentReady } from '../shell/helpers.ts';

import { briefHref, expectOfflineBoard, goOffline, waitForPrefetch } from './offline-helpers.ts';

test.describe('offline court day visual', { tag: '@visual' }, () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, asUser, db, clock }) => {
    await seedCourtDay(db);
    await clock.freeze(`${istDate(0)}T09:30:00+05:30`);
    await asUser('owner', { path: 'today' });
    await contentReady(page);
    await waitForPrefetch(page);
  });

  test('offline board', async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    await expect(page).toHaveScreenshot('offline-board.png', {
      fullPage: true,
      mask: [
        page.locator('[data-offline-board] h1'),
        page.locator('[data-offline-board] [role="status"]'),
      ],
    });
  });

  test('offline brief', async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    await page.goto(await briefHref(page, COURT_DAY.sharedTitle));
    await expect(page.locator('[data-brief-sheet]').filter({ visible: true })).toBeVisible();
    await expect(page).toHaveScreenshot('offline-brief.png', { fullPage: true });
  });
});
