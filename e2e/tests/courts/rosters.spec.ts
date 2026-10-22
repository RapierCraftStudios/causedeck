// Bench roster journeys (#437, part 4 of #391; pages #435, #436). The template carries
// `chennai-solo`'s rosters for its own Chennai Fictional Sessions Court (fixtures/courts-data.ts):
// version 1 (superseded) and version 2 (active, hall 5 moved bench), and two open bench-change
// alerts on seeded matters. Covers the list (versions, status, the roster in force, halls, who may
// import, the alert banner), its five states, and the import review of fixtures/roster-pdf.ts:
// the editable grid, the required effective date, the confidence warning, the keyboard model and
// the confirm that supersedes version 2.
import { expect, test } from '../../fixtures/index.ts';
import {
  ACTIVE_ROSTER,
  BENCH_ALERTS,
  CHANGED_HALL,
  COURTS_WORKSPACE,
  ROSTER_BENCHES,
  ROSTER_FORUM,
  ROSTERS,
  benchLabel,
} from '../../fixtures/courts-data.ts';
import {
  ROSTER_PDF_EFFECTIVE_FROM,
  ROSTER_PDF_EXPECTED,
  ROSTER_PDF_LOW_HALL,
} from '../../fixtures/roster-pdf.ts';

import {
  emptyRosters,
  expectNoRosterRatingCopy,
  openCourts,
  rosterImportPath,
  rostersPath,
  uploadRosterPdf,
} from './helpers.ts';

const url = (path: string) => `/w/${COURTS_WORKSPACE}/${path}`;
/** A seeded bench's label, by id. */
function labelOf(benchId: string): string {
  const bench = Object.values(ROSTER_BENCHES).find((b) => b.id === benchId);
  if (bench === undefined) throw new Error(`no seeded bench ${benchId}`);
  return benchLabel(bench);
}

const LOW_INDEX = ROSTER_PDF_EXPECTED.findIndex((c) => c.hallNo === ROSTER_PDF_LOW_HALL);

