// Brief Sheet journeys (#61) on `/w/chennai-solo/briefs/[listing-id]`: sections and chips, the
// Prepared mark, carry items, keyboard, viewer, three viewports and axe (zero serious or critical).
import AxeBuilder from '@axe-core/playwright';

import { expect, test } from '../../fixtures/index.ts';

import { openBrief } from './brief-helpers.ts';

const SIZES = {
  phone: { width: 360, height: 780 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

test.describe('brief sheet', () => {
  test('renders the sections in PR-1 order with a masthead', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const order = await page
      .locator('[data-section]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    const expected = [
      'stage',
      'last_order',
      'obligations',
      'carry',
      'synopsis',
      'last_hearing',
      'court_notes',
      'context',
    ];
    expect(order).toEqual(expected.filter((k) => order.includes(k)));
  });

  test('offers no send or email action', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await expect(page.getByRole('button', { name: /send|email/i })).toHaveCount(0);
  });

  test('prepared mark toggles and persists across a reload', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await page
      .getByRole('button', { name: /mark.*prepared/i })
      .first()
      .click();
    await expect(page.locator('[data-prepared]')).toContainText(/prepared by|by/i);
    await page.reload();
    await expect(page.locator('[data-prepared] [aria-pressed="true"]')).toBeVisible();
  });

  test('carry items can be added, ticked and removed', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    const list = page.locator('[data-carry-list]');
    await list.getByRole('textbox').fill('Vakalatnama');
    await list.getByRole('button', { name: /add/i }).click();
    await expect(list.getByText('Vakalatnama')).toBeVisible();
    await page.reload();
    await expect(list.getByText('Vakalatnama')).toBeVisible();
    await list.getByRole('checkbox', { name: /Vakalatnama/ }).check();
    await list.getByRole('button', { name: /remove.*Vakalatnama/i }).click();
    await expect(list.getByText('Vakalatnama')).toHaveCount(0);
  });

  test('keyboard: ? opens the shortcuts and Esc closes it; 1 jumps to a section', async ({
    page,
    asUser,
  }) => {
    await openBrief(page, asUser);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('1');
    await expect(page.locator('[data-section]').first()).toBeFocused();
  });

  test('a viewer reads the sheet without edit controls', async ({ page, asUser }) => {
    await openBrief(page, asUser, { role: 'viewer' });
    await expect(page.getByRole('button', { name: /mark.*prepared/i })).toBeDisabled();
    await expect(page.locator('[data-carry-list]').getByRole('textbox')).toHaveCount(0);
  });

  test('phone shows the jump chips; tablet and desktop centre the sheet', async ({
    page,
    asUser,
  }) => {
    await openBrief(page, asUser, { size: SIZES.phone });
    await expect(page.getByRole('navigation', { name: /jump|sections/i })).toBeVisible();
    for (const size of [SIZES.tablet, SIZES.desktop]) {
      await page.setViewportSize(size);
      const box = await page.locator('article').boundingBox();
      expect(box).not.toBeNull();
      if (box) expect(Math.abs(box.x + box.width / 2 - size.width / 2)).toBeLessThan(40);
    }
  });

  test('has no serious or critical axe violations @a11y', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
