// Enquiry log product spec (#875, #87 part 3): the flag-on flow (log, check for conflicts, decide,
// close), the flag-off 404 (`enquiry-gated-off`), the denied role, the states (empty, loading,
// error with retry, offline) and the keyboard (n, j, c, Cmd/Ctrl+Enter, Esc). Enquiries are seeded
// per test (enquiries.helpers.ts); the database is reset between tests. Nothing here sends anything
// to an enquirer.
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

test.describe('enquiry log', () => {
  test('enquiry-gated-off: the flag off makes the route a 404 and hides the nav entry', async ({
    page,
    asUser,
  }) => {
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: 'people' });
    const response = await page.goto(url(enquiriesPath()));
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-route="enquiries"]')).toHaveCount(0);
    await page.goto(url('people'));
    await expect(page.locator('nav a[href$="/people/enquiries"]')).toHaveCount(0);
  });

  test('list: every enquiry with status and channel', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await expect(page.locator('[data-enquiry-row]')).toHaveCount(3);
    await expect(enquiryRow(page, ENQUIRIES.logged)).toContainText('Asha Raman');
    await expect(enquiryRow(page, ENQUIRIES.logged)).toContainText('Logged');
    await expect(enquiryRow(page, ENQUIRIES.checked)).toContainText('Email');
    await expect(enquiryRow(page, ENQUIRIES.declined)).toContainText('Declined');
    await expect(page.getByText(/Nothing is sent to the enquirer/)).toBeVisible();
  });

  test('flow: log an enquiry, check for conflicts, decline it, then close another', async ({
    page,
    asUser,
    db,
  }) => {
    await enableEnquiryLog(db.name);
    await emptyEnquiries(db.name);
    await openEnquiries(page, asUser);
    await expect(page.getByText('No enquiries yet')).toBeVisible();

    await page.locator('[data-slot="new-enquiry"]').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-enquiry-field="enquirer"]').fill('Meera Iyer');
    await dialog.locator('[data-enquiry-field="summary"]').fill('Wants a second opinion.');
    await dialog.locator('[data-enquiry-field="adverse"]').fill('Example Estates Pvt Ltd');
    await dialog.getByRole('button', { name: 'Save enquiry' }).click();
    await expect(dialog).toBeHidden();
    const row = page.locator('[data-enquiry-row]').filter({ hasText: 'Meera Iyer' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Review' }).click();
    await row.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(row.locator('[data-conflict-count]')).toBeVisible();
    await row.getByRole('button', { name: 'Decline' }).click();
    await expect(row).toContainText('Declined');
  });

  test('flow: close an enquiry with a reason', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await enquiryRow(page, ENQUIRIES.logged).getByRole('button', { name: 'Close' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-enquiry-field="reason"]').fill('Went elsewhere');
    await dialog.getByRole('button', { name: 'Close enquiry' }).click();
    await expect(dialog).toBeHidden();
    await expect(enquiryRow(page, ENQUIRIES.logged)).toContainText('Closed');
    await expect(enquiryRow(page, ENQUIRIES.logged)).toContainText('Went elsewhere');
  });

  test('flow: the form asks for a name and a summary', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.locator('[data-slot="new-enquiry"]').first().click();
    await page.getByRole('button', { name: 'Save enquiry' }).click();
    await expect(page.getByRole('alert')).toContainText("Add the enquirer's name and a summary.");
  });

  test('states: empty', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await emptyEnquiries(db.name);
    await openEnquiries(page, asUser);
    await expect(page.locator('main [data-pattern-state="empty"]')).toBeVisible();
    await expect(page.getByText('No enquiries yet')).toBeVisible();
  });

  test('states: loading, error with retry and denied', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.goto(url(enquiriesPath('__state=loading')));
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();

    await page.goto(url(enquiriesPath('__state=error')));
    const error = page.locator('main [data-pattern-state="error"]');
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.goto(url(enquiriesPath('__state=denied')));
    await expect(page.getByText(/permission/i).first()).toBeVisible();
  });

  test('states: offline disables New enquiry and shows the banner', async ({
    page,
    asUser,
    db,
  }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);
    await page.context().setOffline(true);
    await expect(page.locator('[data-enquiries-offline]')).toBeVisible();
    await expect(page.locator('[data-slot="new-enquiry"]').first()).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.locator('[data-enquiries-offline]')).toBeHidden();
  });

  test('denied: a clerk sees the permission page, not the log', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await asUser('clerk', { workspace: MATTERS_WORKSPACE, path: enquiriesPath() });
    await expect(page.getByText(/permission/i).first()).toBeVisible();
    await expect(page.locator('[data-enquiry-row]')).toHaveCount(0);
  });

  test('keyboard only: n, Esc, j, Review, c and Cmd/Ctrl+Enter', async ({ page, asUser, db }) => {
    await enableEnquiryLog(db.name);
    await seedEnquiries(db.name);
    await openEnquiries(page, asUser);

    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.keyboard.press('j');
    await expect(enquiryRow(page, ENQUIRIES.logged)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Review' }).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('c');
    await expect(enquiryRow(page, ENQUIRIES.logged).locator('[data-conflict-count]')).toBeVisible();

    await page.keyboard.press('n');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-enquiry-field="enquirer"]').fill('Keyboard Person');
    await dialog.locator('[data-enquiry-field="summary"]').fill('Typed without a mouse.');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();
    await expect(
      page.locator('[data-enquiry-row]').filter({ hasText: 'Keyboard Person' }),
    ).toBeVisible();
  });
});
