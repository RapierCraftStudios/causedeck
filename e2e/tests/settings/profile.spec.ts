// Workspace profile (#284): `/w/<slug>/settings/profile` edits name, kind, time zone, default
// language and practice city with an explicit `Save changes` (zod-validated, optimistic, toasts);
// the slug is read-only with an owner-only rename that keeps the old address redirecting.
// Unsaved changes are guarded on in-app navigation and tab close; `g s` goes to settings.
// States: loading and error (dev previews), offline (read-only) and permission-denied. `@a11y`
// tests run axe on the page they end on, dialogs open included. Every test starts from the reset
// e2e seed, so renames never leak between tests.
// Lighthouse: the repo's LHCI job (lighthouserc.json) audits signed-out /sign-in on a production
// build with no seeded data, so the signed-in profile page is audited here instead, with the same
// mobile defaults and accessibility >= 0.95 threshold. Lighthouse drives its own Chromium over
// CDP and carries the owner's session as a Cookie header.
import { chromium, type Page } from '@playwright/test';
import lighthouse from 'lighthouse';

import { E2E_WORKSPACES, expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const WORKSPACE = E2E_WORKSPACES[SHELL_WORKSPACE];

async function openProfile(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `settings/profile${query}` });
  await expect(
    page.locator('main').getByRole('heading', { level: 1, name: 'Profile' }),
  ).toBeVisible();
  await shellReady(page);
}

const nameInput = (page: Page) => page.getByRole('textbox', { name: 'Workspace name' });
const save = (page: Page) => page.getByRole('button', { name: 'Save changes' });

test.describe('workspace profile', () => {
  test(
    'saves the profile with a toast and keeps it after a reload',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openProfile(page, asUser);
      await expect(nameInput(page)).toHaveValue(WORKSPACE.name);
      await expect(save(page)).toBeDisabled();
      await nameInput(page).fill('Iyer Chambers');
      await page.getByRole('textbox', { name: 'Practice city' }).fill('Chennai');
      await save(page).click();
      await expect(page.getByText('Workspace profile saved.')).toBeVisible();
      await expect(save(page)).toBeDisabled();
      await page.reload();
      await expect(nameInput(page)).toHaveValue('Iyer Chambers');
      await expect(page.getByRole('textbox', { name: 'Practice city' })).toHaveValue('Chennai');
    },
  );

  test('validates with zod before saving', async ({ page, asUser }) => {
    await openProfile(page, asUser);
    await nameInput(page).fill('   ');
    await save(page).click();
    await expect(page.getByText('Enter a workspace name of up to 120 characters.')).toBeVisible();
  });

  test('rolls back and says so when the save fails', async ({ page, asUser }) => {
    await openProfile(page, asUser);
    // Fail the server action round trip.
    await page.route(`**/w/${SHELL_WORKSPACE}/settings/profile`, async (route) => {
      if (route.request().method() === 'POST') await route.abort();
      else await route.continue();
    });
    await nameInput(page).fill('Never Saved');
    await save(page).click();
    await expect(
      page.getByText('Could not save the profile. Your changes were undone. Try again.'),
    ).toBeVisible();
    await expect(save(page)).toBeEnabled();
    await page.unroute(`**/w/${SHELL_WORKSPACE}/settings/profile`);
    await page.reload();
    await expect(nameInput(page)).toHaveValue(WORKSPACE.name);
  });

  test(
    'the owner renames the slug and the old address redirects',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openProfile(page, asUser);
      await page.getByRole('button', { name: 'Rename' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rename the web address' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('textbox', { name: 'New web address' }).fill('iyer-chambers');
      await dialog.getByRole('button', { name: 'Rename' }).click();
      await expect(page).toHaveURL(/\/w\/iyer-chambers\/settings\/profile$/);
      await expect(page.locator('[data-slot="workspace-slug"]')).toHaveText('iyer-chambers');
      await page.goto(`/w/${SHELL_WORKSPACE}/today`);
      await expect(page).toHaveURL(/\/w\/iyer-chambers\/today$/);
    },
  );

  test('axe passes with the rename dialog open', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openProfile(page, asUser);
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('dialog', { name: 'Rename the web address' })).toBeVisible();
  });

  test('an advocate edits the profile but cannot rename the slug', async ({ page, asUser }) => {
    await openProfile(page, asUser, 'advocate');
    await expect(page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
    await expect(page.getByText('Only workspace owners can change this.')).toBeVisible();
    await expect(nameInput(page)).toBeEditable();
  });

  test('a clerk reads the profile without controls', async ({ page, asUser }) => {
    await openProfile(page, asUser, 'clerk');
    await expect(nameInput(page)).not.toBeEditable();
    await expect(save(page)).toHaveCount(0);
  });

  test(
    'unsaved changes ask before leaving through a link',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openProfile(page, asUser);
      await nameInput(page).fill('Half Typed');
      await page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: 'Members' })
        .click();
      const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Stay on this page' }).click();
      await expect(page).toHaveURL(/\/settings\/profile$/);
      await expect(nameInput(page)).toHaveValue('Half Typed');
      await page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: 'Members' })
        .click();
      await page
        .getByRole('alertdialog', { name: 'Leave without saving?' })
        .getByRole('button', { name: 'Leave without saving' })
        .click();
      await expect(page).toHaveURL(/\/settings\/members$/);
    },
  );

  test('unsaved changes ask before the tab closes', async ({ page, asUser }) => {
    await openProfile(page, asUser);
    await nameInput(page).fill('Half Typed');
    let asked = false;
    page.on('dialog', (dialog) => {
      asked = dialog.type() === 'beforeunload';
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toBe(true);
  });

  test('g then s goes to settings', async ({ page, asUser }) => {
    await asUser('owner');
    await shellReady(page);
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/profile$`));
  });

  test('offline: read-only with the banner', async ({ page, asUser }) => {
    await openProfile(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText('Settings can be changed when you are back online.')).toBeVisible();
    await expect(nameInput(page)).not.toBeEditable();
    await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(nameInput(page)).toBeEditable();
  });

  test('loading and error states (dev previews)', async ({ page, asUser }) => {
    await asUser('owner', { path: 'settings/profile?__state=loading' });
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/profile?__state=error`);
    await expect(page.getByText('Could not load the workspace profile.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('Lighthouse accessibility is at least 95', async ({ page, asUser }, testInfo) => {
    test.setTimeout(180_000);
    await openProfile(page, asUser);
    const url = page.url();
    const cookie = (await page.context().cookies(url))
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    const port = 9300 + testInfo.workerIndex;
    const browser = await chromium.launch({ args: [`--remote-debugging-port=${String(port)}`] });
    try {
      const result = await lighthouse(url, {
        port,
        onlyCategories: ['accessibility'],
        extraHeaders: { Cookie: cookie },
        output: 'json',
        logLevel: 'error',
      });
      expect(result?.lhr.finalDisplayedUrl).toBe(url);
      const score = result?.lhr.categories['accessibility']?.score ?? 0;
      expect(score, 'Lighthouse accessibility score').toBeGreaterThanOrEqual(0.95);
    } finally {
      await browser.close();
    }
  });
});
