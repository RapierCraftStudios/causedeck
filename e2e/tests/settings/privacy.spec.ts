// Settings privacy page (#286): `/w/<slug>/settings/privacy` leads with the summary card, shows
// India-only AI processing on and locked with its explanation (no control turns it off), and lets
// owners and advocates change the sensitive-matter default and the raw audio retention window: each
// change autosaves, persists across a reload and lands in the audit log. Clerks and viewers get the
// permission-denied page. States: loading and error (dev previews), offline (read-only with the
// banner). `@a11y` tests run axe on the page they end on. Every test starts from the reset e2e seed.
import type { Page } from '@playwright/test';

import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const SUMMARY =
  'Your data stays in India. AI processing stays in India. We never train on your content.';

async function openPrivacy(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `settings/privacy${query}` });
  await expect(
    page.locator('main').getByRole('heading', { level: 1, name: 'Privacy' }),
  ).toBeVisible();
  await shellReady(page);
}

const indiaOnlySwitch = (page: Page) =>
  page.getByRole('switch', { name: 'India-only AI processing' });
const sensitiveSwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Restrict sensitive matters by default' });
const retentionSelect = (page: Page) => page.getByRole('combobox', { name: 'Keep raw audio for' });

test.describe('settings privacy', () => {
  test(
    'India-only AI is on and locked, with the summary card and its explanation',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openPrivacy(page, asUser);
      await expect(page.locator('[data-slot="privacy-summary"]')).toHaveText(SUMMARY);
      await expect(indiaOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
      await expect(indiaOnlySwitch(page)).toBeDisabled();
      await expect(indiaOnlySwitch(page)).toHaveAccessibleDescription(
        /process data in India, under terms that forbid keeping or training on your content/,
      );
      await expect(page.getByText('Locked on')).toBeVisible();
      // No override path in the standard UI.
      await expect(page.getByText(/processed outside India/)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'See the sub-processor list' })).toHaveAttribute(
        'href',
        '/legal/sub-processors',
      );
      await expect(page.getByRole('heading', { name: 'What CauseDeck never does' })).toBeVisible();
    },
  );

  test(
    'an owner changes the sensitive default and retention: persisted and audited',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openPrivacy(page, asUser);
      await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'true');
      await sensitiveSwitch(page).click();
      await expect(page.getByText('Privacy settings saved.').first()).toBeVisible();
      await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'false');

      await expect(retentionSelect(page)).toHaveText('30 days');
      await retentionSelect(page).click();
      await page.getByRole('option', { name: '14 days' }).click();
      await expect(retentionSelect(page)).toHaveText('14 days');
      await expect(page.locator('[data-slot="privacy-status"]')).toContainText('Saved');

      await page.reload();
      await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'false');
      await expect(retentionSelect(page)).toHaveText('14 days');
      await expect(indiaOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');

      await page.goto(`/w/${SHELL_WORKSPACE}/activity?tab=security`);
      await expect(page.getByText('workspace.privacy_updated').first()).toBeVisible();
    },
  );

  test('Undo in the toast puts the setting back', async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    await sensitiveSwitch(page).click();
    await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Change undone.')).toBeVisible();
    await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('an advocate can change the settings', async ({ page, asUser }) => {
    await openPrivacy(page, asUser, 'advocate');
    await expect(
      page.getByText('Only owners and advocates can change these settings.'),
    ).toHaveCount(0);
    await sensitiveSwitch(page).click();
    await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'false');
    // The switch flips optimistically; reloading before the save lands would abort it.
    await expect(page.locator('[data-slot="privacy-status"]')).toContainText('Saved');
    await page.reload();
    await expect(sensitiveSwitch(page)).toHaveAttribute('aria-checked', 'false');
  });

  for (const role of ['clerk', 'viewer'] as const) {
    test(
      `a ${role} gets the permission-denied page`,
      { tag: '@a11y' },
      async ({ page, asUser }) => {
        await asUser(role, { path: 'settings/privacy' });
        await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
          'No access',
        );
      },
    );
  }

  test('offline: read-only with the banner', async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText('Settings can be changed when you are back online.')).toBeVisible();
    await expect(sensitiveSwitch(page)).toHaveAttribute('aria-readonly', 'true');
    await expect(retentionSelect(page)).toBeDisabled();
    await page.context().setOffline(false);
    await expect(sensitiveSwitch(page)).not.toHaveAttribute('aria-readonly', 'true');
  });

  test('loading and error states (dev previews)', async ({ page, asUser }) => {
    await openPrivacy(page, asUser, 'owner', '?__state=loading');
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/privacy?__state=error`);
    await expect(page.getByText('Could not load the privacy settings.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('never scrolls sideways', async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
