// Placeholder page states (#11): every placeholder route renders its empty state, the loading
// skeleton (`?__state=loading`, a development toggle that the e2e build keeps), the error state
// (`?__state=error`), the offline banner while `navigator.onLine` is false, and permission-denied
// when the stub role lacks the route's permission.
import { readFileSync } from 'node:fs';

import { expect, test } from '../../fixtures/index.ts';
import { enableInsights } from '../../fixtures/insights-data.ts';

import {
  CLERK_DENIED_ROUTES,
  CLERK_WORKSPACE,
  FLAG_GATED_ROUTES,
  PLACEHOLDER_ROUTES,
  SHELL_WORKSPACE,
  openShell,
} from './helpers.ts';

interface Messages {
  nav: Record<string, string>;
  shell: { pages: Record<string, { description: string; empty: string }> };
}

/** The design copy the pages render (the merged en catalog in @causedeck/i18n). */
const messages = JSON.parse(
  readFileSync(
    new URL('../../../packages/i18n/src/generated/messages/en.json', import.meta.url),
    'utf8',
  ),
) as Messages;

const url = (route: string, state?: string, workspace = SHELL_WORKSPACE) =>
  `/w/${workspace}/${route}${state === undefined ? '' : `?__state=${state}`}`;

test.describe('placeholder page states', () => {
  for (const route of PLACEHOLDER_ROUTES) {
    test(`${route}: empty, loading, error and offline`, async ({ page, asUser }) => {
      await openShell(page, asUser, { path: route });
      const content = page.locator(`[data-route="${route}"]`);
      const main = page.locator('main');

      // Empty: title, one-line description and the designed empty state.
      await expect(content.getByRole('heading', { level: 1 })).toHaveText(
        messages.nav[route] ?? '',
      );
      await expect(content).toContainText(messages.shell.pages[route]?.description ?? '');
      const empty = content.locator('[data-pattern-state="empty"]');
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(messages.shell.pages[route]?.empty ?? '');

      // Offline: the banner appears while `navigator.onLine` is false and goes when it is back.
      const banner = main.getByText(/You are offline\. Showing saved data from/);
      await expect(banner).toHaveCount(0);
      await page.context().setOffline(true);
      await expect(banner).toBeVisible();
      await page.context().setOffline(false);
      await expect(banner).toHaveCount(0);

      // Loading: the route skeleton instead of the content.
      await page.goto(url(route, 'loading'));
      await expect(main.locator('[data-slot="route-skeleton"]')).toBeVisible();
      await expect(main.locator('[data-pattern-state="loading"]')).toHaveCount(1);
      await expect(main.locator('[data-pattern-state="empty"]')).toHaveCount(0);

      // Error: the workspace error boundary, inside the shell chrome. The thrown error streams in
      // and the boundary renders once the page hydrates.
      await page.goto(url(route, 'error'));
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('Something went wrong.', {
        timeout: 15_000,
      });
      await expect(main.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(main.locator('[data-pattern-state="empty"]')).toHaveCount(0);
    });
  }

  test('the sidebar sync dot reads Offline while offline', async ({ page, asUser }) => {
    await openShell(page, asUser);
    const sync = page.locator('#shell-sidebar [data-sync]');
    await expect(sync).toHaveAttribute('data-sync', 'synced');
    await page.context().setOffline(true);
    await expect(sync).toHaveAttribute('data-sync', 'offline');
    await page.context().setOffline(false);
    await expect(sync).toHaveAttribute('data-sync', 'synced');
  });

  test('routes the role lacks permission for render permission-denied', async ({
    page,
    asUser,
    db,
  }) => {
    // `insights` is behind its flag (#966); on for every workspace, the permission check is next.
    await enableInsights(db.name, 'global');
    await openShell(page, asUser, { wait: false });
    for (const route of CLERK_DENIED_ROUTES) {
      await page.goto(url(route, undefined, CLERK_WORKSPACE));
      const main = page.locator('main');
      await expect(main.getByRole('heading', { level: 1 }), route).toHaveText('No access');
      await expect(main).toContainText('You do not have access to this area.');
      await expect(main.getByRole('button', { name: 'Request access' })).toBeDisabled();
      await expect(page.locator(`[data-route="${route}"]`)).toHaveCount(0);
      // The dev toggle never bypasses the permission check.
      await page.goto(url(route, 'loading', CLERK_WORKSPACE));
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
    }
    // The same pages render normally for the owner.
    // Scoped to `main`: a hidden copy of the page can sit outside it while the route settles, and
    // an unscoped locator then matches two elements.
    for (const route of CLERK_DENIED_ROUTES) {
      await page.goto(url(route));
      await expect(page.locator(`main [data-route="${route}"]`)).toBeVisible();
    }
    // And the clerk still gets every other placeholder.
    await page.goto(url('matters', undefined, CLERK_WORKSPACE));
    await expect(page.locator('main [data-route="matters"]')).toBeVisible();
  });

  test('flag-gated routes are not found while their flag is off', async ({ page, asUser }) => {
    await openShell(page, asUser, { wait: false });
    // The shell nav is built from the server-evaluated flags (#22): no link to a dark route.
    await expect(page.locator('a[href$="/matters"]').first()).toBeAttached();
    for (const route of FLAG_GATED_ROUTES) {
      await expect(page.locator(`a[href$="/${route}"]`), route).toHaveCount(0);
    }
    for (const route of FLAG_GATED_ROUTES) {
      // Status is 200: the page streams behind the workspace loading boundary before notFound().
      await page.goto(url(route));
      await expect(page.locator('main').getByRole('heading', { level: 1 }), route).toHaveText(
        'Page not found',
      );
      await expect(page.locator(`[data-route="${route}"]`)).toHaveCount(0);
    }
  });
});
