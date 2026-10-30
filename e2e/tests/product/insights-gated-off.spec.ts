// Practice insights gated off (#966): `insights.enabled` ships off. With it off the route and the
// printable report are a plain "Page not found" for every role and the shell nav has no Insights
// link, even with hearings seeded. Nothing here enables the flag.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { seedInsights } from '../../fixtures/insights-data.ts';
import { SHELL_WORKSPACE, contentReady, openShell } from '../shell/helpers.ts';

const notFound = (page: Page) =>
  page.locator('main').getByRole('heading', { level: 1 }).filter({ visible: true });

test.describe('practice insights, flag off', () => {
  test(
    'the route is not found, even for the owner and with data seeded',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedInsights(db.name);
      await asUser('owner', { workspace: SHELL_WORKSPACE, path: 'insights' });
      // The page streams behind the workspace loading boundary before notFound(): status is 200.
      await expect(notFound(page)).toHaveText('Page not found');
      await expect(page.locator('[data-route="insights"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="insights-hero-rate"]')).toHaveCount(0);
    },
  );

  test('the printable report is not found either', async ({ page, asUser, db }) => {
    await seedInsights(db.name);
    await asUser('owner', { workspace: SHELL_WORKSPACE, path: 'insights/report' });
    await expect(notFound(page)).toHaveText('Page not found');
    await expect(page.locator('[data-route="insights-report"]')).toHaveCount(0);
  });

  test('the nav has no Insights entry', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await contentReady(page);
    await expect(page.locator('a[href$="/matters"]').first()).toBeAttached();
    await expect(page.locator('a[href$="/insights"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Insights' })).toHaveCount(0);
  });

  test('a clerk gets the same not-found page, not "No access"', async ({ page, asUser }) => {
    await asUser('clerk', { workspace: SHELL_WORKSPACE, path: 'insights' });
    await expect(notFound(page)).toHaveText('Page not found');
  });
});