test.describe('rosters list', () => {
  test('lists the forum’s versions with dates and status, the one in force and its halls', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rostersPath() });
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
      'Bench rosters',
    );
    const panel = page.locator(`[data-roster-forum-panel="${ROSTER_FORUM.code}"]`);
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-slot="roster-forum-picker"]')).toContainText(
      ROSTER_FORUM.court,
    );

    await expect(panel.locator('[data-roster]')).toHaveCount(ROSTERS.length);
    for (const roster of ROSTERS) {
      const card = panel.locator(`[data-roster="${roster.id}"]`);
      await expect(card.locator('[data-roster-status]')).toHaveAttribute(
        'data-roster-status',
        roster.status,
      );
      await expect(card.locator(`time[datetime="${roster.effectiveFrom}"]`)).toBeVisible();
      await expect(card).toContainText(`Version ${String(roster.version)}`);
      await expect(card.locator('[data-roster-entries]')).toHaveText(
        `${String(roster.entries.length)} halls`,
      );
    }
    // Version 2 is the roster in force today; version 1 ended on 2 March.
    await expect(panel.locator('[data-roster-active-today]')).toHaveCount(1);
    await expect(
      panel.locator(`[data-roster="${ACTIVE_ROSTER.id}"] [data-roster-active-today]`),
    ).toHaveText('Active today');
    await expect(panel.locator(`[data-roster="${ACTIVE_ROSTER.id}"]`)).toContainText(
      'until replaced',
    );

    const halls = panel.locator('[data-slot="roster-halls"] [data-roster-hall]');
    await expect(halls).toHaveCount(ACTIVE_ROSTER.entries.length);
    await expect(panel.locator(`[data-roster-hall="${CHANGED_HALL}"]`)).toContainText(
      benchLabel(ROSTER_BENCHES.kurinji),
    );
    await expectNoRosterRatingCopy(page);
  });

  test('an unknown ?forum= falls back to the first forum with rosters', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rostersPath('in.example.not-a-forum') });
    await expect(page.locator(`[data-roster-forum-panel="${ROSTER_FORUM.code}"]`)).toBeVisible();
  });

  for (const [role, canImport] of [
    ['owner', true],
    ['advocate', true],
    ['clerk', false],
    ['viewer', false],
  ] as const) {
    test(`${role} ${canImport ? 'can' : 'cannot'} import a roster`, async ({ page, asUser }) => {
      await openCourts(page, asUser, { role, path: rostersPath(ROSTER_FORUM.code) });
      await expect(page.locator('[data-roster]').first()).toBeVisible();
      const importLink = page.locator('a[data-roster-import]');
      if (canImport) {
        await expect(importLink).toHaveText('Import roster');
        await expect(importLink).toHaveAttribute('href', url(rosterImportPath(ROSTER_FORUM.code)));
        await expect(page.locator('[data-rosters-read-only]')).toHaveCount(0);
      } else {
        await expect(importLink).toHaveCount(0);
        await expect(page.locator('[data-rosters-read-only]')).toHaveText(
          'Only owners and advocates can import rosters.',
        );
      }
    });
  }

  test('a clerk opening the import review directly gets No access', async ({ page, asUser }) => {
    await openCourts(page, asUser, { role: 'clerk' });
    await page.goto(url(rosterImportPath(ROSTER_FORUM.code)));
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
    await expect(page.locator('[data-roster-import]')).toHaveCount(0);
  });

  test('the alert banner lists each bench change with a link to its matter', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rostersPath(ROSTER_FORUM.code) });
    const banner = page.locator('[data-slot="bench-change-banner"]');
    await expect(banner.getByRole('heading', { level: 2 })).toHaveText('Bench changes');
    await expect(banner.locator('[data-bench-change]')).toHaveCount(BENCH_ALERTS.length);
    for (const alert of BENCH_ALERTS) {
      const item = banner.locator(`[data-bench-change="${alert.id}"]`);
      const link = item.locator('[data-bench-change-matter]');
      await expect(link).toHaveText(alert.matterTitle);
      await expect(link).toHaveAttribute('href', url(`matters/${alert.matterId}`));
      await expect(item).toContainText('Bench changed from 02 Mar');
      await expect(item).toContainText(`now sits with ${labelOf(alert.newBenchId)}.`);
      await expect(item).toContainText(
        alert.oldBenchId === null
          ? 'No bench was recorded for it before.'
          : `Previously ${labelOf(alert.oldBenchId)}.`,
      );
    }
  });
});

test.describe('rosters states', () => {
  test('empty: no roster imported yet, import still offered', async ({ page, asUser, db }) => {
    await emptyRosters(db.name);
    await openCourts(page, asUser, { path: rostersPath() });
    const empty = page.locator('main [data-pattern-state="empty"]');
    await expect(empty).toContainText('No roster imported yet.');
    await expect(empty).toContainText(
      "Share the court's sitting arrangements PDF to be told when your bench changes.",
    );
    await expect(page.locator('[data-roster]')).toHaveCount(0);
    await expect(page.locator('a[data-roster-import]')).toHaveAttribute(
      'href',
      url(rosterImportPath()),
    );
  });

  test('loading: the roster skeleton', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url(`${rostersPath()}?__state=loading`));
    await expect(page.locator('main [data-slot="rosters-skeleton"]')).toBeVisible();
    await expect(page.locator('[data-roster]')).toHaveCount(0);
  });

  test('error: Could not load rosters, with Try again', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url(`${rostersPath()}?__state=error`));
    const main = page.locator('main');
    await expect(main.getByText('Could not load rosters.')).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('offline: saved information stays readable, import is disabled', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rostersPath(ROSTER_FORUM.code) });
    const banner = page.locator('main [data-courts-offline]');
    await expect(banner).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(banner).toContainText('Showing saved court information from');
    const offline = page.locator('[data-roster-import="offline"]');
    await expect(offline).toContainText('Importing a roster needs a connection.');
    await expect(offline.getByRole('button', { name: 'Import roster' })).toBeDisabled();
    await expect(page.locator('a[data-roster-import]')).toHaveCount(0);
    await expect(page.locator(`[data-roster="${ACTIVE_ROSTER.id}"]`)).toBeVisible();
    await page.context().setOffline(false);
    await expect(banner).toHaveCount(0);
    await expect(page.locator('a[data-roster-import]')).toBeVisible();
  });

  test('permission-denied: No access', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url(`${rostersPath()}?__state=denied`));
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
    await expect(main).toContainText('You do not have access to this area.');
    await expect(page.locator('[data-roster]')).toHaveCount(0);
  });
});

