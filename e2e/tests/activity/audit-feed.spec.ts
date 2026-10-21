// Activity security and audit tab (#232, #26 part 6): `/w/<slug>/activity` shows owners (and
// advocates, by default) the workspace audit log as cards on phones and a table from 768 px, with
// the owner-only IP column, outcome badges and the denied tint; filters persist in the URL; J/K move
// rows, Enter opens the detail drawer (metadata and chain status), E opens the export dialog, whose
// download is a CSV attachment. Juniors, clerks and viewers get the permission-denied copy. `@a11y`
// tests also run axe (zero serious or critical violations) on the page they end on; `@visual` tests
// compare baselines per viewport x theme project (light and dark at 360, 768 and 1280).
import { existsSync } from 'node:fs';

import type { Locator, Page, TestInfo } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { e2eUser, expect, test, type E2eRole } from '../../fixtures/index.ts';
import { layoutOf, shellReady } from '../shell/helpers.ts';

import { seedAudit } from './audit-data.ts';

const OWNER = e2eUser('owner').name;
const JUNIOR = e2eUser('junior').name;
const CLERK = e2eUser('clerk').name;

const ROLE_CHANGED = `${OWNER} changed ${CLERK}'s role to Clerk`;
const EXPORT_DENIED = `${JUNIOR} exported the audit log`;
const PURGE_FAILED = 'CauseDeck purged audit events past the retention window';

async function openActivity(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `activity${query}` });
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await shellReady(page);
}

/** The event rows for this viewport: cards on phones, table rows from 768 px. */
function eventRows(page: Page): Locator {
  return layoutOf(page) === 'phone'
    ? page.locator('[data-slot="data-table-card"]')
    : page.getByRole('table', { name: 'Security events' }).locator('tbody tr');
}

