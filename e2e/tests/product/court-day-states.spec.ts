// `/w/chennai-solo/tomorrow` states (#815), matching the `/today` state tests in
// court-day-board.spec.ts: empty, error with Try again, offline with the saved-at time and the
// loading skeleton. `@a11y` runs axe after each test (zero serious or critical violations).
import { expect as baseExpect, test } from '../../fixtures/index.ts';
import { seedCourtDay } from '../../fixtures/court-day-data.ts';
import { contentReady } from '../shell/helpers.ts';

const expect = baseExpect.configure({ timeout: 15_000 });

const DESKTOP = { width: 1280, height: 800 };

test.describe('tomorrow states', { tag: '@a11y' }, () => {
  test.describe.configure({ timeout: 90_000 });

  test('an empty day shows the board and plan empty states', async ({ page, asUser, db }) => {
    await seedCourtDay(db, { listings: false });
    await page.setViewportSize(DESKTOP);
    await asUser('owner', { path: '/tomorrow' });
    await contentReady(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Tomorrow' })).toBeVisible();
    await expect(page.locator('[data-pattern-state="empty"]').first()).toBeVisible();
    await expect(page.getByText('No appearances to assign for tomorrow')).toBeVisible();
    await expect(page.locator('[data-court-item]')).toHaveCount(0);
  });

  test('a failed read shows the error boundary with retry', async ({ page, asUser, db }) => {
    await seedCourtDay(db);
    await page.setViewportSize(DESKTOP);
    await asUser('owner', { path: '/tomorrow?__state=error' });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('[data-court-item]')).toHaveCount(0);
  });

  test('offline shows the banner with the time the data was read', async ({ page, asUser, db }) => {
    await seedCourtDay(db);
    await page.setViewportSize(DESKTOP);
    await asUser('owner', { path: '/tomorrow' });
    await contentReady(page);
    const banner = page.locator('[data-offline-banner]');
    await expect(banner).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(/^Offline\. Showing data saved at \d{1,2}:\d{2}/);
    await expect(page.getByText(/You are offline\. Showing saved data from/)).toBeVisible();
    // The last known data stays.
    await expect(page.locator('[data-court-item]').first()).toBeVisible();
    await page.context().setOffline(false);
    await expect(banner).toHaveCount(0);
  });

  test('loading shows the skeleton instead of the board', async ({ page, asUser, db }) => {
    await seedCourtDay(db);
    await page.setViewportSize(DESKTOP);
    await asUser('owner', { path: '/tomorrow?__state=loading' });
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await expect(page.locator('[data-court-item]')).toHaveCount(0);
  });
});
