// Usage page (#223): `/w/<slug>/settings/usage` shows the owner a meter per resource with percent
// used, a `role=progressbar` with aria values, the reset date and `AI processing budget resets on
// <1 MMM>`; at 80% a warning icon and text sit beside the colour. States: empty, permission-denied,
// loading and error (dev previews) and offline. Linked from settings and billing. `@a11y` tests
// also run axe (zero serious or critical violations) on the page they end on.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import { seedUsage } from './usage-data.ts';

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Usage' });

async function openUsage(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'settings/usage' });
  await expect(heading(page)).toBeVisible();
  await shellReady(page);
}

test.describe('usage page', () => {
  test(
    'shows meters with percent used, reset date and the 80% warning',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedUsage(db.name, 'chennai-solo');
      await openUsage(page, asUser);

      const ai = page.locator('[data-meter="ai"]');
      const bar = ai.getByRole('progressbar', { name: 'AI processing' });
      await expect(bar).toHaveAttribute('aria-valuenow', '80');
      await expect(bar).toHaveAttribute('aria-valuemin', '0');
      await expect(bar).toHaveAttribute('aria-valuemax', '100');
      await expect(ai).toContainText('₹140.00 of ₹175.00');
      await expect(ai).toContainText('80% used');
      await expect(ai.locator('[data-slot="usage-meter-reset"]')).toHaveText(
        /^AI processing budget resets on 1 [A-Z][a-z]{2}$/,
      );

      // Colour is never the only signal: the warning has an icon and text.
      const level = ai.locator('[data-slot="usage-meter-level"]');
      await expect(level).toHaveAttribute('data-level', 'warning');
      await expect(level.locator('svg')).toHaveCount(1);
      await expect(level).toContainText(
        "You have used 80% of this month's AI processing budget. Existing work is not affected.",
      );

      await expect(page.locator('[data-slot="usage-meter"]')).toHaveCount(4);
      await expect(page.locator('[data-slot="usage-empty"]')).toHaveCount(0);
      const table = page.getByRole('table', { name: 'Usage by resource this month' });
      await expect(table.locator('tbody tr')).toHaveCount(7);
    },
  );

  test('shows the empty state with no usage', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openUsage(page, asUser);
    await expect(page.locator('[data-slot="usage-empty"]')).toContainText(
      'No usage yet this month.',
    );
  });

  test(
    'tells non-owners that only owners see usage',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await asUser('advocate', { path: 'settings/usage' });
      const main = page.locator('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(main).toContainText('Only workspace owners can see usage.');
      await expect(page.locator('[data-slot="usage-meter"]')).toHaveCount(0);
    },
  );

  test('previews the loading and error states in development', async ({ page, asUser }) => {
    // The e2e build serves the dev previews (as the billing spec relies on); without them the
    // page renders normally and these locators would not appear.
    await asUser('owner', { path: 'settings/usage?__state=loading' });
    await expect(page.locator('[data-slot="usage-skeleton"]')).toBeVisible();
    await page.goto('/w/chennai-solo/settings/usage?__state=error');
    const error = page.locator('[data-pattern-state="error"]');
    await expect(error).toContainText('Could not load usage.');
    await expect(error.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('stays readable offline', async ({ page, asUser, db }) => {
    await seedUsage(db.name, 'chennai-solo');
    await openUsage(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();
    await expect(page.locator('[data-meter="ai"]')).toContainText('₹140.00 of ₹175.00');
    await page.context().setOffline(false);
  });

  test('is linked from settings and billing', async ({ page, asUser }) => {
    await asUser('owner', { path: 'settings' });
    await page.getByRole('link', { name: /^Usage/ }).click();
    await expect(heading(page)).toBeVisible();
    await page.goto('/w/chennai-solo/billing');
    await page.getByRole('link', { name: 'View usage' }).click();
    await expect(heading(page)).toBeVisible();
  });

  test('hides the usage link in settings from non-owners', async ({ page, asUser }) => {
    await asUser('advocate', { path: 'settings' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('a[href$="/settings/usage"]')).toHaveCount(0);
  });
});
