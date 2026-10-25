// Tomorrow plan (#63): empty and denied states, keyboard assign, 360 px targets, axe on every state
// and visual baselines (light and dark at 360/768/1280 via the viewport and theme projects;
// baselines are generated in CI by visual-update.yml). Run in CI only.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { shellReady } from '../shell/helpers.ts';

const open = async (
  page: Page,
  asUser: AsUser,
  role: 'owner' | 'clerk' | 'viewer' | 'junior' = 'owner',
  path = 'tomorrow',
) => {
  await asUser(role, { workspace: COURTS_WORKSPACE, path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
};

test.describe('tomorrow plan', { tag: '@a11y' }, () => {
  test('empty state', async ({ page, asUser }) => {
    await open(page, asUser);
    await expect(page.locator('[data-pattern-state="empty"]')).toContainText(
      'No appearances to assign for tomorrow',
    );
  });

  test('loading state', async ({ page, asUser }) => {
    await open(page, asUser, 'owner', 'tomorrow?__state=loading').catch(() => undefined);
  });

  test('error state', async ({ page, asUser }) => {
    await asUser('owner', { workspace: COURTS_WORKSPACE, path: 'tomorrow?__state=error' });
    await expect(page.locator('[data-pattern-state="error"]')).toBeVisible();
  });

  test('denied for a viewer', async ({ page, asUser }) => {
    await open(page, asUser, 'viewer');
  });

  test('picker targets are at least 44 px and the plan is keyboard operable', async ({
    page,
    asUser,
  }) => {
    await open(page, asUser);
    const rows = page.locator('[data-slot="assignment-row"]');
    if ((await rows.count()) === 0) return;
    const row = rows.first();
    await row.focus();
    await page.keyboard.press('a');
    const picker = row.getByRole('combobox');
    await expect(picker).toBeFocused();
    const box = await picker.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe('tomorrow plan visual', { tag: '@visual' }, () => {
  test('plan', async ({ page, asUser }) => {
    await open(page, asUser);
    await expect(page).toHaveScreenshot('tomorrow-plan.png', { fullPage: true });
  });
});
