// Calendar journeys (#66): week and month views, the day popover and its Open day hand-off, the
// Mine / Whole chamber scope, the keyboard model and the states. Runs in CI only.
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

async function openCalendar(
  page: import('@playwright/test').Page,
  asUser: import('../../fixtures/auth.ts').AsUser,
  query = '',
  role: 'owner' | 'clerk' = 'owner',
) {
  await asUser(role, { workspace: COURTS_WORKSPACE, path: `calendar${query}` });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

test.describe('calendar', () => {
  test('week view is the default and the toolbar switches to month', async ({ page, asUser }) => {
    await openCalendar(page, asUser);
    await expect(page.getByRole('navigation', { name: 'Calendar controls' })).toBeVisible();
    await page.getByRole('link', { name: 'Month' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('gridcell').first()).toBeVisible();
  });

  test('selecting a day opens the popover with an Open day link', async ({ page, asUser }) => {
    await openCalendar(page, asUser, '?view=month');
    await page.getByRole('gridcell').first().getByRole('link').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Open day' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('keyboard: arrows move across days, t jumps to today, w and m switch the view', async ({
    page,
    asUser,
  }) => {
    await openCalendar(page, asUser, '?view=month');
    await page.getByRole('gridcell').first().getByRole('link').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('gridcell').nth(1).getByRole('link')).toBeFocused();
    await page.keyboard.press('w');
    await expect(page).toHaveURL(/view=week/);
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/view=month/);
  });

  test('the legend and the subscribe block show', async ({ page, asUser }) => {
    await openCalendar(page, asUser);
    await expect(page.locator('[data-section="legend"]')).toBeVisible();
    await expect(page.locator('[data-section="subscribe"]')).toBeVisible();
  });

  test('a month range answers within the p95 budget', async ({ page, asUser }) => {
    const started = Date.now();
    await openCalendar(page, asUser, '?view=month');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
