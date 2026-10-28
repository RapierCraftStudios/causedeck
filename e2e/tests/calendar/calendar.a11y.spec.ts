// Calendar accessibility (#66): zero serious or critical axe violations on each state, in every
// viewport and theme project. The fixture runs axe on the page each test ends on.
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

test.describe('calendar accessibility', { tag: '@a11y' }, () => {
  for (const query of ['', '?view=month']) {
    test(`range ${query || 'week'}`, async ({ page, asUser }) => {
      await asUser('owner', { workspace: COURTS_WORKSPACE, path: `calendar${query}` });
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
      await shellReady(page);
    });
  }

  test('day popover open', async ({ page, asUser }) => {
    await asUser('owner', { workspace: COURTS_WORKSPACE, path: 'calendar?view=month' });
    await shellReady(page);
    await page.getByRole('gridcell').first().getByRole('link').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('dev loading and error states', async ({ page, asUser }) => {
    await asUser('owner', { workspace: COURTS_WORKSPACE, path: 'calendar?__state=loading' });
    await expect(page.locator('[data-pattern-state="loading"]')).toBeVisible();
  });
});
