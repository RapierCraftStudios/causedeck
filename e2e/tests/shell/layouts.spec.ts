// Responsive layouts (#11): at 360 px a 56 px bottom nav (Today, Inbox, capture, Matters,
// Obligations, More) replaces the sidebar and More opens a sheet with the rest; at 768 px the
// sidebar is the 64 px rail; from 1280 px it is expanded; nothing scrolls sideways at 360 px.
import { expect, test } from '../../fixtures/index.ts';

import { PLACEHOLDER_ROUTES, layoutOf, openShell, sidebar, SHELL_WORKSPACE } from './helpers.ts';

const BAR = ['today', 'inbox', 'matters', 'obligations'];

test.describe('layouts', () => {
  test('phones get the bottom navigation with a raised capture button', async ({
    page,
    asUser,
  }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    await openShell(page, asUser);
    const nav = page.getByRole('navigation', { name: 'Bottom navigation' });
    await expect(nav).toBeVisible();
    await expect(sidebar(page)).toBeHidden();

    // Today, Inbox, capture, Matters, Obligations, More, in that order.
    const slots = nav.locator('[data-mobile-nav-item], [data-capture-trigger]');
    const order = await slots.evaluateAll((elements) =>
      elements.map((el) =>
        el.hasAttribute('data-capture-trigger')
          ? 'capture'
          : (el as HTMLElement).dataset.mobileNavItem,
      ),
    );
    expect(order).toEqual(['today', 'inbox', 'capture', 'matters', 'obligations', 'more']);
    await expect(nav.locator('[data-mobile-nav-item="today"]')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // 56 px tall (plus the safe-area inset, which is 0 in a desktop browser), pinned to the bottom.
    const viewport = page.viewportSize();
    const box = await nav.boundingBox();
    expect(box?.height).toBe(56);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(viewport?.height);
    await expect(nav).toHaveCSS('position', 'fixed');

    // The capture circle rises above the bar, in the middle slot between the destinations.
    const circle = await nav.locator('[data-capture-circle]').boundingBox();
    expect(circle?.y ?? Infinity).toBeLessThan(box?.y ?? 0);
    const inbox = await nav.locator('[data-mobile-nav-item="inbox"]').boundingBox();
    const matters = await nav.locator('[data-mobile-nav-item="matters"]').boundingBox();
    const centre = (circle?.x ?? 0) + (circle?.width ?? 0) / 2;
    expect(centre).toBeGreaterThan((inbox?.x ?? 0) + (inbox?.width ?? 0));
    expect(centre).toBeLessThan(matters?.x ?? 0);

    // Content clears the bar: the end of `main` is not hidden behind it.
    const paddingBottom = await page
      .locator('main')
      .evaluate((main) => Number.parseFloat(getComputedStyle(main).paddingBottom));
    expect(paddingBottom).toBeGreaterThanOrEqual(56);
  });

  test('More opens a sheet with the remaining destinations', async ({ page, asUser }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    await openShell(page, asUser);
    await page
      .getByRole('navigation', { name: 'Bottom navigation' })
      .getByRole('button', {
        name: 'More',
      })
      .click();
    const sheet = page.getByRole('dialog', { name: 'More destinations' });
    await expect(sheet).toBeVisible();
    const items = await sheet
      .locator('[data-more-item]')
      .evaluateAll((elements) => elements.map((el) => (el as HTMLElement).dataset.moreItem));
    for (const id of BAR) expect(items).not.toContain(id);
    expect(items).toEqual(
      expect.arrayContaining(['tomorrow', 'calendar', 'briefs', 'drafts', 'memory', 'courts']),
    );

    await sheet.locator('[data-more-item="courts"]').click();
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/courts$`));
    await expect(sheet).toBeHidden();
    // A destination from the sheet marks More as current.
    await expect(page.locator('[data-mobile-nav-item="more"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('tablets get the 64 px rail, desktops the 264 px sidebar, neither the bottom nav', async ({
    page,
    asUser,
  }) => {
    const layout = layoutOf(page);
    test.skip(layout === 'phone', 'tablet and desktop layouts');
    await openShell(page, asUser);
    await expect(page.getByRole('navigation', { name: 'Bottom navigation' })).toBeHidden();
    await expect(sidebar(page)).toBeVisible();
    expect((await sidebar(page).boundingBox())?.width).toBe(layout === 'rail' ? 64 : 264);
    // Labels hide in the rail but stay readable to screen readers.
    const label = sidebar(page).locator('a[data-nav-item="matters"]');
    await expect(label).toHaveAccessibleName('Matters');
  });

  test('no placeholder page scrolls sideways at 360 px', async ({ page, asUser }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    // One full page load per placeholder route.
    test.setTimeout(90_000);
    await openShell(page, asUser);
    for (const route of [
      ...PLACEHOLDER_ROUTES,
      'today',
      'tomorrow',
      'calendar',
      'briefs',
      'research',
      'matters',
      'obligations',
      'drafts',
      'memory',
      'inbox',
      'billing',
      'activity',
      'courts',
    ]) {
      await page.goto(`/w/${SHELL_WORKSPACE}/${route}`);
      await expect(page.locator(`[data-route="${route}"]`)).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflow, `/w/${SHELL_WORKSPACE}/${route} overflows horizontally`).toBeLessThanOrEqual(
        0,
      );
    }
  });
});
