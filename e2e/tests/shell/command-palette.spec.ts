// Command palette (#11): opens with Cmd/Ctrl+K and from the topbar search button, traps focus,
// closes on Esc and returns focus, `>` and `/` prefix modes, selecting navigates, recents.
import { expect, test } from '../../fixtures/index.ts';

import { openShell, palette } from './helpers.ts';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('command palette', () => {
  test('opens with Cmd/Ctrl+K and closes on Esc', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();

    // `mod+k` also closes it.
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette(page)).toBeHidden();
  });

  test('opens from the topbar search button and returns focus to it', async ({ page, asUser }) => {
    await openShell(page, asUser);
    const search = page.getByRole('banner').getByRole('button', { name: 'Open search' });
    await search.click();
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(search).toBeFocused();
  });

  test('traps focus inside the dialog', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press(`${MOD}+k`);
    const dialog = palette(page);
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });

  test('`/` limits to navigation, `>` to commands', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press(`${MOD}+k`);
    const input = palette(page).getByRole('combobox');

    await input.fill('/mat');
    await expect(palette(page).locator('[data-palette-group]')).toHaveCount(1);
    await expect(palette(page).locator('[data-palette-group="goTo"]')).toBeVisible();
    await expect(palette(page).getByRole('option').first()).toHaveText(/Matters/);

    await input.fill('>');
    await expect(palette(page).locator('[data-palette-group="goTo"]')).toHaveCount(0);
    await expect(palette(page).getByRole('option').first()).toBeVisible();

    await input.fill('/zzzzqq');
    await expect(
      palette(page).getByText('No matches. Try a matter name, court or action.'),
    ).toBeVisible();
  });

  test('selecting a destination navigates and it shows under Recent next time', async ({
    page,
    asUser,
  }) => {
    await openShell(page, asUser);
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette(page).locator('[data-palette-group="recent"]')).toHaveCount(0);
    await palette(page).getByRole('combobox').fill('courts');
    await expect(palette(page).getByRole('option').first()).toHaveText(/Courts/);
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(/\/w\/demo\/courts$/);

    await page.keyboard.press(`${MOD}+k`);
    const recent = palette(page).locator('[data-palette-group="recent"]');
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('option').first()).toHaveText(/Courts/);
  });
});
