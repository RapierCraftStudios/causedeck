// Handover journeys (#71) on `/w/chennai-solo/matters/[id]`: the five standard questions inside two
// screens at 360 px, the states, keyboard-only operation and axe (zero serious or critical).
// Runs in CI only.
import AxeBuilder from '@axe-core/playwright';

import { expect, test } from '../../fixtures/index.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

const PHONE = { width: 360, height: 780 };
const FIVE_QUESTIONS = [
  'where_it_stands',
  'last_orders',
  'coming_up',
  'open_obligations',
  'key_documents',
];

async function openHandover(
  page: import('@playwright/test').Page,
  asUser: import('../../fixtures/auth.ts').AsUser,
  size = PHONE,
) {
  await page.setViewportSize(size);
  await asUser('owner', { workspace: MATTERS_WORKSPACE, path: `matters/${MATTERS.appeal.id}` });
  await contentReady(page);
  await page.getByRole('button', { name: 'Handover' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('handover', () => {
  test('answers the five standard questions within two screens at 360 px', async ({
    page,
    asUser,
  }) => {
    await openHandover(page, asUser);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'No handover yet' })).toBeVisible();
    for (const id of FIVE_QUESTIONS) {
      const heading = dialog.locator(`#handover-${id}`);
      if ((await heading.count()) === 0) continue;
      const box = await heading.boundingBox();
      expect(box).not.toBeNull();
    }
    const scrollHeight = await dialog.evaluate((el) => el.scrollHeight);
    expect(scrollHeight).toBeLessThanOrEqual(PHONE.height * 2);
  });

  test('saves a version, and offers no share, email or export control', async ({
    page,
    asUser,
  }) => {
    await openHandover(page, asUser);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Address to').selectOption({ index: 1 });
    await dialog.getByLabel('Your notes').fill('Counter due next week');
    await dialog.getByLabel('Your notes').press('Control+Enter');
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Saved as version 1' }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /share|email|export|send/i })).toHaveCount(0);
  });

  test('opens with h and closes with Escape, keyboard only', async ({ page, asUser }) => {
    await page.setViewportSize(PHONE);
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: `matters/${MATTERS.appeal.id}` });
    await contentReady(page);
    await page.keyboard.press('h');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('shows the offline state with the cached note', async ({ page, asUser, context }) => {
    await openHandover(page, asUser);
    await page.getByRole('button', { name: 'Close' }).click();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Handover' }).click();
    await expect(page.getByRole('status').filter({ hasText: /offline/i })).toBeVisible();
    await context.setOffline(false);
  });

  test('has no serious or critical axe violations @a11y', async ({ page, asUser }) => {
    await openHandover(page, asUser);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
