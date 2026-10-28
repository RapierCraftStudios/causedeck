// Proof of value (#86): the privacy card (opt-out, own answers, owner download) and the owner's
// context test, by keyboard; `@a11y` runs axe (zero serious or critical) in both themes.
// The weekly pulse and the preparedness tap depend on the clock and a confirmed outcome, so they are
// covered by the core unit tests and the stories. Runs in CI only.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

async function openPrivacy(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'settings/privacy' });
  await expect(page.getByRole('heading', { level: 2, name: 'Proof of value' })).toBeVisible();
  await shellReady(page);
}

test.describe('proof of value', () => {
  test(
    'the opt-out toggle works by keyboard and says prompts are off',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openPrivacy(page, asUser);
      const toggle = page.getByRole('checkbox', {
        name: 'Ask me preparedness and weekly questions',
      });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(page.getByText('Prompts are off. Nothing will ask you.')).toBeVisible();
    },
  );

  test('the owner runs the context test', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    await expect(page.getByRole('heading', { name: 'Context test' })).toBeVisible();
    const start = page.getByRole('button', { name: 'Start the test' });
    if (await start.isVisible()) {
      await start.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Timer started.')).toBeAttached();
    } else {
      await expect(page.getByText('No matters to test on yet.')).toBeVisible();
    }
  });

  test('the owner downloads the pilot report by keyboard', async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    const download = page.waitForEvent('download');
    const button = page.getByRole('button', { name: 'Download the pilot report' });
    await button.focus();
    await page.keyboard.press('Enter');
    expect((await download).suggestedFilename()).toBe('proof-of-value.csv');
  });
});
