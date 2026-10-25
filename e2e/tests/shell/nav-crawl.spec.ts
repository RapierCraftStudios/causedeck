// Nav crawl (#183): every link the shell navigation offers (sidebar or bottom nav and More sheet,
// the user menu, the `g s` chord and the palette's Settings command) opens a real page, never the
// not-found page. Settings redirects to its profile section (#284), and every settings sub-nav entry
// opens a real section page.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';

import { layoutOf, openShell, palette, SHELL_WORKSPACE, shellReady, sidebar } from './helpers.ts';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function hrefsIn(scope: Locator): Promise<string[]> {
  return scope
    .locator('a[href^="/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

/** The page rendered, and it is not the not-found page (which can stream in with HTTP 200). */
async function expectRealPage(page: Page, href: string) {
  const main = page.locator('main');
  if (/^\/w\/[^/]+\/[^/?]+$/.test(href)) {
    // Workspace pages carry `data-route` once they render.
    await expect(main.locator('[data-route]'), href).toBeVisible();
  }
  await expect(main.getByRole('heading', { level: 1 }), href).toBeVisible();
  await expect(main.getByRole('heading', { level: 1 }), href).not.toHaveText('Page not found');
}

test.describe('shell nav crawl', () => {
  test('every nav link opens a page, never not-found', async ({ page, asUser }) => {
    // About 20 full page loads.
    test.setTimeout(120_000);
    await openShell(page, asUser);
    const hrefs = new Set<string>();
    const add = (list: string[]) => {
      for (const href of list) hrefs.add(href);
    };

    if (layoutOf(page) === 'phone') {
      const bar = page.getByRole('navigation', { name: 'Bottom navigation' });
      add(await hrefsIn(bar));
      await bar.getByRole('button', { name: 'More' }).click();
      const sheet = page.getByRole('dialog', { name: 'More destinations' });
      await expect(sheet).toBeVisible();
      add(await hrefsIn(sheet));
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    } else {
      add(await hrefsIn(sidebar(page)));
    }

    await page.locator('[data-focus-key="user-menu"]').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    add(await hrefsIn(menu));
    await page.keyboard.press('Escape');

    expect([...hrefs]).toContain(`/w/${SHELL_WORKSPACE}/settings`);
    expect(hrefs.size).toBeGreaterThan(4);

    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status() ?? 0, href).toBeLessThan(400);
      await expectRealPage(page, href);
    }
  });

  test('/settings redirects to the workspace profile, not a 404', async ({ page, asUser }) => {
    await openShell(page, asUser, { path: 'settings' });
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/profile$`));
    await expect(page.locator('[data-route="settings-profile"]')).toBeVisible();
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('Profile');
  });

  test('every settings sub-nav entry opens a real section', async ({ page, asUser }) => {
    test.setTimeout(120_000);
    await openShell(page, asUser, { path: 'settings/profile' });
    const hrefs = await hrefsIn(page.locator('[data-slot="settings-nav"]'));
    // Ten sections, plus Support access for owners (#313) and Court watch (#482).
    expect(hrefs).toHaveLength(12);
    expect(hrefs).toContain(`/w/${SHELL_WORKSPACE}/settings/support`);
    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status() ?? 0, href).toBeLessThan(400);
      await expect(page.locator('main').getByRole('heading', { level: 1 }), href).toBeVisible();
      await expect(page.locator('main').getByRole('heading', { level: 1 }), href).not.toHaveText(
        'Page not found',
      );
    }
  });

  test('the palette Settings command opens the settings profile', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole('combobox').fill('Settings');
    await palette(page)
      .locator('[data-palette-group="settings"]')
      .getByRole('option')
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/profile$`));
    await shellReady(page);
    await expectRealPage(page, `/w/${SHELL_WORKSPACE}/settings/profile`);
  });

  test('empty-state actions lead to real pages', async ({ page, asUser }) => {
    // `today` is still a placeholder page (matters became a real page in #388); its action is Courts.
    await openShell(page, asUser, { path: 'today' });
    const action = page.locator('[data-route="today"] [data-empty-action]');
    await expect(action).toBeVisible();
    await action.click();
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/courts$`));
    await expectRealPage(page, `/w/${SHELL_WORKSPACE}/courts`);
  });
});
