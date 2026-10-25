// Automation activity feed (#49): `/w/<slug>/activity` lists what CauseDeck did, newest first and
// grouped by day, with the level, source, matter, confidence and who confirmed; filters live in the
// URL; Undo shows its days left, previews the cascade, undoes through the engine and the item is
// struck through; when the lawyer confirmed the result after the page loaded, the dialog shows the
// engine's reason and offers `Open the matter`; one capture can be undone as a whole; viewers read
// but cannot undo; the keyboard reaches everything (j/k/Enter/u/slash/?). `@a11y` tests run axe
// (zero serious or critical violations) in both themes; `@visual` tests compare baselines per
// viewport x theme project for the feed, the expanded item, the undo dialog with its cascade, the
// empty, error, offline and permission-denied states.
import { existsSync } from 'node:fs';

import type { Locator, Page, TestInfo } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import { activityState, CAPTURE_ID, confirmActivity, seedActivities } from './activity-data.ts';

const TASK = 'Created a task: call the clerk about the certified copy';
const ATTACH = 'Attached order to W.P. 12345 of 2026 · matched by case number';

async function openFeed(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `activity${query}` });
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'What CauseDeck did' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await shellReady(page);
}

const items = (page: Page): Locator => page.locator('[data-slot="activity-item"]');
const row = (page: Page, summary: string): Locator => items(page).filter({ hasText: summary });