test.describe('activity security and audit tab', () => {
  test(
    'owner sees events with outcomes, the denied tint and IPs',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedAudit(db.name, 'chennai-solo');
      await openActivity(page, asUser);

      await expect(page.getByRole('link', { name: 'Security and audit' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      const rows = eventRows(page);
      await expect(rows).toHaveCount(3);
      // Newest first.
      await expect(rows.nth(0)).toContainText(PURGE_FAILED);
      await expect(rows.nth(0)).toContainText('Failed');
      await expect(rows.nth(1)).toContainText(EXPORT_DENIED);
      await expect(rows.nth(1)).toContainText('Denied');
      await expect(rows.nth(1)).toHaveClass(/bg-warning-soft/);
      await expect(rows.nth(2)).toContainText(ROLE_CHANGED);
      await expect(rows.nth(2)).toContainText('Allowed');
      if (layoutOf(page) !== 'phone') {
        await expect(page.getByRole('columnheader', { name: 'IP' })).toBeVisible();
        await expect(rows.nth(2)).toContainText('203.0.113.0/24');
      }
    },
  );

  test('advocates see the log without IPs', async ({ page, asUser, db }) => {
    test.skip(layoutOf(page) === 'phone', 'the IP column is a table column');
    await seedAudit(db.name, 'chennai-solo');
    await openActivity(page, asUser, 'advocate');
    await expect(eventRows(page)).toHaveCount(3);
    await expect(page.getByRole('columnheader', { name: 'IP' })).toHaveCount(0);
  });

  for (const role of ['junior', 'clerk', 'viewer'] as const) {
    test(
      `${role} gets the permission-denied state`,
      { tag: '@a11y' },
      async ({ page, asUser, db }) => {
        await seedAudit(db.name, 'chennai-solo');
        await openActivity(page, asUser, role);
        await expect(
          page.getByText('Only owners and advocates can view the audit log.'),
        ).toBeVisible();
        await expect(eventRows(page)).toHaveCount(0);
      },
    );
  }

  test(
    'shows the empty state for a period without events',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedAudit(db.name, 'chennai-solo');
      await openActivity(page, asUser, 'owner', '?from=2020-01-01&to=2020-01-31');
      await expect(page.getByText('No security events in this period.')).toBeVisible();
    },
  );

  test('filters persist in the URL across a reload', async ({ page, asUser, db }) => {
    await seedAudit(db.name, 'chennai-solo');
    await openActivity(page, asUser);

    const actionChip = page.locator('[data-slot="audit-filter-chip"]').nth(2);
    await expect(actionChip).toHaveAttribute('aria-expanded', 'false');
    await actionChip.click();
    await expect(actionChip).toHaveAttribute('aria-expanded', 'true');
    const sheet = page.getByRole('dialog', { name: 'Action' });
    await sheet.getByRole('combobox', { name: 'Action' }).click();
    await page.getByRole('option', { name: 'Members' }).click();
    await sheet.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/[?&]action=member\b/);
    await expect(eventRows(page)).toHaveCount(1);
    await expect(eventRows(page).first()).toContainText(ROLE_CHANGED);

    await page.reload();
    await expect(eventRows(page)).toHaveCount(1);
    await expect(actionChip).toContainText('Members');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/action=/);
    await expect(eventRows(page)).toHaveCount(3);
  });

  test(
    'J/K move rows and Enter opens the drawer with metadata and chain status',
    {
      tag: '@a11y',
    },
    async ({ page, asUser, db, a11y }) => {
      test.skip(layoutOf(page) === 'phone', 'keyboard row navigation is for the table layouts');
      await seedAudit(db.name, 'chennai-solo');
      await openActivity(page, asUser);
      const rows = eventRows(page);
      await expect(rows.nth(0)).toHaveAttribute('tabindex', '0');

      await page.keyboard.press('j');
      await page.keyboard.press('j');
      await expect(rows.nth(2)).toHaveAttribute('tabindex', '0');
      await expect(rows.nth(2)).toBeFocused();
      await page.keyboard.press('k');
      await page.keyboard.press('j');
      await page.keyboard.press('Enter');

      const drawer = page.getByRole('dialog', { name: 'Event details' });
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(ROLE_CHANGED);
      await expect(drawer.locator('pre')).toContainText('"role": "clerk"');
      // axe with the drawer open (the @a11y after-each checks the page once it closes).
      await a11y.expectNoViolations(page);
      await expect(drawer.getByText('Verified', { exact: true })).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(rows.nth(2)).toBeFocused();
    },
  );

  test(
    'on phones a card opens the drawer as a bottom sheet',
    { tag: '@a11y' },
    async ({ page, asUser, db, a11y }) => {
      test.skip(layoutOf(page) !== 'phone', 'cards are the phone layout');
      await seedAudit(db.name, 'chennai-solo');
      await openActivity(page, asUser);
      const card = eventRows(page).nth(1);
      await expect(card).toHaveClass(/bg-warning-soft/);
      await card.getByRole('button', { name: 'Event details' }).click();
      const drawer = page.getByRole('dialog', { name: 'Event details' });
      await expect(drawer).toHaveAttribute('data-side', 'bottom');
      await expect(drawer).toContainText(EXPORT_DENIED);
      await a11y.expectNoViolations(page);
      await page.keyboard.press('Escape');
      await expect(card.getByRole('button', { name: 'Event details' })).toBeFocused();
    },
  );

  test('E opens the export dialog and the download is a CSV attachment', async ({
    page,
    asUser,
    db,
    a11y,
  }) => {
    await seedAudit(db.name, 'chennai-solo');
    await openActivity(page, asUser);

    await page.locator('body').press('e');
    const dialog = page.getByRole('dialog', { name: 'Export the audit log' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Format' })).toContainText('CSV');
    await a11y.expectNoViolations(page);

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^audit-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('offline keeps the first page read-only', async ({ page, asUser, db }) => {
    await seedAudit(db.name, 'chennai-solo');
    await openActivity(page, asUser);
    await page.context().setOffline(true);
    // The shell's offline banner and the feed's own note about what is paused (both carry the
    // `offline` pattern state, so address each one).
    await expect(page.locator('[data-slot="offline-banner"]')).toBeVisible();
    await expect(page.getByText(/Showing the first page as saved/)).toBeVisible();
    await expect(eventRows(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  test('loading and error states', async ({ page, asUser }) => {
    await openActivity(page, asUser, 'owner', '?__state=error');
    await expect(page.getByText('Could not load activity.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.goto(page.url().replace('__state=error', '__state=loading'));
    // The route's streaming fallback and the previewed loading state can both be on screen for a
    // moment while the page swaps; either is the loading skeleton.
    await expect(page.locator('[data-slot="audit-skeleton"]').first()).toBeVisible();
  });

  test('settings links to the audit log', async ({ page, asUser }) => {
    await asUser('owner', { path: 'settings' });
    await page.getByRole('link', { name: /Audit log/ }).click();
    await expect(page).toHaveURL(/\/w\/chennai-solo\/activity$/);
  });
});

function skipWithoutBaseline(testInfo: TestInfo, name: string) {
  const baseline = testInfo.snapshotPath(name, { kind: 'screenshot' });
  test.skip(
    testInfo.config.updateSnapshots === 'none' && !existsSync(baseline),
    'no baseline yet: dispatch the e2e workflow with update_snapshots',
  );
}

async function snap(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    // Events carry their real insert time.
    mask: [page.locator('[data-slot="audit-feed"] time')],
  });
}

test.describe('activity visual baselines', () => {
  test('activity-feed', { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-feed.png');
    await seedAudit(db.name, 'chennai-solo');
    await openActivity(page, asUser);
    await expect(eventRows(page)).toHaveCount(3);
    await snap(page, 'activity-feed.png');
  });

  test('activity-empty', { tag: '@visual' }, async ({ page, asUser }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-empty.png');
    await openActivity(page, asUser, 'owner', '?from=2020-01-01&to=2020-01-31');
    await expect(page.getByText('No security events in this period.')).toBeVisible();
    await snap(page, 'activity-empty.png');
  });

  test('activity-denied', { tag: '@visual' }, async ({ page, asUser }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-denied.png');
    await openActivity(page, asUser, 'junior');
    await snap(page, 'activity-denied.png');
  });
});
