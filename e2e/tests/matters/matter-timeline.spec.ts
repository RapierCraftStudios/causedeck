// The matter Timeline tab (#41): the graph beside the cross-proceeding timeline. Journeys on the
// appeal fixture (a W.P. with its W.A. and two W.M.P.s, one canonical listing far ahead): the tab
// is in the workspace's tablist, the tree and the list render, selecting a proceeding filters the
// timeline and is mirrored in the URL, filters are URL state with a one-action reset, the keys
// (`t`, `[`, `]`, `?`, the tree's arrows) work, the layout mode persists, and the dev-previewable
// states render. The seeded data is small; the 80-event synthetic matter (db seed `synthetic/
// matter-timeline`) is for stories and perf. Runs in CI only.
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import { openMatters } from './helpers.ts';

const matter = MATTERS.appeal;
const timelinePath = (query = '') =>
  query === '' ? `matters/${matter.id}/timeline` : `matters/${matter.id}/timeline?${query}`;
const petitionId = matter.proceedings[0].id;
const appealId = matter.proceedings[1].id;

test.describe('matter timeline', () => {
  test('is a tab of the matter workspace, after Proceedings', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: `matters/${matter.id}` });
    const tabs = page.getByRole('tablist');
    const names = await tabs.getByRole('tab').allTextContents();
    expect(names.indexOf('Timeline')).toBe(names.indexOf('Proceedings') + 1);
    await tabs.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.id}/timeline$`));
    await expect(page.getByRole('tree', { name: 'Proceedings of this matter' })).toBeVisible();
  });

  test('lists the future listing under the Today marker, muted and dotted', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: timelinePath() });
    const future = page.locator('[data-event-id^="listing:"][data-future]');
    await expect(future).toHaveCount(1);
    await expect(page.locator('[data-today-marker]')).toBeVisible();
    await expect(future.locator('[data-slot="provenance-chip"]')).toBeVisible();
    await expect(page.locator('[data-slot="to-confirm"]')).toHaveCount(0);
  });

  test('selecting a proceeding filters the timeline, mirrors p= in the URL and resets', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: timelinePath() });
    const tree = page.getByRole('tree', { name: 'Proceedings of this matter' });
    const appeal = tree.locator(`[data-item-id="${appealId}"]`);
    await appeal.click();
    await expect(page).toHaveURL(new RegExp(`[?&]p=${appealId}`));
    await expect(page.locator('[data-event-id^="listing:"]')).toHaveCount(0);
    await tree.locator(`[data-item-id="${petitionId}"]`).click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-event-id^="listing:"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect(page).not.toHaveURL(/[?&]p=/);
  });

  test('the tree answers the arrow keys and Home and End (roving tabindex)', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: timelinePath() });
    const items = page
      .getByRole('tree', { name: 'Proceedings of this matter' })
      .getByRole('treeitem');
    await items.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]p=/);
  });

  test('filters live in the URL and Clear filters is one action', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: timelinePath() });
    await page.getByLabel('Search events').fill('no-such-event-text');
    await expect(page).toHaveURL(/[?&]q=no-such-event-text/);
    await expect(page.getByText('No events match these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page.locator('[data-event-id]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Orders' }).click();
    await expect(page).toHaveURL(/[?&]k=order/);
  });

  test('t jumps to today, ? lists the shortcuts and Esc returns focus', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: timelinePath() });
    await page.locator('body').click();
    await page.keyboard.press('t');
    // Focus lands on the row (`li[data-row-id]`) that wraps the event card, not on the card.
    await expect(page.locator('[data-row-id^="listing:"]')).toBeFocused();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Lanes mode (1280 px and up) persists per viewer, Combined is the default', async ({
    page,
    asUser,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1280, 'Lanes is a 1280 px and up layout');
    await openMatters(page, asUser, { path: timelinePath() });
    await expect(page.getByRole('table', { name: /time axis/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Lanes' }).click();
    await expect(page.getByRole('table', { name: /time axis/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('table', { name: /time axis/ })).toBeVisible();
    await page.getByRole('button', { name: 'Combined' }).click();
    await expect(page.getByRole('table', { name: /time axis/ })).toHaveCount(0);
  });

  test('the dev-previewable states render: empty, offline, denied, error', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: timelinePath('__state=empty') });
    await expect(page.getByText('Nothing has happened on this matter yet.')).toBeVisible();
    await page.goto(`/w/${MATTERS_WORKSPACE}/${timelinePath('__state=offline')}`);
    await expect(page.locator('[data-timeline-offline]')).toContainText(
      'Showing saved timeline from',
    );
    await page.goto(`/w/${MATTERS_WORKSPACE}/${timelinePath('__state=denied')}`);
    await expect(page.locator('main [data-pattern-state="permission-denied"]')).toBeVisible();
    await page.goto(`/w/${MATTERS_WORKSPACE}/${timelinePath('__state=error')}`);
    await expect(page.locator('main').getByRole('button', { name: 'Retry' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a clerk reads the timeline too (read-only view, no editing controls)', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { role: 'clerk', path: timelinePath() });
    await expect(page.getByRole('tree', { name: 'Proceedings of this matter' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(add|edit|delete)\b/i })).toHaveCount(0);
  });
});
