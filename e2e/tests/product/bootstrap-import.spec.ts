// Bootstrap import journeys (#553, #57 part 7) on `/w/<shell workspace>/import?batch=<id>`: the
// processing view, the confirm grid with a W.P. + W.M.P. group, an appeal chain, a conflict row
// that blocks the confirm and an SR-stage row, the keyboard shortcuts, and the result. The batches
// are seeded (import-helpers.ts: the e2e stack has no job worker). `@a11y` runs axe with zero
// serious violations; the matrix covers 360/768/1280 in light and dark. Fictional data only.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import { IMPORT_PATH, seedBatch, type SeedKind } from './import-helpers.ts';

interface Fixtures {
  page: Page;
  asUser: AsUser;
  db: { name: string };
}

const open = async (kind: SeedKind, { page, asUser, db }: Fixtures) => {
  const batch = await seedBatch(db.name, kind);
  await asUser('owner', { path: `${IMPORT_PATH}?batch=${batch}` });
  await shellReady(page);
};

test.describe('bootstrap import journeys', () => {
  test('a batch being read shows its progress', { tag: '@a11y' }, async (fixtures) => {
    await open('processing', fixtures);
    await expect(fixtures.page.getByText('Reading your files')).toBeVisible();
  });

  test('a failed batch offers a way on, not a blank page', { tag: '@a11y' }, async (fixtures) => {
    await open('failed', fixtures);
    await expect(fixtures.page.getByText('Reading your files')).toBeVisible();
    await expect(fixtures.page.getByText('Your plan is ready.')).toHaveCount(0);
  });

  test('a batch with no match says nothing was recognised', async (fixtures) => {
    await open('nothing', fixtures);
    await expect(fixtures.page.getByText(/^Nothing recognised\./)).toBeVisible();
  });

  test(
    'the grid shows the W.P. + W.M.P. group and the appeal chain',
    { tag: '@a11y' },
    async (fixtures) => {
      const { page } = fixtures;
      await open('grid', fixtures);
      await page.getByRole('button', { name: 'Review the plan' }).click();
      await expect(page.getByRole('heading', { name: 'Confirm what we found' })).toBeVisible();
      await expect(page.getByText('3 of 3 matters included')).toBeVisible();
      await page
        .getByRole('listitem', { name: /Rao v State/ })
        .getByRole('button', { name: 'Show proceedings' })
        .click();
      await expect(page.getByText('W.M.P. 11/2026')).toBeVisible();
      await page
        .getByRole('listitem', { name: /Menon v Menon/ })
        .getByRole('button', { name: 'Show proceedings' })
        .click();
      await expect(page.getByText('S.A. 22/2026')).toBeVisible();
    },
  );

  test('a conflict row blocks the confirm until a date is picked', async (fixtures) => {
    const { page } = fixtures;
    await open('conflict', fixtures);
    await page.getByRole('button', { name: 'Review the plan' }).click();
    const confirm = page.getByRole('button', { name: /^Confirm 2 matters/ });
    await expect(
      page.getByText('Pick a date for each conflicting matter before confirming.'),
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
    await page.getByRole('button', { name: /Use .*17/ }).click();
    await expect(confirm).toBeEnabled();
  });

  test('an SR-stage proceeding is marked unnumbered', async (fixtures) => {
    const { page } = fixtures;
    await open('srStage', fixtures);
    await page.getByRole('button', { name: 'Review the plan' }).click();
    await page
      .getByRole('listitem', { name: /Pending v State/ })
      .getByRole('button', { name: 'Show proceedings' })
      .click();
    await expect(page.getByText('Unnumbered').first()).toBeVisible();
  });

  test('the keyboard journey: arrows, Space, ? and Cmd/Ctrl+Enter', async (fixtures) => {
    const { page } = fixtures;
    await open('grid', fixtures);
    await page.getByRole('button', { name: 'Review the plan' }).click();
    const rows = page.getByRole('listitem', { name: /, row \d of 3$/ });
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press(' ');
    await expect(page.getByText('2 of 3 matters included')).toBeVisible();
    await page.keyboard.press(' ');
    await expect(page.getByText('3 of 3 matters included')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('link', { name: 'Open your first court-day view' })).toBeVisible();
  });

  test(
    'confirming shows the result and its first court-day view',
    { tag: '@a11y' },
    async (fixtures) => {
      const { page } = fixtures;
      await open('appealChain', fixtures);
      await page.getByRole('button', { name: 'Review the plan' }).click();
      await page.getByRole('button', { name: /^Confirm 1 matter/ }).click();
      await expect(page.getByText('Import confirmed')).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Open your first court-day view' }),
      ).toBeVisible();
    },
  );
});