test.describe('activity feed', () => {
  test(
    'groups by day with level, source, matter, confidence and an undo countdown',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedActivities(db.name, 'chennai-solo');
      await openFeed(page, asUser);

      await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeVisible();
      await expect(items(page)).toHaveCount(4);
      // Newest first.
      await expect(items(page).nth(0)).toContainText(TASK);
      await expect(items(page).nth(1)).toContainText(ATTACH);

      const task = row(page, TASK);
      await expect(task).toContainText('L3, applied automatically');
      await expect(task).toContainText('Document');
      await expect(task).toContainText('Confidence 93%');
      await expect(task.getByRole('link', { name: /^Matter: / })).toBeVisible();
      await expect(task.getByText(/^Undo available for 6 more days$/)).toBeVisible();
      await expect(page.getByRole('button', { name: `Undo: ${TASK}` })).toBeVisible();
      // The confirmed proposal and the old capture cannot be undone.
      await expect(row(page, 'You confirmed the next date')).not.toContainText('Undo available');
      await expect(row(page, 'Added the matter from the cause list')).toContainText('L1, captured');

      // Model, version and region sit behind the expander.
      await expect(task.getByText('sarvam-m')).toHaveCount(0);
      await task.getByRole('button', { name: 'Show details' }).click();
      await expect(task.getByText('sarvam-m')).toBeVisible();
      await expect(task.getByText('ap-south-1')).toBeVisible();
    },
  );

  test('filters persist in the URL and a preset shows only what was auto-applied', async ({
    page,
    asUser,
    db,
  }) => {
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);

    const toggle = page.getByRole('button', { name: 'Filters' });
    if (await toggle.isVisible()) await toggle.click();
    await page.getByRole('button', { name: 'Auto-applied only' }).click();
    await expect(page).toHaveURL(/[?&]level=L3(&|$)/);
    await expect(items(page)).toHaveCount(2);
    await page.reload();
    await shellReady(page);
    await expect(items(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Auto-applied only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Search over the summaries.
    await page.goto('/w/chennai-solo/activity?q=clerk');
    await expect(items(page)).toHaveCount(1);
    // Filtered-empty state with Clear filters.
    await page.goto('/w/chennai-solo/activity?q=nothing-matches-this');
    await expect(page.getByText('No activity matches these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(page).toHaveURL(/\/w\/chennai-solo\/activity$/);
    await expect(items(page)).toHaveCount(4);
  });

  test('the digest deep link ?day= shows that day', async ({ page, asUser, db }) => {
    await seedActivities(db.name, 'chennai-solo');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await openFeed(page, asUser, 'owner', `?day=${today}`);
    await expect(items(page)).toHaveCount(2);
    await expect(row(page, TASK)).toBeVisible();
  });

  test(
    'undo previews the cascade, undoes through the engine and strikes the item through',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      const seeded = await seedActivities(db.name, 'chennai-solo');
      const task = seeded['task'];
      if (task === undefined) throw new Error('seed missing');
      await openFeed(page, asUser);

      await page.getByRole('button', { name: `Undo: ${TASK}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Undo this change?' });
      await expect(dialog.locator('[data-slot="undo-cascade"] li').first()).toBeVisible();
      await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(dialog).toBeHidden();

      const undone = row(page, TASK);
      await expect(undone).toHaveAttribute('data-undone', '');
      await expect(undone).toContainText(/^.*Undone by .+ at /s);
      await expect(page.getByRole('button', { name: `Undo: ${TASK}` })).toHaveCount(0);
      await expect(page.locator('[data-slot="activity-live"]')).toContainText('1 change undone');
      // The engine removed the task and marked the activity.
      expect(await activityState(db.name, task.id, task.taskId)).toEqual({
        undone: true,
        taskExists: false,
      });
      // Focus is back on the item.
      await expect(undone).toBeFocused();
    },
  );

  test('shows the engine reason and Open the matter when the result was confirmed meanwhile', async ({
    page,
    asUser,
    db,
  }) => {
    const seeded = await seedActivities(db.name, 'chennai-solo');
    const task = seeded['task'];
    if (task === undefined) throw new Error('seed missing');
    await openFeed(page, asUser);
    await confirmActivity(db.name, task.id);

    await page.getByRole('button', { name: `Undo: ${TASK}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('This cannot be undone');
    await expect(dialog).toContainText('confirmed or edited');
    await expect(dialog.getByRole('link', { name: 'Open the matter' })).toHaveAttribute(
      'href',
      /\/w\/chennai-solo\/matters\//,
    );
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect((await activityState(db.name, task.id, task.taskId)).taskExists).toBe(true);
  });

  test('undoes everything from one capture and offers Reassign', async ({ page, asUser, db }) => {
    const seeded = await seedActivities(db.name, 'chennai-solo');
    const task = seeded['task'];
    if (task === undefined) throw new Error('seed missing');
    await openFeed(page, asUser, 'owner', `?capture=${CAPTURE_ID}`);
    await expect(items(page)).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: 'Moved to wrong matter? Reassign' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Undo everything from this capture' }).click();
    const dialog = page.getByRole('dialog', { name: 'Undo everything from this capture?' });
    await expect(dialog.locator('[data-slot="undo-cascade"] li').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Undo everything' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot="activity-live"]')).toContainText('changes undone');
    expect((await activityState(db.name, task.id, task.taskId)).undone).toBe(true);

    // Reassign opens the matter picker.
    await page.getByRole('button', { name: 'Moved to wrong matter? Reassign' }).click();
    const picker = page.getByRole('dialog', { name: 'Move to another matter' });
    await expect(picker.getByRole('button', { name: 'Move' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
  });

  test('a viewer reads the feed but cannot undo', async ({ page, asUser, db }) => {
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser, 'viewer');
    await expect(items(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Undo: / })).toHaveCount(0);
    await expect(page.getByText(/You can read the activity but not undo it/)).toBeVisible();
    await expect(row(page, TASK)).toContainText('View only');
  });

  test('a clerk sees only the kinds a clerk may act on', async ({ page, asUser, db }) => {
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser, 'clerk');
    await expect(row(page, TASK)).toBeVisible();
    await expect(row(page, ATTACH)).toBeVisible();
    await expect(row(page, 'You confirmed the next date')).toHaveCount(0);
  });

  test('keyboard: j/k move, Enter expands, u opens undo, / searches, ? lists the keys', async ({
    page,
    asUser,
    db,
  }) => {
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    await page.keyboard.press('j');
    await expect(items(page).nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(items(page).nth(0)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(items(page).nth(0).locator('[data-slot="activity-details"]')).toBeVisible();

    await page.keyboard.press('u');
    const dialog = page.getByRole('dialog', { name: 'Undo this change?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus returns to the item.
    await expect(items(page).nth(0)).toBeFocused();

    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.getByRole('searchbox').blur();
    await page.keyboard.press('Shift+?');
    await expect(page.getByRole('dialog', { name: 'Activity shortcuts' })).toBeVisible();
  });

  test('empty, error and offline states', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openFeed(page, asUser);
    await expect(
      page.getByText(
        'Nothing has happened yet. Share a cause list or an order and it will show up here.',
      ),
    ).toBeVisible();

    await openFeed(page, asUser, 'owner', '?__state=error');
    await expect(page.getByText('Could not load activity.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('offline keeps the page read-only and says why', async ({ page, asUser, db }) => {
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText('Showing saved activity. Undo needs a connection.')).toBeVisible();
    await expect(page.getByRole('button', { name: `Undo: ${TASK}` })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: `Undo: ${TASK}` })).toBeEnabled();
  });

  test('exports CSV for a range, with the audit fields', async ({ page, asUser, db }) => {
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await page.getByRole('button', { name: 'Export' }).click();
    const link = page.getByRole('link', { name: 'Download CSV' });
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toContain('/api/activity/export?workspaceId=');
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    const text = await response.text();
    expect(text.split('\r\n')[0]).toContain('input_source,model,model_version,region,confidence');
    expect(text).toContain('sarvam-m');
    await expect(page.getByRole('link', { name: 'Download JSON' })).toBeVisible();
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
    // Activities carry their real insert time and countdown.
    mask: [
      page.locator('[data-slot="activity-item"] time'),
      page.locator('[data-slot="undo-countdown"]'),
    ],
  });
}

test.describe('activity feed visual baselines', () => {
  test('activity-feed', { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-feed.png');
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await expect(items(page)).toHaveCount(4);
    await snap(page, 'activity-feed.png');
  });

  test('activity-expanded', { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-expanded.png');
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await row(page, TASK).getByRole('button', { name: 'Show details' }).click();
    await snap(page, 'activity-expanded.png');
  });

  test('activity-undo-dialog', { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-undo-dialog.png');
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await page.getByRole('button', { name: `Undo: ${TASK}` }).click();
    await expect(page.locator('[data-slot="undo-cascade"] li').first()).toBeVisible();
    await snap(page, 'activity-undo-dialog.png');
  });

  test('activity-empty', { tag: '@visual' }, async ({ page, asUser }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-empty.png');
    await openFeed(page, asUser);
    await snap(page, 'activity-empty.png');
  });

  test('activity-error', { tag: '@visual' }, async ({ page, asUser }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-error.png');
    await openFeed(page, asUser, 'owner', '?__state=error');
    await snap(page, 'activity-error.png');
  });

  test('activity-offline', { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-offline.png');
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser);
    await page.context().setOffline(true);
    await expect(page.locator('[data-slot="activity-offline"]')).toBeVisible();
    await snap(page, 'activity-offline.png');
  });

  test('activity-view-only', { tag: '@visual' }, async ({ page, asUser, db }, testInfo) => {
    skipWithoutBaseline(testInfo, 'activity-view-only.png');
    await seedActivities(db.name, 'chennai-solo');
    await openFeed(page, asUser, 'viewer');
    await snap(page, 'activity-view-only.png');
  });
});
