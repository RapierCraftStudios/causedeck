// Owner billing actions (#257) with the mock billing provider: the owner changes seats and plan
// through a confirm summary (base, GST at 18%, GST-inclusive total, prorated charge, effective
// date), cancels at period end and resumes, and sees that data stays accessible read-only and
// exportable (#31). Non-owners (clerk, viewer) get the permission-denied state (`billing.manage`
// is owner-only, #20). The web server's mock provider adopts the seeded `sub_e2e_<ws>` row.
import type { Page } from '@playwright/test';
import postgres from 'postgres';

import type { AsUser } from '../../fixtures/auth.ts';
import { E2E_WORKSPACES, expect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { shellReady } from '../shell/helpers.ts';

/** A current billing period around the server's clock, so a change is prorated. */
async function currentPeriod(database: string) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      update subscription
      set current_period_start = now() - interval '10 days',
          current_period_end = now() + interval '20 days'
      where workspace_id = ${E2E_WORKSPACES['chennai-solo'].id}`;
  } finally {
    await sql.end();
  }
}

async function openBilling(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'billing' });
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await shellReady(page);
}

const RUPEES = /₹[\d,]+\.\d{2}/;

test.describe('owner billing actions', () => {
  test('changes seats through a confirm summary', async ({ page, asUser, db }) => {
    await currentPeriod(db.name);
    await openBilling(page, asUser);
    const seats = page.locator('[data-slot="billing-seats"]');
    await seats.getByRole('button', { name: 'Add a seat' }).click();
    await expect(seats.locator('[data-value="seats"]')).toHaveText('11');
    await seats.getByRole('button', { name: 'Review change' }).click();

    const quote = seats.locator('[data-slot="billing-quote"]');
    await expect(quote).toContainText('GST at 18%');
    await expect(quote.locator('[data-quote="total"]')).toContainText(RUPEES);
    await expect(quote.locator('[data-quote="prorationTotal"]')).toContainText(RUPEES);
    await expect(seats.locator('[data-slot="billing-quote-effective"]')).toContainText(
      'Takes effect now',
    );
    await seats.getByRole('button', { name: 'Confirm change' }).click();
    await expect(seats.getByRole('status')).toHaveText('Seats updated.');
    await expect(seats).toContainText(/\d+ of 11 seats/);
  });

  test('changes plan in two steps with base, proration, GST and total', async ({
    page,
    asUser,
    db,
  }) => {
    await currentPeriod(db.name);
    await openBilling(page, asUser);
    await page.getByRole('button', { name: 'Change plan' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-plan-option="chamber-seat-2"]').click();
    await expect(dialog.getByRole('heading')).toContainText('Move to');
    for (const row of ['base', 'gst', 'total', 'proration', 'prorationGst', 'prorationTotal']) {
      await expect(dialog.locator(`[data-quote="${row}"]`)).toContainText(RUPEES);
    }
    await expect(dialog.locator('[data-slot="billing-quote-effective"]')).toContainText(
      'Takes effect now',
    );
    await dialog.getByRole('button', { name: 'Confirm change' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.locator('[data-slot="billing-plan"]').getByRole('heading', { level: 2 }),
    ).toContainText('Chamber 2');
  });

  test('cancels at period end and resumes', async ({ page, asUser, db }) => {
    await currentPeriod(db.name);
    await openBilling(page, asUser);
    const plan = page.locator('[data-slot="billing-plan"]');
    await plan.getByRole('button', { name: 'Cancel plan' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(
      'After your plan ends, your data remains accessible read-only and can be exported.',
    );
    await dialog.getByRole('button', { name: 'Cancel at period end' }).click();
    await expect(dialog).toBeHidden();
    await expect(plan.locator('[data-status="cancelsOn"]')).toBeVisible();
    await expect(plan).toContainText('your data remains accessible read-only and can be exported');

    await plan.getByRole('button', { name: 'Resume plan' }).click();
    await expect(plan.locator('[data-status="active"]')).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Cancel plan' })).toBeVisible();
  });

  for (const role of ['clerk', 'viewer'] as const) {
    test(`a ${role} gets the permission-denied state`, async ({ page, asUser }) => {
      await asUser(role, { path: 'billing' });
      const main = page.locator('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(main).toContainText('Only workspace owners can manage billing.');
      await expect(page.getByRole('button', { name: 'Change plan' })).toHaveCount(0);
      await expect(page.locator('[data-slot="billing-gstin"]')).toHaveCount(0);
    });
  }
});
