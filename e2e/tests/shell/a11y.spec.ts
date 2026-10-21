// Shell accessibility (#11): zero serious or critical axe violations on shell pages and with the
// palette and switcher open; the skip link works; the `nav`, `main` and `header` landmarks exist.
// `@a11y`: the fixture runs axe on the page each test ends on (fixtures/index.ts).
import { expect, test } from '../../fixtures/index.ts';

import {
  CLERK_WORKSPACE,
  layoutOf,
  openShell,
  palette,
  switcherList,
  switcherTrigger,
} from './helpers.ts';

test.describe('shell accessibility', { tag: '@a11y' }, () => {
  for (const route of ['today', 'matters', 'courts', 'settings'] as const) {
    test(`/${route}`, async ({ page, asUser }) => {
      await openShell(page, asUser, { path: route });
      await expect(page.getByRole('main')).toBeVisible();
    });
  }

  test('permission-denied page', async ({ page, asUser }) => {
    // The clerk has no Billing item, so there is no active nav item to wait on.
    await openShell(page, asUser, { workspace: CLERK_WORKSPACE, path: 'billing', wait: false });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No access');
  });

  test('loading state', async ({ page, asUser }) => {
    await openShell(page, asUser, { path: 'matters?__state=loading', wait: false });
    await expect(page.locator('main [data-slot="route-skeleton"]')).toBeVisible();
  });

  test('error state', async ({ page, asUser }) => {
    await openShell(page, asUser, { path: 'matters?__state=error', wait: false });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Something went wrong.', {
      timeout: 15_000,
    });
  });

  test('offline banner', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();
  });

  test('with the command palette open', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.getByRole('banner').getByRole('button', { name: 'Open search' }).click();
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole('combobox').fill('ma');
    await expect(palette(page).getByRole('option').first()).toBeVisible();
  });

  test('with the workspace switcher open', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await switcherTrigger(page).click();
    await expect(switcherList(page)).toBeVisible();
  });

  test('with the shortcuts dialog open', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});

// Layout-specific overlays check axe explicitly: the automatic `@a11y` check also runs after a
// skipped test, on the blank page it never left.
test.describe('shell accessibility, layout-specific', () => {
  test('with the More sheet open', async ({ page, asUser, a11y }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    await openShell(page, asUser);
    await page.locator('[data-mobile-nav-item="more"]').click();
    await expect(page.getByRole('dialog', { name: 'More destinations' })).toBeVisible();
    await a11y.expectNoViolations(page);
  });

  test('with the capture sheet open', async ({ page, asUser, a11y }) => {
    test.skip(layoutOf(page) !== 'phone', 'phone layout only');
    await openShell(page, asUser);
    await page.locator('[data-capture-trigger]').click();
    await expect(page.locator('[data-capture-sheet]')).toBeVisible();
    await a11y.expectNoViolations(page);
  });

  test('with the sidebar collapsed to the rail', async ({ page, asUser, a11y }) => {
    test.skip(layoutOf(page) !== 'desktop', 'collapses from the expanded desktop sidebar');
    await openShell(page, asUser);
    await page.keyboard.press('[');
    await expect(page.locator('[data-shell]')).toHaveAttribute('data-sidebar', 'collapsed');
    await a11y.expectNoViolations(page);
  });
});

test.describe('skip link and landmarks', () => {
  test('the skip link is the first tab stop and moves focus to main', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveURL(/#main$/);
    // Skipped past the chrome: the next tab stop is not the sidebar or the topbar.
    await page.keyboard.press('Tab');
    const inTopChrome = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('header, aside')),
    );
    expect(inTopChrome).toBe(false);
  });

  test('exposes the nav, main and header landmarks', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('banner')).toBeVisible();
    const visibleNav =
      layoutOf(page) === 'phone'
        ? page.getByRole('navigation', { name: 'Bottom navigation' })
        : page.getByRole('navigation', { name: 'Primary' });
    await expect(visibleNav).toBeVisible();
    await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toHaveCount(
      layoutOf(page) === 'phone' ? 0 : 1,
    );
  });
});
