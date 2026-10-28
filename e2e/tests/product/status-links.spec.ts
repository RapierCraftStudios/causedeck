// Client status links (#88) with `status_links.enabled` on: create from a matter, open the public
// page, a dead link's generic page, three viewports, keyboard and axe (zero serious or critical).
// Written for CI; not run locally.
import AxeBuilder from '@axe-core/playwright';

import { expect, test } from '../../fixtures/index.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

const SIZES = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

test.describe('status links', () => {
  for (const size of SIZES) {
    test(`create, view and revoke at ${size.width}px`, async ({ page, asUser }) => {
      await page.setViewportSize(size);
      await asUser('owner', { workspace: MATTERS_WORKSPACE, path: `matters/${MATTERS.appeal.id}` });
      await contentReady(page);
      await page.getByRole('button', { name: 'Share a status link' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Client contact').selectOption({ index: 1 });
      await dialog.getByLabel('Headline').fill('Hearing adjourned');
      await dialog.getByLabel('Note').fill('The next hearing is in November.');
      await expect(dialog.locator('[data-status-link-preview]')).toContainText('Hearing adjourned');
      await page.keyboard.press('Control+Enter');
      await expect(
        dialog.getByText('Share it yourself. CauseDeck does not send it.'),
      ).toBeVisible();
      const url = await dialog.getByLabel('Status link', { exact: true }).inputValue();

      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      ).toEqual([]);

      await page.goto(new URL(url).pathname);
      await expect(page.getByRole('heading', { name: 'Hearing adjourned' })).toBeVisible();
      await expect(page.getByText(/Prepared by/)).toBeVisible();
      const publicResults = await new AxeBuilder({ page }).analyze();
      expect(
        publicResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      ).toEqual([]);

      await page.goBack();
      await page.getByRole('button', { name: 'Share a status link' }).click();
      await page.getByRole('button', { name: 'Revoke' }).first().click();
      await page.goto(new URL(url).pathname);
      await expect(
        page.getByRole('heading', { name: 'This link is no longer available' }),
      ).toBeVisible();
    });
  }

  test('an unknown token shows the generic page without matter data', async ({ page }) => {
    await page.goto('/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(page.getByText(/no longer available/)).toBeVisible();
  });
});
