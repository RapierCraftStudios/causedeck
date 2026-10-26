// Enquiry log accessibility (#875, #87 part 3): zero serious or critical axe violations on every
// enquiry state in every viewport and theme project (360/768/1280, light and dark). `@a11y`: the
// fixture runs axe on the page each test ends on (fixtures/index.ts), so each test ends on the
// state it names.
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import {
  ENQUIRIES,
  emptyEnquiries,
  enableEnquiryLog,
  enquiriesPath,
  enquiryRow,
  openEnquiries,
  seedEnquiries,
} from './enquiries.helpers.ts';

const url = (path: string) => `/w/${MATTERS_WORKSPACE}/${path}`;

test.describe('enquiry log accessibility', { tag: '@a11y' }, () => {
  test.beforeEach(async ({ db }) => {
    await enableEnquiryLog(db.name);
  });

  test('list', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await expect(page.locator('[data-enquiry-row]').first()).toBeVisible();
  });

  test('list: status carries its words, not colour alone', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await expect(enquiryRow(page, ENQUIRIES.declined)).toContainText('Declined');
  });

  test('empty', async ({ page, asUser, db }) => {
    await emptyEnquiries(db.name);
    await openEnquiries(page, asUser);
    await expect(page.locator('main [data-pattern-state="empty"]')).toBeVisible();
  });

  test('new enquiry dialog', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.locator('[data-slot="new-enquiry"]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('new enquiry dialog with a validation error', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.locator('[data-slot="new-enquiry"]').first().click();
    await page.getByRole('button', { name: 'Save enquiry' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('conflict panel, not yet run', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await enquiryRow(page, ENQUIRIES.logged).getByRole('button', { name: 'Review' }).click();
    await expect(page.locator('[data-slot="conflict-panel"]')).toBeVisible();
  });

  test('conflict panel, after a check', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    const row = enquiryRow(page, ENQUIRIES.logged);
    await row.getByRole('button', { name: 'Review' }).click();
    await row.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(row.getByRole('button', { name: 'Decline' })).toBeVisible();
  });

  test('close enquiry dialog', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await enquiryRow(page, ENQUIRIES.logged).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('loading', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.goto(url(enquiriesPath('__state=loading')));
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
  });

  test('error', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.goto(url(enquiriesPath('__state=error')));
    await expect(page.locator('main [data-pattern-state="error"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('offline', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.goto(url(enquiriesPath('__state=offline')));
    await expect(page.locator('[data-enquiries-offline]')).toBeVisible();
  });

  test('denied', async ({ page, asUser, db }) => {
    await seedEnquiries(db.name);
    await asUser('clerk', { workspace: MATTERS_WORKSPACE, path: enquiriesPath() });
    await expect(page.getByText(/permission/i).first()).toBeVisible();
  });
});
