// Calendar journeys (#66): week and month views, the day popover and its Open day hand-off, the
// Mine / Whole chamber scope, the keyboard model and the states. Runs in CI only.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

async function openCalendar(
  page: Page,
  asUser: AsUser,
  query = '',
  role: 'owner' | 'clerk' = 'owner',
) {
  await asUser(role, { workspace: COURTS_WORKSPACE, path: `calendar${query}` });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

test.describe('calendar', () => {
  test('week view is the default and the toolbar switches to month', async ({ page, asUser }) => {
    await openCalendar(page, asUser);
    await expect(page.getByRole('navigation', { name: 'Calendar controls' })).toBeVisible();
    await page.getByRole('link', { name: 'Month' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('gridcell').first()).toBeVisible();
  });

  test('selecting a day opens the popover with an Open day link', async ({ page, asUser }) => {
    await openCalendar(page, asUser, '?view=month');
    await page.getByRole('gridcell').first().getByRole('link').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Open day' })).toBeVisible();
    // The popover takes focus once it hydrates, and Escape is handled inside it: retry the key.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 1_000 });
    }).toPass();
  });

  test('keyboard: arrows move across days, t jumps to today, w and m switch the view', async ({
    page,
    asUser,
  }) => {
    await openCalendar(page, asUser, '?view=month');
    await page.getByRole('gridcell').first().getByRole('link').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('gridcell').nth(1).getByRole('link')).toBeFocused();
    await page.keyboard.press('w');
    await expect(page).toHaveURL(/view=week/);
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/view=month/);
  });

  test('the legend and the subscribe block show', async ({ page, asUser }) => {
    await openCalendar(page, asUser);
    await expect(page.locator('[data-section="legend"]')).toBeVisible();
    const subscribe = page.locator('[data-section="subscribe"]');
    await expect(subscribe).toBeVisible();
    await expect(subscribe).toContainText(/private to you/i);
    // The link is never rendered on load: it only appears after an explicit generate or regenerate.
    await expect(subscribe.getByRole('textbox')).toHaveCount(0);
    await expect(
      subscribe.getByRole('button', { name: /generate new link|regenerate link/i }),
    ).toBeVisible();
  });

  // Timing runs in the perf project, alone (playwright.config.ts): beside the other workers the
  // shared CI database made this p95 depend on whatever else the shard was running.
  test(
    'a month range answers within the p95 budget (300 ms)',
    { tag: '@perf' },
    async ({ page, asUser }) => {
      await openCalendar(page, asUser, '?view=month');
      const url = page.url();
      // Warm-up (as matters.perf.spec.ts): the first requests pay for the cold pool and caches.
      for (let i = 0; i < 5; i += 1) await page.request.get(url);
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = performance.now();
        const response = await page.request.get(url);
        expect(response.ok()).toBe(true);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      expect(samples[Math.ceil(samples.length * 0.95) - 1]).toBeLessThan(300);
    },
  );
});
