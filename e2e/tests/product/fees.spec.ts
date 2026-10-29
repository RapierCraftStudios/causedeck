// Fees and invoices journeys (#872, part 5 of #83) on `/w/chennai-solo/invoices`: the flag is on
// and fictional records are seeded (a proposed fee agreement, a draft invoice, a final invoice and
// the client's ledger). Covers the list, creating an agreement, drafting, previewing and marking
// an invoice final, the owner's acknowledgement of unreviewed GST, the permission split and the
// shortcuts of #871 (`n` starts an invoice, Cmd/Ctrl+S saves the draft, Cmd/Ctrl+Enter marks it
// final or saves the agreement dialog). The `@a11y` test ends on the state it names, so axe (zero
// serious or critical) runs on it in the light and dark projects. Visual baselines are in
// fees.visual.spec.ts. Runs in CI only.
import { expect as baseExpect, test } from '../../fixtures/index.ts';
import { FEES } from '../../fixtures/fees-data.ts';

import { agreementCards, emptyTitle, invoiceRows, openFees, route } from './fees-helpers.ts';

// A client navigation renders a dynamic route and a server action writes to Postgres.
const expect = baseExpect.configure({ timeout: 15_000 });

const UUID_PATH = /\/invoices\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMBER = /^FE\/\d{2}-\d{2}\/\d{6}$/;

