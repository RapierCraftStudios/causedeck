// GSTIN capture on the billing page (#257): format and check-character errors are explained, a
// valid GSTIN is saved (normalised to uppercase) and shown, and it applies to future invoices
// only: the seeded invoices are unchanged.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import { INVOICES, seedBilling } from './billing-data.ts';

/** Valid format and check character (GSTN mod-36). */
const VALID = '27AAPFU0939F1ZV';
const BAD_CHECK = '27AAPFU0939F1ZA';

async function openBilling(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'billing' });
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await shellReady(page);
}

test.describe('GSTIN', () => {
  test('explains format and check-character errors, then saves a valid GSTIN', async ({
    page,
    asUser,
    db,
  }) => {
    await seedBilling(db.name, 'chennai-solo');
    await openBilling(page, asUser);
    const form = page.locator('[data-slot="billing-gstin"]');
    const input = form.getByRole('textbox', { name: 'GSTIN' });
    const save = form.getByRole('button', { name: 'Save GSTIN' });
    await expect(form).toContainText(
      'Applies to future invoices only; issued invoices are not changed.',
    );

    await input.fill('27AAPFU');
    await save.click();
    await expect(form).toContainText('Enter a 15-character GSTIN');

    await input.fill(BAD_CHECK);
    await save.click();
    await expect(form).toContainText('The last character of this GSTIN does not match the rest.');

    await input.fill(VALID.toLowerCase());
    await save.click();
    await expect(form.getByRole('status')).toHaveText('GSTIN saved.');
    await expect(input).toHaveValue(VALID);

    await page.reload();
    await expect(
      page.locator('[data-slot="billing-gstin"]').getByRole('textbox', { name: 'GSTIN' }),
    ).toHaveValue(VALID);
    // Issued invoices keep their amounts and numbers.
    for (const invoice of INVOICES)
      await expect(page.locator('main')).toContainText(invoice.number);
    await expect(page.locator('main')).toContainText('₹6,827.48');
  });
});
