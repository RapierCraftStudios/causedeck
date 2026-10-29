// Client status links (#88) with `status_links.enabled` on: create from a matter, open the public
// page, a dead link's generic page, three viewports, keyboard and axe (zero serious or critical).
// Written for CI; not run locally.
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { enableStatusLinks, seedClientContact } from '../../fixtures/limitation-data.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

const SIZES = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

// The button's handler attaches on hydration, which can trail the content: retry the click.
async function openSheet(page: Page, dialog: Locator): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: 'Share a status link' }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test.describe('status links', () => {
  for (const size of SIZES) {
    test(`create, view and revoke at ${String(size.width)}px`, async ({ page, asUser, db }) => {
      await enableStatusLinks(db.name);
      await seedClientContact(db.name);
      await page.setViewportSize(size);
      await asUser('owner', { workspace: MATTERS_WORKSPACE, path: `matters/${MATTERS.appeal.id}` });
      await contentReady(page);
      const dialog = page.getByRole('dialog');
      await openSheet(page, dialog);
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
      await openSheet(page, dialog);
      await dialog.getByRole('button', { name: 'Revoke' }).first().click();
      // The revoke is a server action: wait for the list to show it before opening the link.
      await expect(dialog.getByText(/^Revoked/)).toBeVisible();
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