test.describe('roster import review', () => {
  test('the uploaded PDF fills an editable grid with the date read from it', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await expect(page.locator(`[data-roster-import-forum="${ROSTER_FORUM.code}"]`)).toContainText(
      ROSTER_FORUM.court,
    );
    await uploadRosterPdf(page);

    const rows = page.locator('[data-roster-import-grid] [data-roster-import-row]');
    await expect(rows).toHaveCount(ROSTER_PDF_EXPECTED.length);
    for (const candidate of ROSTER_PDF_EXPECTED) {
      const row = page.locator(`[data-roster-import-row="${candidate.hallNo}"]`);
      for (const judge of candidate.judges) await expect(row).toContainText(judge);
      if (candidate.portfolioText !== '') await expect(row).toContainText(candidate.portfolioText);
    }
    await expect(page.getByLabel('Effective from')).toHaveValue(ROSTER_PDF_EFFECTIVE_FROM);
    await expect(page.locator('[data-roster-import-summary]')).toContainText(
      `${String(ROSTER_PDF_EXPECTED.length)} halls`,
    );
    await expectNoRosterRatingCopy(page);
  });

  test('a row read below 0.6 confidence is flagged in text, not colour alone', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    const lowCount = ROSTER_PDF_EXPECTED.filter((c) => c.confidence < 0.6).length;
    expect(lowCount).toBe(1);
    await expect(page.locator('[data-roster-import-low]')).toHaveAttribute(
      'data-roster-import-low',
      String(lowCount),
    );
    await expect(page.locator('[data-roster-import-low]')).toHaveText('1 row to check');
    await expect(page.locator('[data-low-confidence]')).toHaveCount(1);
    const low = page.locator(`[data-roster-import-row="${ROSTER_PDF_LOW_HALL}"]`);
    await expect(low).toHaveAttribute('data-low-confidence', '');
    await expect(low).toContainText('Check this row');
    await expect(page.locator('[data-roster-import-row="2"]')).toContainText('Read clearly');
  });

  test('the effective date is required before confirming', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    const date = page.getByLabel('Effective from');
    await date.fill('');
    await page.locator('[data-roster-import-confirm]').click();
    await expect(page.locator('[data-roster-import-error]')).toHaveText(
      'Enter the date this roster takes effect.',
    );
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(date).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a row without judges blocks confirm and points at the cell', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    await page.locator('[data-roster-import-confirm]').click();
    await expect(page.locator('[data-roster-import-error]')).toHaveText(
      'Fix the marked rows before you confirm.',
    );
    await expect(page.locator(`[data-cell="${String(LOW_INDEX)}-1"]`)).toBeFocused();
    await expect(page.locator(`[data-roster-import-row="${ROSTER_PDF_LOW_HALL}"]`)).toContainText(
      'Enter at least one judge.',
    );
  });

  test('keyboard: arrows move, Enter edits and is announced, Escape cancels, Cmd/Ctrl+Enter confirms', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    const grid = page.locator('[data-roster-import-grid]');
    const cell = (row: number, col: number) =>
      grid.locator(`[data-cell="${String(row)}-${String(col)}"]`);

    // One tab stop: the first cell.
    await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
    await cell(0, 0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(cell(0, 1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cell(0, 0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < LOW_INDEX; i += 1) await page.keyboard.press('ArrowDown');
    await expect(cell(LOW_INDEX, 1)).toBeFocused();
    await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);

    // Escape cancels an edit and keeps the cell as it was.
    const editor = page.getByLabel(`Edit Judges for hall ${ROSTER_PDF_LOW_HALL}`);
    await page.keyboard.press('Enter');
    await expect(editor).toBeFocused();
    await page.keyboard.type('Justice Q. DISCARDED (fictional)');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(cell(LOW_INDEX, 1)).toBeFocused();
    await expect(grid).not.toContainText('DISCARDED');

    // Enter edits, Enter commits; the live region reads the change.
    await page.keyboard.press('Enter');
    await expect(editor).toBeFocused();
    await page.keyboard.type('Justice P. MULLAI (fictional)');
    await page.keyboard.press('Enter');
    await expect(cell(LOW_INDEX, 1)).toBeFocused();
    await expect(cell(LOW_INDEX, 1)).toContainText('Justice P. MULLAI (fictional)');
    await expect(page.locator('[data-roster-import-announce]')).toHaveText(
      `Judges for hall ${ROSTER_PDF_LOW_HALL} changed to Justice P. MULLAI (fictional).`,
    );

    // Cmd/Ctrl+Enter confirms; the forum has an active roster, so the supersede dialog asks first.
    await page.keyboard.press('ControlOrMeta+Enter');
    const dialog = page.getByRole('dialog', { name: 'Replace the current roster?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace and confirm' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/courts/rosters\\?forum=${ROSTER_FORUM.code.replaceAll('.', '\\.')}$`),
    );
    const panel = page.locator(`[data-roster-forum-panel="${ROSTER_FORUM.code}"]`);
    await expect(panel.locator('[data-roster]')).toHaveCount(ROSTERS.length + 1);
    const confirmed = panel
      .locator('[data-roster]')
      .filter({ has: page.locator(`time[datetime="${ROSTER_PDF_EFFECTIVE_FROM}"]`) });
    await expect(confirmed.locator('[data-roster-status]')).toHaveText('Active');
    await expect(confirmed).toContainText(`Version ${String(ROSTERS.length + 1)}`);
    await expect(confirmed.locator('[data-roster-entries]')).toHaveText(
      `${String(ROSTER_PDF_EXPECTED.length)} halls`,
    );
    // Version 2 now ends where the new version starts.
    await expect(
      panel.locator(`[data-roster="${ACTIVE_ROSTER.id}"] [data-roster-status]`),
    ).toHaveText('Superseded');
  });

  test('Keep reviewing closes the supersede dialog without saving', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    await uploadRosterPdf(page);
    // Drop the judgeless row so the roster can be confirmed as read.
    await page.getByRole('button', { name: `Remove hall ${ROSTER_PDF_LOW_HALL}` }).click();
    await expect(page.locator('[data-roster-import-announce]')).toHaveText(
      `Hall ${ROSTER_PDF_LOW_HALL} removed.`,
    );
    await page.locator('[data-roster-import-confirm]').click();
    const dialog = page.getByRole('dialog', { name: 'Replace the current roster?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep reviewing' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-roster-import-grid]')).toBeVisible();
    await expect(page).toHaveURL(/\/courts\/rosters\/import/);
  });

  test('loading, error and permission-denied states of the import page', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser);
    const base = url(rosterImportPath(ROSTER_FORUM.code));
    await page.goto(`${base}&__state=loading`);
    await expect(page.locator('main [data-slot="rosters-skeleton"]')).toBeVisible();
    await page.goto(`${base}&__state=denied`);
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
    await page.goto(`${base}&__state=error`);
    await expect(page.locator('main').getByText('Could not load rosters.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('offline: the upload is disabled with a note', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: rosterImportPath(ROSTER_FORUM.code) });
    const input = page.locator('[data-roster-import="upload"] input[type="file"]');
    await expect(input).toBeEnabled();
    await page.context().setOffline(true);
    await expect(input).toBeDisabled();
    await expect(page.locator('[data-roster-import="upload"]')).toContainText(
      'Importing a roster needs a connection.',
    );
    await page.context().setOffline(false);
    await expect(input).toBeEnabled();
  });
});
