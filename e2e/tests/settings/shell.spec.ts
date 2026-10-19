// Settings shell (#284): `/w/<slug>/settings` redirects to the workspace profile; the sub-nav lists
// Profile, Members, Roles, Notifications, Integrations, Privacy, Export and Danger zone (plus Usage
// and Audit log) and hides what the role cannot open; a direct URL to a hidden section shows the
// permission-denied page. Layout: a scrollable segmented strip at 360 (no page-level horizontal
// scroll), a 200 px sticky sub-nav with a 560 px column at 768, 220/640 px from 1280. Offline,
// the settings banner appears. `@a11y` tests run axe on the page they end on.
import type { Page } from '@playwright/test';

import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import { layoutOf, SHELL_WORKSPACE } from '../shell/helpers.ts';

const SECTIONS = [
  'Profile',
  'Members',
  'Roles',
  'Notifications',
  'Integrations',
  'Privacy',
  'Export',
  'Danger zone',
] as const;

const subNav = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });

async function openSettings(
  page: Page,
  asUser: (r: E2eRole, o?: { path?: string }) => Promise<Page>,
  role: E2eRole,
  path = 'settings',
) {
  await asUser(role, { path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
}

async function navLabels(page: Page): Promise<string[]> {
  return subNav(page).getByRole('link').allTextContents();
}

test.describe('settings shell', () => {
  test(
    'settings redirects to the profile and the owner sees every section',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner');
      await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/profile$`));
      expect(await navLabels(page)).toEqual([...SECTIONS, 'Usage', 'Audit log']);
      await expect(subNav(page).getByRole('link', { name: 'Profile' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    },
  );

  test('items a clerk cannot open are hidden, and their URLs are denied', async ({
    page,
    asUser,
  }) => {
    await openSettings(page, asUser, 'clerk');
    expect(await navLabels(page)).toEqual(['Profile', 'Members', 'Roles', 'Notifications']);
    for (const section of ['integrations', 'privacy', 'export', 'danger']) {
      await page.goto(`/w/${SHELL_WORKSPACE}/settings/${section}`);
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
    }
  });

  test('an advocate sees integrations and privacy but not export or danger', async ({
    page,
    asUser,
  }) => {
    await openSettings(page, asUser, 'advocate');
    expect(await navLabels(page)).toEqual([
      'Profile',
      'Members',
      'Roles',
      'Notifications',
      'Integrations',
      'Privacy',
      'Audit log',
    ]);
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/danger`);
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
  });

  test(
    'a viewer lands on members and the profile is denied',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openSettings(page, asUser, 'viewer');
      await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/members$`));
      expect(await navLabels(page)).toEqual(['Members', 'Notifications']);
      await page.goto(`/w/${SHELL_WORKSPACE}/settings/profile`);
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
    },
  );

  test(
    'the danger zone is owner-only with disabled, explained actions',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner', 'settings/danger');
      const zone = page.locator('[data-slot="danger-zone"]');
      await expect(zone).toBeVisible();
      for (const name of ['Transfer ownership', 'Delete workspace']) {
        await expect(zone.getByRole('button', { name })).toBeDisabled();
      }
    },
  );

  test('layout matches the viewport and never scrolls sideways', async ({ page, asUser }) => {
    await openSettings(page, asUser, 'owner', 'settings/profile');
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    const navBox = await page.locator('[data-slot="settings-nav"]').boundingBox();
    const contentBox = await page.locator('[data-slot="settings-content"]').boundingBox();
    if (!navBox || !contentBox) throw new Error('settings shell not rendered');
    const layout = layoutOf(page);
    if (layout === 'phone') {
      // The segmented strip sits above the content and scrolls on its own.
      expect(navBox.y).toBeLessThan(contentBox.y);
      const strip = page.locator('[data-slot="settings-nav"] > div');
      expect(await strip.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    } else {
      expect(navBox.x).toBeLessThan(contentBox.x);
      expect(Math.round(navBox.width)).toBe(layout === 'desktop' ? 220 : 200);
      expect(contentBox.width).toBeLessThanOrEqual(layout === 'desktop' ? 640 : 560);
      expect(
        await page
          .locator('[data-slot="settings-nav"]')
          .evaluate((el) => getComputedStyle(el).position),
      ).toBe('sticky');
    }
  });

  test('offline: the settings banner appears and goes', async ({ page, asUser }) => {
    await openSettings(page, asUser, 'owner', 'settings/profile');
    const banner = page.getByText('Settings can be changed when you are back online.');
    await expect(banner).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(banner).toBeVisible();
    await page.context().setOffline(false);
    await expect(banner).toHaveCount(0);
  });
});