test.describe('fees and invoices', () => {
  test.describe.configure({ timeout: 90_000 });

  test(
    'lists the agreement, the draft and the final invoice',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openFees(page, asUser, db.name);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Fees and invoices' }),
      ).toBeVisible();
      await expect(route(page).locator('[data-slot="fees-gated-notice"]')).toBeVisible();

      const agreements = page.getByRole('list', { name: 'Fee agreements' });
      await expect(agreements).toBeVisible();
      await expect(agreementCards(page)).toHaveCount(1);
      const card = agreementCards(page).first();
      await expect(card).toContainText('Proposed');
      await expect(card).toContainText('Fixed fee');
      await expect(card).toContainText(/1,?23,?456\.00/);
      await expect(card).toContainText('A proposal: nothing is agreed until you activate it.');

      const invoices = page.getByRole('list', { name: 'Invoices' });
      await expect(invoices).toBeVisible();
      await expect(invoiceRows(page)).toHaveCount(2);
      const draft = invoiceRows(page).filter({ hasText: 'Draft' });
      await expect(draft.locator('[data-status="draft"]')).toHaveText('Draft');
      const final = invoiceRows(page).filter({ hasText: FEES.issued.number });
      await expect(final.locator('[data-status="issued"]')).toHaveText('Final');
      await expect(final).toContainText(/11,800\.00/);
    },
  );

  test('shows the empty states when nothing is seeded', async ({ page, asUser, db }) => {
    await openFees(page, asUser, db.name, { agreement: false, draft: false, issued: false });
    await expect(emptyTitle(page, 'No fee agreements yet')).toBeVisible();
    await expect(emptyTitle(page, 'No invoices yet')).toBeVisible();
  });

  test('activates a proposed agreement', async ({ page, asUser, db }) => {
    await openFees(page, asUser, db.name);
    const card = agreementCards(page).first();
    await card.getByRole('button', { name: 'Activate' }).click();
    await expect(card).toContainText('Active');
    await expect(card.getByRole('button', { name: 'End agreement' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Activate' })).toHaveCount(0);
  });

  test('creates a fee agreement from the dialog', async ({ page, asUser, db }) => {
    await openFees(page, asUser, db.name, { agreement: false });
    await expect(agreementCards(page)).toHaveCount(0);
    await page
      .getByRole('button', { name: 'New fee agreement' })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'New fee agreement' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: /^Matter ID/ }).selectOption(FEES.matter.id);
    await dialog.getByRole('combobox', { name: /^Client ID/ }).selectOption(FEES.client.id);
    await dialog.getByLabel('Amount (rupees)').fill('25000.00');
    await dialog.getByLabel('Starts on').fill('2026-06-01');
    await dialog.getByRole('button', { name: 'Save agreement' }).click();
    await expect(dialog).toBeHidden();
    await expect(agreementCards(page)).toHaveCount(1);
    await expect(agreementCards(page).first()).toContainText('Proposed');
    await expect(agreementCards(page).first()).toContainText(/25,000\.00/);
  });

  test('prepares a draft invoice, previews it and marks it final', async ({ page, asUser, db }) => {
    await openFees(page, asUser, db.name, {
      agreement: false,
      draft: false,
      issued: false,
      path: 'invoices/new',
    });
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible();
    const form = page.getByRole('form', { name: 'New invoice' });
    await form.getByRole('combobox', { name: /^Matter ID/ }).selectOption(FEES.matter.id);
    await form.getByRole('combobox', { name: /^Client ID/ }).selectOption(FEES.client.id);
    await form.getByLabel('Your state code').fill(FEES.stateCode);
    await form.getByLabel('Place of supply').fill(FEES.stateCode);
    await form.getByLabel('Description').fill('Appearance, fictional matter');
    await form.getByLabel('Unit price (rupees)').fill('5000.00');

    await expect(page.getByText('Press Preview to price the lines.')).toBeVisible();
    await form.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByRole('article', { name: 'Invoice preview' });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Taxable value');
    await expect(preview).toContainText(/5,000\.00/);

    // GST is unreviewed here: the owner must acknowledge before the invoice can be final.
    await expect(preview.locator('[data-slot="fees-gst-banner"]')).toContainText(
      'GST treatment not yet counsel-reviewed',
    );
    const issue = form.getByRole('button', { name: 'Mark final' });
    await expect(issue).toBeDisabled();
    await form.getByRole('checkbox', { name: /I acknowledge the GST rates/ }).check();
    await expect(issue).toBeEnabled();
    await issue.click();

    await expect(page).toHaveURL(UUID_PATH);
    await expect(page.locator('main h1').filter({ visible: true })).toHaveText(NUMBER);
    await expect(page.getByText('This invoice is final.')).toBeVisible();
    await expect(page.locator('[data-slot="ledger"]').filter({ visible: true })).toContainText(
      /The client owes/,
    );
  });

  test(
    'an advocate cannot mark an invoice final while GST is unreviewed',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openFees(page, asUser, db.name, {
        role: 'advocate',
        path: `invoices/${FEES.draft.id}`,
      });
      const form = page.getByRole('form', { name: 'Draft invoice' });
      await form.getByLabel('Your state code').fill(FEES.stateCode);
      await form.getByRole('button', { name: 'Preview' }).click();
      await expect(
        form.getByText('Only an owner can mark an invoice final while GST is unreviewed.'),
      ).toBeVisible();
      await expect(form.getByRole('checkbox')).toHaveCount(0);
      await expect(form.getByRole('button', { name: 'Mark final' })).toBeDisabled();
    },
  );

  test('opens a final invoice read-only with the client ledger', async ({ page, asUser, db }) => {
    await openFees(page, asUser, db.name, { path: `invoices/${FEES.issued.id}` });
    await expect(page.locator('main h1').filter({ visible: true })).toHaveText(FEES.issued.number);
    await expect(page.getByText('A correction is a credit note, not an edit.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark final' })).toHaveCount(0);
    const ledger = page.getByRole('table', { name: 'Ledger entries' }).filter({ visible: true });
    await expect(ledger.getByRole('row')).toHaveCount(3);
    await expect(ledger).toContainText(FEES.ledger.receiptNote);
    await expect(page.locator('[data-slot="ledger-balance"]').filter({ visible: true })).toHaveText(
      /The client owes .*6,800\.00/,
    );
  });

  test('a viewer cannot open the page', async ({ page, asUser, db }) => {
    await openFees(page, asUser, db.name, { role: 'viewer' });
    await expect(page.locator('[data-route="invoices"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'New invoice' })).toHaveCount(0);
  });

  test.describe('keyboard', () => {
    test('n starts a new invoice', async ({ page, asUser, db }) => {
      await openFees(page, asUser, db.name);
      // The hotkey listener attaches when the list hydrates, which can trail <main>: retry the key.
      await expect(async () => {
        await page.keyboard.press('n');
        await expect(page).toHaveURL(/\/invoices\/new$/, { timeout: 1_000 });
      }).toPass();
      await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible();
    });

    test('n is ignored while the agreement dialog is open', async ({ page, asUser, db }) => {
      await openFees(page, asUser, db.name);
      await page
        .getByRole('button', { name: 'New fee agreement' })
        .filter({ visible: true })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'New fee agreement' });
      await expect(dialog).toBeVisible();
      const matter = dialog.getByLabel('Amount (rupees)');
      await matter.click();
      await page.keyboard.type('nn');
      await expect(matter).toHaveValue('nn');
      await expect(page).toHaveURL(/\/invoices$/);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('Cmd/Ctrl+Enter saves the agreement dialog', async ({ page, asUser, db }) => {
      await openFees(page, asUser, db.name, { agreement: false });
      await page
        .getByRole('button', { name: 'New fee agreement' })
        .filter({ visible: true })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'New fee agreement' });
      await dialog.getByRole('combobox', { name: /^Matter ID/ }).selectOption(FEES.matter.id);
      await dialog.getByRole('combobox', { name: /^Client ID/ }).selectOption(FEES.client.id);
      await dialog.getByLabel('Amount (rupees)').fill('9000');
      await dialog.getByLabel('Starts on').fill('2026-06-01');
      await expect(async () => {
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(dialog).toBeHidden({ timeout: 2_000 });
      }).toPass();
      await expect(agreementCards(page)).toHaveCount(1);
    });

    test('Cmd/Ctrl+S saves a new draft', async ({ page, asUser, db }) => {
      await openFees(page, asUser, db.name, {
        agreement: false,
        draft: false,
        issued: false,
        path: 'invoices/new',
      });
      const form = page.getByRole('form', { name: 'New invoice' });
      await form.getByRole('combobox', { name: /^Matter ID/ }).selectOption(FEES.matter.id);
      await form.getByRole('combobox', { name: /^Client ID/ }).selectOption(FEES.client.id);
      await form.getByLabel('Your state code').fill(FEES.stateCode);
      await form.getByLabel('Place of supply').fill(FEES.stateCode);
      await form.getByLabel('Description').fill('Advice, fictional matter');
      await form.getByLabel('Unit price (rupees)').fill('1000.00');
      await expect(async () => {
        await page.keyboard.press('ControlOrMeta+s');
        await expect(page).toHaveURL(UUID_PATH, { timeout: 2_000 });
      }).toPass();
      await expect(page.getByRole('heading', { level: 1, name: 'Draft invoice' })).toBeVisible();
    });

    test('Cmd/Ctrl+Enter marks a previewed, acknowledged draft final', async ({
      page,
      asUser,
      db,
    }) => {
      await openFees(page, asUser, db.name, { path: `invoices/${FEES.draft.id}` });
      const form = page.getByRole('form', { name: 'Draft invoice' });
      await form.getByLabel('Your state code').fill(FEES.stateCode);
      await form.getByRole('button', { name: 'Preview' }).click();
      await form.getByRole('checkbox', { name: /I acknowledge the GST rates/ }).check();
      await expect(form.getByRole('button', { name: 'Mark final' })).toBeEnabled();
      await expect(async () => {
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(page.getByText('This invoice is final.')).toBeVisible({ timeout: 3_000 });
      }).toPass();
      await expect(page.locator('main h1').filter({ visible: true })).toHaveText(NUMBER);
    });
  });
});
