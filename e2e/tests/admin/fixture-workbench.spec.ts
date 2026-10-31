// The fixture workbench (#516, acceptance R5 deferred to #598): a labeled document becomes a
// redacted fixture with its expected output in under five minutes. Staff paste a document that
// carries a party name and personal data, run the adapter, correct nothing, and build: the bundle
// offered for download must hold neither, and the whole path must stay inside the time budget.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/index.ts';

const BUDGET_MS = 5 * 60 * 1000;
const PARTY = 'Arun Kavitham';
const DOCUMENT =
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../packages/adapters/fixtures/echo/list-01-admission.input.txt',
    ),
    'utf8',
  ) + `\nContact: arun@chambers.in, 9876543210\n`;

test.describe('admin fixture workbench', () => {
  test('turns a labeled document into a redacted fixture in under 5 minutes', async ({
    adminAs,
  }) => {
    const started = Date.now();
    const page = await adminAs('ops');
    await page.goto('/fixtures');
    await expect(page.getByRole('heading', { level: 1, name: 'Fixture workbench' })).toBeVisible();

    await page.getByLabel('Adapter').selectOption('echo');
    await page.getByLabel('Format').selectOption('text');
    await page.getByLabel('Fixture name').fill('list-91-e2e-workbench');
    await page.getByLabel('Document (paste text, or choose a file)').fill(DOCUMENT);
    await page.getByLabel('Other names to replace (one per line)').fill(PARTY);
    await page.getByRole('button', { name: 'Run parser' }).click();

    await expect(page.getByRole('heading', { name: 'Parser output' })).toBeVisible();
    await expect(page.getByText(/^Row 1$/)).toBeVisible();

    await page.getByRole('button', { name: 'Redact and build fixture' }).click();
    await expect(page.getByRole('heading', { name: 'Redacted fixture' })).toBeVisible();
    await expect(page.getByText(/name replacements, .* personal-data replacements/)).toBeVisible();

    const link = page.getByRole('link', { name: /bundle$/ });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) ?? '';
    const bundle = decodeURIComponent(href.replace(/^data:application\/json;charset=utf-8,/, ''));
    expect(bundle).toContain('"expected"');
    expect(bundle).not.toMatch(/Arun Kavitham|arun@chambers|9876543210/i);

    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
  });
});
