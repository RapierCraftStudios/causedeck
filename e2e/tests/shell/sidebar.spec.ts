// Sidebar (#11): 264 px expanded, 64 px rail, `[` toggles and the choice persists in a cookie, the
// active item carries `aria-current=page` and the accent bar, Inbox and Obligations have count
// slots, and the nav scrolls on its own.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';

import { layoutOf, openShell, sidebar, shellRoot } from './helpers.ts';

const width = async (page: Page) => (await sidebar(page).boundingBox())?.width ?? 0;

test.describe('sidebar', () => {
  test('is hidden on phones', async ({ page, asUser }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    await openShell(page, asUser);
    await expect(sidebar(page)).toBeHidden();
  });

  test('`[` toggles between the 264 px sidebar and the 64 px rail, and the choice persists', async ({
    page,
    asUser,
  }) => {
    const layout = layoutOf(page);
    test.skip(layout === 'phone', 'no sidebar on phones');
    await openShell(page, asUser);
    await expect(shellRoot(page)).toHaveAttribute('data-sidebar', 'auto');

    // Default: expanded from 1280 px, the rail below it.
    const [initial, toggled] = layout === 'desktop' ? [264, 64] : [64, 264];
    const toggledState = layout === 'desktop' ? 'collapsed' : 'expanded';
    await expect.poll(() => width(page)).toBe(initial);

    await page.keyboard.press('[');
    await expect(shellRoot(page)).toHaveAttribute('data-sidebar', toggledState);
    await expect.poll(() => width(page)).toBe(toggled);
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'sidebar')?.value).toBe(toggledState);

    // The server reads the cookie, so the reload paints at the chosen width straight away.
    const html = await (await page.request.get(page.url())).text();
    expect(html).toContain(`data-sidebar="${toggledState}"`);
    await page.reload();
    await expect(shellRoot(page)).toHaveAttribute('data-sidebar', toggledState);
    await expect.poll(() => width(page)).toBe(toggled);

    // The toggle button does the same, and reflects the state for assistive tech.
    const toggle = page.locator('[data-sidebar-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', String(toggledState === 'expanded'));
    await toggle.click();
    await expect.poll(() => width(page)).toBe(initial);
    await expect(toggle).toHaveAttribute('aria-expanded', String(initial === 264));
  });

  test('the active item has aria-current=page and the 2 px accent bar', async ({
    page,
    asUser,
  }) => {
    test.skip(layoutOf(page) === 'phone', 'no sidebar on phones');
    await openShell(page, asUser, { path: 'matters' });
    const nav = sidebar(page).getByRole('navigation', { name: 'Primary' });
    const active = nav.locator('a[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('data-nav-item', 'matters');
    const bar = active.locator('[data-active-indicator]');
    await expect(bar).toBeVisible();
    expect((await bar.boundingBox())?.width).toBe(2);

    // Following a link moves both.
    await nav.locator('a[data-nav-item="courts"]').click();
    await expect(page).toHaveURL(/\/w\/demo\/courts$/);
    await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('data-nav-item', 'courts');
    await expect(nav.locator('[data-active-indicator]')).toHaveCount(1);
  });

  test('shows count slots for Inbox and Obligations and scrolls independently', async ({
    page,
    asUser,
  }) => {
    test.skip(layoutOf(page) === 'phone', 'no sidebar on phones');
    await openShell(page, asUser);
    for (const id of ['inbox', 'obligations']) {
      await expect(sidebar(page).locator(`[data-badge="${id}"]`)).toHaveCount(1);
    }
    await expect(sidebar(page).locator('[data-badge]')).toHaveCount(2);
    const scroller = sidebar(page).locator('[data-sidebar-scroll]');
    await expect(scroller).toHaveCSS('overflow-y', 'auto');
    // The column is viewport-tall and sticky, so long content never scrolls the nav away.
    await expect(sidebar(page)).toHaveCSS('position', 'sticky');
  });

  test('arrow keys move between nav items (roving tabindex)', async ({ page, asUser }) => {
    test.skip(layoutOf(page) === 'phone', 'no sidebar on phones');
    await openShell(page, asUser);
    const nav = sidebar(page).getByRole('navigation', { name: 'Primary' });
    await expect(nav.locator('a[tabindex="0"]')).toHaveCount(1);
    await nav.locator('a[data-nav-item="today"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(nav.locator('a[data-nav-item="tomorrow"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(nav.locator('a[data-nav-item]').last()).toBeFocused();
  });
});
