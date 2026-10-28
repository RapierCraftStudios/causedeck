// Obligation queue journeys (#68) on `/w/chennai-solo/obligations`: the empty and denied previews,
// the keyboard map and the shortcut sheet, filters that narrow the queue and land in the URL, and
// that closing always asks for a reason. Runs in CI only; fictional data.
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

const QUEUE = 'obligations';

test.describe('obligation queue', () => {
  test('empty state invites confirming orders', async ({ page, asUser }) => {
    await asUser('owner', { path: `${QUEUE}?__state=empty` });
    await shellReady(page);
    await expect(page.getByText('Nothing outstanding.')).toBeVisible();
    await expect(page.getByText('Orders you confirm will add obligations here.')).toBeVisible();
  });

  test('permission-denied preview', async ({ page, asUser }) => {
    await asUser('owner', { path: `${QUEUE}?__state=denied` });
    await shellReady(page);
    await expect(page.getByText('You do not have access to obligations')).toBeVisible();
  });

  test('? lists every shortcut and the search filter reaches the URL', async ({ page, asUser }) => {
    await asUser('owner', { path: QUEUE });
    await shellReady(page);
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Obligation shortcuts' });
    await expect(sheet).toBeVisible();
    for (const keys of ['j', 'k', 'x', 'd', 'r', 'a', 'o', '/', 'g o', '?']) {
      await expect(
        sheet.locator('kbd', { hasText: new RegExp(`^${keys.replace('?', '\\?')}$`) }),
      ).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    await page.keyboard.type('hearing');
    await expect(page).toHaveURL(/[?&]q=hearing/);
  });

  test('closing opens the reason dialog, never a silent close', async ({ page, asUser }) => {
    await asUser('owner', { path: QUEUE });
    await shellReady(page);
    const first = page.locator('[data-slot="obligation-row"]').first();
    test.skip((await first.count()) === 0, 'no seeded obligation on this stack');
    await page.keyboard.press('j');
    await page.keyboard.press('d');
    const dialog = page.getByRole('dialog', { name: 'Close obligation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close obligation' }).click();
    await expect(dialog).toBeVisible();
  });
});
