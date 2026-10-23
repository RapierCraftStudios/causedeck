// Bench roster accessibility (#437): zero serious or critical axe violations on the rosters list
// and the import review in every viewport and theme project (360/768/1280, light and dark).
// `@a11y`: the fixture runs axe on the page each test ends on (fixtures/index.ts), so each test
// ends on the state it names. The review's table is a `role="grid"` whose committed edits are
// read out by a polite live region.
import { expect, test } from '../../fixtures/index.ts';
import { COURTS_WORKSPACE, ROSTER_FORUM } from '../../fixtures/courts-data.ts';
import { ROSTER_PDF_EXPECTED, ROSTER_PDF_LOW_HALL } from '../../fixtures/roster-pdf.ts';

import {
  emptyRosters,
  openCourts,
  rosterImportPath,
  rostersPath,
  uploadRosterPdf,
} from './helpers.ts';

const url = (path: string) => `/w/${COURTS_WORKSPACE}/${path}`;
const LOW_INDEX = ROSTER_PDF_EXPECTED.findIndex((c) => c.hallNo === ROSTER_PDF_LOW_HALL);

test.describe('rosters accessibility', { tag: '@a11y' }, () => {
  test('list with the bench-change banner', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rostersPath(ROSTER_FORUM.code) });
    await expect(page.locator('[data-slot="bench-change-banner"] [data-bench-change]')).toHaveCount(
      2,
    );
    await expect(page.locator('[data-roster-active-today]')).toBeVisible();
  });

  test('read-only list for a clerk', async ({ page, asUser }) => {
    await openCourts(page, asUser, { role: 'clerk', path: rostersPath(ROSTER_FORUM.code) });
    await expect(page.locator('[data-rosters-read-only]')).toBeVisible();
  });

  test('empty list', async ({ page, asUser, db }) => {
    await emptyRosters(db.name);
    await openCourts(page, asUser, { path: rostersPath() });
    await expect(page.locator('main [data-pattern-state="empty"]')).toBeVisible();
  });

  test('error state', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url(`${rostersPath()}?__state=error`));
    await expect(page.locator('main').getByText('Could not load rosters.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('offline list', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rostersPath(ROSTER_FORUM.code) });
    await page.context().setOffline(true);
    await expect(page.locator('main [data-courts-offline]')).toBeVisible();
    await expect(page.locator('[data-roster-import="offline"]')).toBeVisible();
  });

  test('import upload step', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await expect(page.locator('[data-roster-import="upload"]')).toBeVisible();
  });

  test('import review with a row to check', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    await expect(page.locator('[data-low-confidence]')).toBeVisible();
  });

  test('import review with a cell being edited', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    await page.locator(`[data-cell="${String(LOW_INDEX)}-1"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`Edit Judges for hall ${ROSTER_PDF_LOW_HALL}`)).toBeFocused();
  });

  test('import review with the marked rows and the date missing', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    await page.getByLabel('Effective from').fill('');
    await page.locator('[data-roster-import-confirm]').click();
    await expect(page.locator('[data-roster-import-error]')).toBeVisible();
  });

  test('supersede dialog open', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    await page.getByRole('button', { name: `Remove hall ${ROSTER_PDF_LOW_HALL}` }).click();
    await page.locator('[data-roster-import-confirm]').click();
    await expect(page.getByRole('dialog', { name: 'Replace the current roster?' })).toBeVisible();
  });

  test('the review table has grid semantics and announces cell edits', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    const grid = page.getByRole('grid', { name: 'Parsed roster rows' });
    await expect(grid).toHaveAttribute('aria-rowcount', String(ROSTER_PDF_EXPECTED.length + 1));
    await expect(grid).toHaveAttribute('aria-colcount', '7');
    await expect(grid.getByRole('columnheader')).toHaveCount(7);
    await expect(grid.getByRole('row')).toHaveCount(ROSTER_PDF_EXPECTED.length + 1);
    await expect(grid.getByRole('gridcell')).toHaveCount(ROSTER_PDF_EXPECTED.length * 7);
    await expect(grid.locator('[data-column="confidence"]').first()).toHaveAttribute(
      'aria-readonly',
      'true',
    );

    const live = page.locator('[data-roster-import-announce]');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveText('');
    await page.locator(`[data-cell="${String(LOW_INDEX)}-1"]`).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Justice P. MULLAI (fictional)');
    await page.keyboard.press('Enter');
    await expect(live).toHaveText(
      `Judges for hall ${ROSTER_PDF_LOW_HALL} changed to Justice P. MULLAI (fictional).`,
    );
  });
});
