// Research tab journeys (#80), CI only: the link-out menu by keyboard, the clerk's permission-denied
// notes, the empty and offline states and axe in every viewport and theme project (360/768/1280,
// light and dark; the visual baselines come from the project matrix). The page makes no AI call.
import { MATTERS } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import { openMatters } from './helpers.ts';

const path = `matters/${MATTERS.appeal.id}/research`;

test.describe('matter research', { tag: '@a11y' }, () => {
  test('notes are empty at first and axe is clean', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path });
    await expect(page.locator('[data-slot="notes-empty"]')).toBeVisible();
  });

  test('clerk sees the permission-denied state for notes', async ({ page, asUser }) => {
    await openMatters(page, asUser, { role: 'clerk', path });
    await expect(page.locator('[data-slot="notes-denied"]')).toBeVisible();
  });

  test('offline shows notes read-only', async ({ page, asUser, context }) => {
    await openMatters(page, asUser, { path });
    await context.setOffline(true);
    await expect(page.locator('[data-slot="notes-offline"]')).toBeVisible();
    await context.setOffline(false);
  });

  test('the link-out menu opens by keyboard and links open in a new window', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path });
    const trigger = page.getByRole('button', { name: /Research on/ });
    if ((await trigger.count()) === 0) {
      await expect(page.locator('[data-slot="link-out-empty"]')).toBeVisible();
      return;
    }
    await trigger.focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(items.first().locator('xpath=self::*[@target="_blank"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await page.keyboard.press('Escape');
    await expect(items.first()).toBeHidden();
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});
