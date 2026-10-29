// Fees and invoices gated off (#872, part 5 of #83): `invoices.enabled` is a legal-gated flag that
// ships off. With it off every route is a plain "Page not found" and the shell nav has no Invoices
// link. Nothing here enables the flag, so the seeded records stay unreachable.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { FEES, seedFees } from '../../fixtures/fees-data.ts';
import { SHELL_WORKSPACE, contentReady, openShell } from '../shell/helpers.ts';

const notFound = (page: Page) =>
  page.locator('main').getByRole('heading', { level: 1 }).filter({ visible: true });

test.describe('fees and invoices, flag off', () => {
  test(
    'the list is not found, even for the owner and with records seeded',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedFees(db.name);
      await asUser('owner', { workspace: SHELL_WORKSPACE, path: 'invoices' });
      // The page streams behind the workspace loading boundary before notFound(): status is 200.
      await expect(notFound(page)).toHaveText('Page not found');
      await expect(page.locator('[data-route="invoices"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="invoice-row"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="fee-agreement-card"]')).toHaveCount(0);
    },
  );

  test('an invoice and the new-invoice page are not found either', async ({ page, asUser, db }) => {
    await seedFees(db.name);
    await asUser('owner', { workspace: SHELL_WORKSPACE, path: `invoices/${FEES.issued.id}` });
    await expect(notFound(page)).toHaveText('Page not found');
    await expect(page.locator('[data-slot="ledger"]')).toHaveCount(0);
    await page.goto(`/w/${SHELL_WORKSPACE}/invoices/new`);
    await expect(notFound(page)).toHaveText('Page not found');
    await expect(page.locator('[data-slot="invoice-editor"]')).toHaveCount(0);
  });

  test('the nav has no Invoices entry', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await contentReady(page);
    await expect(page.locator('a[href$="/matters"]').first()).toBeAttached();
    await expect(page.locator('a[href$="/invoices"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Invoices' })).toHaveCount(0);
  });

  test('a clerk gets the same not-found page', async ({ page, asUser }) => {
    await asUser('clerk', { workspace: SHELL_WORKSPACE, path: 'invoices' });
    await expect(notFound(page)).toHaveText('Page not found');
  });
});
