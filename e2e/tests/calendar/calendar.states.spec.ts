// Calendar states (#815): empty, error with Try again, offline and loading, each with zero serious
// or critical axe violations (the fixture runs axe on the page each test ends on).
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

const open = (path: string) => ({ workspace: COURTS_WORKSPACE, path: `calendar${path}` }) as const;

test.describe('calendar states', { tag: '@a11y' }, () => {
  test('a range with no entries shows the empty state', async ({ page, asUser }) => {
    // Far from any seeded listing or deadline.
    await asUser('owner', open('?view=week&day=2090-01-07'));
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
    await shellReady(page);
    const empty = page.locator('[data-pattern-state="empty"]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Nothing listed this range.');
  });

  test('a failed read shows the error boundary with retry', async ({ page, asUser }) => {
    await asUser('owner', open('?__state=error'));
    await expect(page.getByRole('heading', { name: 'Could not load the calendar.' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('offline shows the notice and clears when back online', async ({ page, asUser }) => {
    await asUser('owner', open(''));
    await shellReady(page);
    const notice = page.locator('[data-pattern-state="offline"]');
    await expect(notice).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('You are offline.');
    await page.context().setOffline(false);
    await expect(notice).toHaveCount(0);
  });

  test('loading shows the skeleton', async ({ page, asUser }) => {
    await asUser('owner', open('?__state=loading'));
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
  });
});
