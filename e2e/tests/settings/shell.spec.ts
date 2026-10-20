// Settings shell (#284): `/w/<slug>/settings` redirects to the workspace profile; the sub-nav lists
// Profile, Members, Roles, Notifications, Integrations, Privacy, Export and Danger zone (plus Usage
// and Audit log) and hides what the role cannot open; a direct URL to a hidden section shows the
// permission-denied page. Layout: a scrollable segmented strip at 360 (no page-level horizontal
// scroll), a 200 px sticky sub-nav with a 560 px column at 768, 220/640 px from 1280. Offline,
// the settings banner appears. #288: the export page (disabled `Export workspace` with the
// `Coming from export service` tooltip) and the danger zone (transfer links to the members picker,
// delete disabled with its reason) are owner-only; members, notifications, export and danger never
// scroll sideways and show one offline banner. `@a11y` tests run axe on the page they end on.
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
    'the danger zone keeps delete disabled with a reason you can reach by keyboard',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner', 'settings/danger');
      const zone = page.locator('[data-slot="danger-zone"]');
      await expect(zone).toBeVisible();
      const remove = zone.getByRole('button', { name: 'Delete workspace' });
      await expect(remove).toBeDisabled();
      const reason = 'Available once the export and deletion service is ready.';
      await expect(remove).toHaveAccessibleDescription(new RegExp(reason));
      await zone.locator('[data-slot="disabled-with-reason"]').focus();
      await expect(page.getByRole('tooltip')).toHaveText(reason);
      await expect(zone.getByRole('link', { name: 'Export first' })).toHaveAttribute(
        'href',
        `/w/${SHELL_WORKSPACE}/settings/export`,
      );
    },
  );

  test(
    'transfer ownership opens the members picker, then the two-step transfer',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner', 'settings/danger');
      await page
        .locator('[data-slot="danger-zone"]')
        .getByRole('link', { name: 'Transfer ownership' })
        .click();
      await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/members`));
      const picker = page.getByRole('dialog', { name: 'Transfer ownership' });
      await expect(picker).toBeVisible();
      await picker.getByRole('button', { name: 'Continue' }).click();
      // axe runs with the change-role dialog open.
      await expect(page.getByRole('dialog', { name: 'Change role' })).toBeVisible();
    },
  );

  test(
    'export explains the ZIP; the button waits for the export service',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner', 'settings/export');
      await expect(page.getByRole('heading', { name: 'Export workspace data' })).toBeVisible();
      const button = page.getByRole('button', { name: 'Export workspace' });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAccessibleDescription(/Coming from export service/);
      await page.locator('[data-slot="disabled-with-reason"]').hover();
      await expect(page.getByRole('tooltip')).toHaveText('Coming from export service');
    },
  );

  for (const role of ['advocate', 'clerk'] as const) {
    test(`export and danger are denied to a ${role} by direct URL`, async ({ page, asUser }) => {
      for (const section of ['export', 'danger']) {
        await openSettings(page, asUser, role, `settings/${section}`);
        await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
          'No access',
        );
      }
    });
  }

  for (const section of ['members', 'notifications', 'export', 'danger']) {
    test(`${section} never scrolls sideways`, async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner', `settings/${section}`);
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  for (const section of ['members', 'export', 'danger']) {
    test(`offline: ${section} is read-only under one banner`, async ({ page, asUser }) => {
      await openSettings(page, asUser, 'owner', `settings/${section}`);
      await page.context().setOffline(true);
      await expect(page.getByText('Settings can be changed when you are back online.')).toHaveCount(
        1,
      );
      // The page-level shell banner would be a second one.
      await expect(page.getByText(/You are offline\. Showing saved data/)).toHaveCount(0);
      if (section === 'export') {
        await expect(page.getByRole('button', { name: 'Export workspace' })).toBeDisabled();
      }
      if (section === 'danger') {
        await expect(page.getByRole('button', { name: 'Transfer ownership' })).toBeDisabled();
      }
      await page.context().setOffline(false);
    });
  }

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
