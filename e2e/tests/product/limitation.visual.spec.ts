// Limitation tracker visual baselines (#942): the list with a proposal, the working open, the empty
// state, the no-reviewed-rules notice and the propose dialog at 360, 768 and 1280 px in light and
// dark (the viewport and theme projects). Synthetic fictional rules only. Baselines are generated
// by the update-visual workflow and compared in CI.
import { expect, test } from '../../fixtures/index.ts';

import { cards, openLimitation } from './limitation-helpers.ts';

test.describe('limitation visual', { tag: '@visual' }, () => {
  test('list with a proposal', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name);
    await expect(cards(page)).toHaveCount(1);
    await expect(page).toHaveScreenshot('limitation-list.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('working open', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name);
    await cards(page).first().getByRole('button', { name: 'Show working' }).click();
    await expect(page.getByText('How this date was computed')).toBeVisible();
    await expect(page).toHaveScreenshot('limitation-working.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('empty', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name, { computation: false });
    await expect(page.getByRole('heading', { name: 'No limitation dates yet' })).toBeVisible();
    await expect(page).toHaveScreenshot('limitation-empty.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('no reviewed rule table', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name, { reviewed: false });
    await expect(page.locator('[data-slot="limitation-no-rules"]')).toBeVisible();
    await expect(page).toHaveScreenshot('limitation-no-rules.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('propose dialog', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name, { computation: false });
    await page
      .getByRole('button', { name: 'Propose a date' })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Propose a limitation date' })).toBeVisible();
    await expect(page).toHaveScreenshot('limitation-propose.png', { animations: 'disabled' });
  });
});
