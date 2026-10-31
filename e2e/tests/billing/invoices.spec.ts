// Billing page read view (#256): `/w/<slug>/billing` shows the owner the current plan, seats (with
// clerk seats), the next renewal, the UPI Autopay state, grace banners and the invoices table
// (number, date, amount, status, PDF), with amounts from `formatInr` and dates as `dd MMM yyyy`.
// States: empty invoices, payment failed in grace, Junior, permission-denied, loading, error and
// offline. `@a11y` tests also run axe (zero serious or critical violations) on the page they end
// on.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { layoutOf, shellReady } from '../shell/helpers.ts';

import { downgradeToJunior, INVOICES, seedBilling, setGrace } from './billing-data.ts';

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Billing' });

async function openBilling(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'billing' });
  await expect(heading(page)).toBeVisible();
  await shellReady(page);
}

/** The invoice list items for this viewport: cards on phones, table rows from 768 px. */
function invoiceRows(page: Page): Locator {
  return layoutOf(page) === 'phone'
    ? page.locator('[data-slot="billing-invoice-cards"] li')
    : page.getByRole('table').locator('tbody tr');
}

test.describe('billing page', () => {
  test(
    'shows plan, seats, renewal, payment method and invoices',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedBilling(db.name, 'chennai-solo');
      await openBilling(page, asUser);

      const plan = page.locator('[data-slot="billing-plan"]');
      await expect(
        plan.getByRole('heading', { name: 'Chamber 1 (per seat, monthly)' }),
      ).toBeVisible();
      await expect(plan.locator('[data-status="active"]')).toHaveText('Active');
      // 10 seats x ₹499 + 4 clerk seats x ₹199, ex-GST.
      await expect(plan.locator('[data-slot="billing-price"]')).toHaveText('₹5,786.00');
      await expect(plan).toContainText('/ month');
      await expect(plan).toContainText('GST at 18% is added to this price.');
      await expect(plan.locator('[data-slot="billing-renewal"]')).toHaveText(
        'Renews on 12 Apr 2026',
      );

      const seats = page.locator('[data-slot="billing-seats"]');
      await expect(seats).toContainText(/\d+ of 10 seats/);
      await expect(seats).toContainText(/\d+ of 4 clerk seats/);

      await expect(page.locator('[data-slot="billing-payment-method"]')).toContainText(
        'UPI Autopay active',
      );

      if (layoutOf(page) !== 'phone') {
        await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
          'Number',
          'Date',
          'Amount',
          'Status',
          'PDF',
        ]);
      }
      const [paid, issued] = INVOICES;
      const rows = invoiceRows(page);
      // Newest first.
      await expect(rows).toHaveCount(2);
      const issuedRow = rows.nth(0);
      const paidRow = rows.nth(1);

      await expect(paidRow).toContainText(paid?.number ?? '');
      await expect(paidRow).toContainText('12 Feb 2026');
      await expect(paidRow).toContainText('₹6,827.48');
      await expect(paidRow).toContainText('Paid');
      const pdf = paidRow.getByRole('link', {
        name: `Download invoice ${paid?.number ?? ''} (PDF)`,
      });
      await expect(pdf).toHaveAttribute(
        'href',
        /\/w\/chennai-solo\/billing\/invoices\/[\w-]+\/pdf$/,
      );

      await expect(issuedRow).toContainText(issued?.number ?? '');
      await expect(issuedRow).toContainText('12 Mar 2026');
      // Indian grouping: 1,23,456 rupees.
      await expect(issuedRow).toContainText('₹1,23,456.78');
      await expect(issuedRow).toContainText('Issued');
      await expect(issuedRow).toContainText('Preparing');
      await expect(issuedRow.getByRole('link')).toHaveCount(0);
    },
  );

  test('shows the empty invoices state', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openBilling(page, asUser);
    await expect(
      page.getByText('No invoices yet. Your first invoice appears after your first payment.'),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test(
    'shows the payment-failed alert with the grace countdown',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedBilling(db.name, 'chennai-solo');
      await setGrace(db.name, 'chennai-solo', 3);
      await openBilling(page, asUser);
      const banner = page.locator('[data-slot="billing-banner"]');
      await expect(banner).toHaveAttribute('data-banner', 'grace');
      await expect(banner).toContainText('Payment failed');
      await expect(banner).toContainText(
        /Access continues until \d{2} \w{3} \d{4} \(3 days left\)/,
      );
      // The owner can restart the UPI Autopay mandate from the banner (#1072).
      await expect(banner.getByRole('button', { name: 'Update payment method' })).toBeEnabled();
      await expect(page.locator('[data-slot="billing-plan"] [data-status="grace"]')).toHaveText(
        /^Past due: grace until \d{2} \w{3} \d{4}$/,
      );
      await expect(page.locator('[data-slot="billing-payment-method"]')).toContainText(
        'UPI Autopay failed',
      );
    },
  );

  test(
    'shows the Junior state with upgrade cards',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await downgradeToJunior(db.name, 'chennai-solo');
      await openBilling(page, asUser);
      await expect(
        page.getByRole('heading', { name: 'You are on the free Junior plan' }),
      ).toBeVisible();
      const upgrades = page.locator('[data-slot="billing-upgrade"]');
      await expect(upgrades).toHaveCount(2);
      await expect(upgrades.first()).toContainText('From ₹499.00');
      // The owner can start a checkout from either card (#1072).
      await expect(page.getByRole('button', { name: 'Upgrade to Advocate' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Upgrade to Chamber' })).toBeEnabled();
      await expect(page.locator('[data-slot="billing-payment-method"]')).toHaveCount(0);
    },
  );

  test(
    'tells non-owners that only owners manage billing',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await asUser('advocate', { path: 'billing' });
      const main = page.locator('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(main).toContainText('Only workspace owners can manage billing.');
      await expect(page.locator('[data-slot="billing-plan"]')).toHaveCount(0);
    },
  );

  test('previews the loading and error states in development', async ({ page, asUser }) => {
    await asUser('owner', { path: 'billing?__state=loading' });
    await expect(page.locator('[data-slot="billing-skeleton"]')).toBeVisible();
    await page.goto('/w/chennai-solo/billing?__state=error');
    // Next's route announcer is also role=alert: target the error state itself.
    const error = page.locator('[data-pattern-state="error"]');
    await expect(error).toContainText('Could not load billing.');
    await expect(error.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('stays readable offline', async ({ page, asUser, db }) => {
    // The mandate button only shows when the mandate needs attention (failed or pending), so the
    // grace state is the one where it exists offline too.
    await seedBilling(db.name, 'chennai-solo');
    await setGrace(db.name, 'chennai-solo', 3);
    await openBilling(page, asUser);
    await page.context().setOffline(true);
    // Two notices: the shell's saved-data banner and the billing page's own "changes unavailable".
    await expect(page.getByText(/You are offline\. Showing saved data from/)).toBeVisible();
    await expect(page.getByText(/You are offline\. Billing changes are unavailable/)).toBeVisible();
    await expect(page.locator('[data-slot="billing-plan"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change plan' })).toBeDisabled();
    await expect(
      page
        .locator('[data-slot="billing-banner"]')
        .getByRole('button', { name: 'Update payment method' }),
    ).toBeDisabled();
    await page.context().setOffline(false);
  });
});
