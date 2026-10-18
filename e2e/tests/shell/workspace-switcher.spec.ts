// Workspace switcher (#11): lists the user's memberships with role badges (never anyone else's),
// type-to-filter, arrow keys and Enter switch to `/w/<other-slug>/today`, and on phones the
// current workspace sits in the topbar.
import { expect, test } from '../../fixtures/index.ts';

import {
  CLERK_WORKSPACE,
  SHELL_WORKSPACE,
  layoutOf,
  openShell,
  switcherList,
  switcherTrigger,
} from './helpers.ts';

test.describe('workspace switcher', () => {
  test('lists memberships with role badges, never other workspaces', async ({ page, asUser }) => {
    await openShell(page, asUser);
    const trigger = switcherTrigger(page);
    await expect(trigger).toHaveAccessibleName('Switch workspace: Demo Chambers');
    await trigger.click();

    const list = switcherList(page);
    await expect(list).toBeVisible();
    const options = list.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAttribute('data-slug', SHELL_WORKSPACE);
    await expect(options.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(options.nth(0).locator('[data-role]')).toHaveText('Owner');
    await expect(options.nth(1)).toHaveAttribute('data-slug', CLERK_WORKSPACE);
    await expect(options.nth(1).locator('[data-role]')).toHaveText('Clerk');
    await expect(list.locator('[data-slug="other-chambers"]')).toHaveCount(0);
  });

  test('type-to-filter narrows the list and shows an empty message', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await switcherTrigger(page).click();
    const filter = page.getByRole('combobox', { name: 'Find a workspace' });
    await expect(filter).toBeFocused();

    await filter.fill('clerk');
    await expect(switcherList(page).getByRole('option')).toHaveCount(1);
    await expect(switcherList(page).getByRole('option')).toHaveAttribute('data-slug', 'clerk-desk');

    await filter.fill('no such chambers');
    await expect(switcherList(page).getByRole('option')).toHaveCount(0);
    await expect(page.getByText('No workspaces match.')).toBeVisible();
  });

  test('arrow keys and Enter switch to the other workspace’s Today', async ({ page, asUser }) => {
    await openShell(page, asUser, { path: 'matters' });
    await switcherTrigger(page).click();
    const filter = page.getByRole('combobox', { name: 'Find a workspace' });
    await expect(filter).toBeFocused();

    // Opens on the current workspace; ArrowDown moves to the next one.
    const options = switcherList(page).getByRole('option');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(filter).toHaveAttribute('aria-activedescendant', /option-1$/);
    // Wraps around at either end.
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${CLERK_WORKSPACE}/today$`));
    await expect(page.locator('main')).toHaveAttribute('data-workspace-slug', CLERK_WORKSPACE);
    await expect(switcherTrigger(page)).toHaveAccessibleName('Switch workspace: Clerk Desk');
  });

  test('Esc closes the switcher and returns focus to its trigger', async ({ page, asUser }) => {
    await openShell(page, asUser);
    const trigger = switcherTrigger(page);
    await trigger.click();
    await expect(switcherList(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(switcherList(page)).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/today$`));
  });

  test('phones show the current workspace in the topbar and switch from a sheet', async ({
    page,
    asUser,
  }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    await openShell(page, asUser);
    const current = page.getByRole('banner').locator('[data-current-workspace]');
    await expect(current).toBeVisible();
    await expect(current).toHaveText('Demo Chambers');

    await switcherTrigger(page).click();
    const sheet = page.locator('[data-switcher-sheet]');
    await expect(sheet).toBeVisible();
    await sheet.locator(`[data-slug="${CLERK_WORKSPACE}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/w/${CLERK_WORKSPACE}/today$`));
    await expect(page.getByRole('banner').locator('[data-current-workspace]')).toHaveText(
      'Clerk Desk',
    );
  });
});
