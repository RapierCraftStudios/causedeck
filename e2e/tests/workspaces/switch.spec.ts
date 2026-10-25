// Switching workspaces (#179): a user in two workspaces switches with a hard switch; the slug
// changes and the shell shows only that workspace (name, role, role-gated nav). Workspaces the user
// is not in, and soft-deleted ones, are not found; `/` returns to the last workspace (`cd_last_ws`).
import { E2E_WORKSPACES, expect, test } from '../../fixtures/index.ts';
import {
  CLERK_WORKSPACE,
  SHELL_WORKSPACE,
  layoutOf,
  shellReady,
  sidebar,
  switcherList,
  switcherTrigger,
} from '../shell/helpers.ts';

test.describe('switch workspace', () => {
  test('switching changes the slug and shows only that workspace', async ({ page, asUser }) => {
    await asUser('owner');
    await shellReady(page);
    await expect(switcherTrigger(page)).toHaveAccessibleName(
      `Switch workspace: ${E2E_WORKSPACES[SHELL_WORKSPACE].name}`,
    );
    await switcherTrigger(page).click();
    const options = switcherList(page).getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0).locator('[data-role]')).toHaveText('Owner');
    await expect(options.nth(1).locator('[data-role]')).toHaveText('Clerk');
    await options.nth(1).click();

    await expect(page).toHaveURL(new RegExp(`/w/${CLERK_WORKSPACE}/today$`));
    await expect(page.locator('main')).toHaveAttribute('data-workspace-slug', CLERK_WORKSPACE);
    await shellReady(page);
    await expect(switcherTrigger(page)).toHaveAccessibleName(
      `Switch workspace: ${E2E_WORKSPACES[CLERK_WORKSPACE].name}`,
    );
    // Only bengaluru-chamber data: nothing in the page names the other workspace.
    await expect(page.locator('main')).not.toContainText(E2E_WORKSPACES[SHELL_WORKSPACE].name);
    if (layoutOf(page) !== 'phone') {
      // Clerk role here: billing (owner-only) is gone from the nav.
      await expect(sidebar(page).locator(`a[href="/w/${CLERK_WORKSPACE}/billing"]`)).toHaveCount(0);
      await expect(sidebar(page).locator(`a[href^="/w/${SHELL_WORKSPACE}/"]`)).toHaveCount(0);
    }
  });

  test('/ returns to the last workspace opened', async ({ page, asUser }) => {
    await asUser('owner', { path: 'today' });
    await page.goto(`/w/${CLERK_WORKSPACE}/matters`);
    await expect(page.locator('main')).toHaveAttribute('data-workspace-slug', CLERK_WORKSPACE);
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/w/${CLERK_WORKSPACE}/today$`));
    await page.goto('/w');
    await expect(page).toHaveURL(new RegExp(`/w/${CLERK_WORKSPACE}/today$`));
  });

  test('a workspace the user is not in is not found', async ({ page, asUser }) => {
    await asUser('advocate', { workspace: CLERK_WORKSPACE });
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.locator('main[data-workspace-slug]')).toHaveCount(0);
  });

  test('a soft-deleted workspace is not found and never listed', async ({ page, asUser }) => {
    await asUser('owner');
    await page.goto('/w/mysuru-archived/today');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await shellReady(page);
    await switcherTrigger(page).click();
    await expect(switcherList(page).locator('[data-slug="mysuru-archived"]')).toHaveCount(0);
  });
});
