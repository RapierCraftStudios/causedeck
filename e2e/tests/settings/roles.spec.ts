// Settings roles page (#285): `/w/<slug>/settings/roles` renders the permission matrix from the
// policy in `@causedeck/auth` with the clerk limits, and the two role settings. Owners change them;
// a change autosaves with an undo toast, persists across a reload and lands in the audit log.
// Everyone else (clerk and up) sees them read-only; viewers get the permission-denied page.
// States: loading, error and empty (dev previews), offline (read-only with the banner). `@a11y`
// tests run axe on the page they end on. Every test starts from the reset e2e seed.
import type { Page } from '@playwright/test';

import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const CLERK_LIMITS = 'Clerks cannot see strategy notes or matter memory';

async function openRoles(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `settings/roles${query}` });
  await expect(
    page.locator('main').getByRole('heading', { level: 1, name: 'Roles' }),
  ).toBeVisible();
  await shellReady(page);
}

const inviteSwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Advocates can invite members' });
const restrictedSwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Owners see restricted matters' });

test.describe('settings roles', () => {
  test(
    'shows the permission matrix and the clerk limits',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openRoles(page, asUser);
      const matrix = page.locator('[data-slot="permission-matrix"]');
      await expect(matrix.getByRole('table', { name: 'What each role can do' })).toBeVisible();
      await expect(page.locator('[data-slot="clerk-limits"]')).toContainText(CLERK_LIMITS);
      await expect(
        matrix.locator('tr[data-action="strategy.read"] td[data-role="clerk"]'),
      ).toHaveAttribute('data-allowed', 'false');
      await expect(
        matrix.locator('tr[data-action="strategy.read"] td[data-role="junior"]'),
      ).toHaveAttribute('data-allowed', 'true');
    },
  );

  test(
    'an owner toggles a setting: autosave, undo toast, persisted and audited',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openRoles(page, asUser);
      await expect(inviteSwitch(page)).toHaveAttribute('aria-checked', 'true');
      await inviteSwitch(page).click();
      await expect(page.getByText('Role settings saved.')).toBeVisible();
      await expect(inviteSwitch(page)).toHaveAttribute('aria-checked', 'false');
      await page.reload();
      await expect(inviteSwitch(page)).toHaveAttribute('aria-checked', 'false');

      await page.goto(`/w/${SHELL_WORKSPACE}/activity`);
      await expect(page.getByText('workspace.role_settings_updated').first()).toBeVisible();
    },
  );

  test('Undo in the toast puts the setting back', async ({ page, asUser }) => {
    await openRoles(page, asUser);
    await restrictedSwitch(page).click();
    await expect(restrictedSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Change undone.')).toBeVisible();
    await expect(restrictedSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await expect(restrictedSwitch(page)).toHaveAttribute('aria-checked', 'true');
  });

  for (const role of ['advocate', 'clerk'] as const) {
    test(`a ${role} sees the settings read-only`, async ({ page, asUser }) => {
      await openRoles(page, asUser, role);
      await expect(
        page.getByText('Only workspace owners can change these settings.'),
      ).toBeVisible();
      await expect(inviteSwitch(page)).toHaveAttribute('aria-readonly', 'true');
      await inviteSwitch(page).click();
      await expect(inviteSwitch(page)).toHaveAttribute('aria-checked', 'true');
    });
  }

  test('a viewer gets the permission-denied page', { tag: '@a11y' }, async ({ page, asUser }) => {
    await asUser('viewer', { path: 'settings/roles' });
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
  });

  test('offline: read-only with the banner', async ({ page, asUser }) => {
    await openRoles(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText('Settings can be changed when you are back online.')).toBeVisible();
    await expect(inviteSwitch(page)).toHaveAttribute('aria-readonly', 'true');
    await page.context().setOffline(false);
    await expect(inviteSwitch(page)).not.toHaveAttribute('aria-readonly', 'true');
  });

  test('empty, loading and error states (dev previews)', async ({ page, asUser }) => {
    await openRoles(page, asUser, 'owner', '?__state=empty');
    await expect(page.getByText('No restricted matters')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restrict a matter' })).toBeDisabled();
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/roles?__state=loading`);
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/roles?__state=error`);
    await expect(page.getByText('Could not load the role settings.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('never scrolls sideways; the matrix scrolls in its own region', async ({ page, asUser }) => {
    await openRoles(page, asUser);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    const region = page.getByRole('region', { name: 'What each role can do' });
    expect(await region.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  });

  test('the members page links to the roles page', async ({ page, asUser }) => {
    await asUser('owner', { path: 'settings/members' });
    await page.getByRole('link', { name: 'How roles work' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/roles$`));
  });
});
