// Stale-matter attention (#70): the matters list shows an attention badge with a count; it opens the
// flag list with evidence grouped by rule; `s` snoozes, `Enter` opens the evidence, `Esc` closes.
// `@a11y` runs axe (zero serious or critical violations) in both themes; `@visual` compares
// baselines per viewport x theme project. Runs in CI only.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

async function openMatters(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'matters' });
  await expect(page.getByRole('heading', { level: 1, name: 'Matters' })).toBeVisible();
  await shellReady(page);
}

test.describe('stale-matter attention', () => {
  test(
    'the badge opens the flags grouped by rule, operable by keyboard',
    { tag: ['@a11y', '@visual'] },
    async ({ page, asUser }) => {
      await openMatters(page, asUser);
      const badge = page.locator('[data-attention-badge]');
      await expect(badge).toBeVisible();
      await badge.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
      await expect(page).toHaveScreenshot('attention-open.png');

      const item = page.getByRole('listitem').first();
      await item.focus();
      await page.keyboard.press('s');
      await expect(page.getByLabel('Reason')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByLabel('Reason')).toBeHidden();
    },
  );
});
