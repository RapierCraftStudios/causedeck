// Court-day board journeys (#59) on `/w/<shell workspace>/today` and `/tomorrow`: the day header,
// the day switch, the hall rail at phone width, the keyboard help and the court-is-at control.
// `@a11y` runs axe with zero serious violations. Runs in CI only.
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

test.describe('court-day board', () => {
  test(
    'today shows the day header and switches to tomorrow',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await asUser('owner', { path: '/today' });
      await contentReady(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await page.getByRole('link', { name: 'Tomorrow' }).click();
      await expect(page).toHaveURL(/\/tomorrow$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Tomorrow' })).toBeVisible();
    },
  );

  test('the hall in view is in ?hall= and survives reload', async ({ page, asUser }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await asUser('owner', { path: '/today' });
    await contentReady(page);
    const rail = page.locator('[data-hall-rail] a');
    test.skip((await rail.count()) < 2, 'the seeded day has a single hall');
    await rail.nth(1).click();
    await expect(page).toHaveURL(/\?hall=/);
    await page.reload();
    await expect(rail.nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('? opens the shortcut help and j moves focus to an item', async ({ page, asUser }) => {
    await asUser('owner', { path: '/today' });
    await contentReady(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    const items = page.locator('[data-court-item]');
    test.skip((await items.count()) === 0, 'the seeded day has no items');
    await page.keyboard.press('j');
    await expect(items.first()).toBeFocused();
  });

  test('court is at item N is set and cleared', async ({ page, asUser }) => {
    await asUser('owner', { path: '/today' });
    await contentReady(page);
    const input = page.locator('[data-court-marker-input]').first();
    test.skip((await input.count()) === 0, 'the seeded day has no hall to mark');
    await input.fill('2');
    await input.press('Enter');
    await expect(page.locator('[data-court-is-at-rule]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Clear' }).first().click();
    await expect(page.locator('[data-court-is-at-rule]')).toHaveCount(0);
  });
});
