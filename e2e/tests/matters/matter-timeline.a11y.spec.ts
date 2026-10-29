// Matter Timeline accessibility (#41): zero serious or critical axe violations on the tab in every
// viewport and theme project (360/768/1280, light and dark). `@a11y`: the fixture runs axe on the
// page each test ends on (fixtures/index.ts), so each test ends on the state it names.
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import { openMatters } from './helpers.ts';

const matter = MATTERS.appeal;
const path = (query = '') =>
  query === '' ? `matters/${matter.id}/timeline` : `matters/${matter.id}/timeline?${query}`;

test.describe('matter timeline accessibility', { tag: '@a11y' }, () => {
  test('combined', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: path() });
    await expect(page.locator('[data-event-id]').first()).toBeVisible();
  });

  test('tree: role=tree and a labelled event list with positions', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: path() });
    await expect(page.getByRole('tree', { name: 'Proceedings of this matter' })).toBeVisible();
    const first = page.locator('[data-row-id]').first();
    await expect(first).toHaveAttribute('aria-posinset', '1');
    await expect(first).toHaveAttribute('aria-setsize', /\d+/);
  });

  test('status never relies on colour alone: line styles are in the legend as text', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: path() });
    await expect(page.getByText('Line styles').first()).toBeVisible();
    await expect(page.getByText('Connected matter').first()).toBeVisible();
  });

  test('filtered empty', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: path('q=no-such-event-text') });
    await expect(page.getByText('No events match these filters.')).toBeVisible();
  });

  test('empty matter', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: path('__state=empty') });
    await expect(page.getByText('Nothing has happened on this matter yet.')).toBeVisible();
  });

  test('error state', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.goto(`/w/${MATTERS_WORKSPACE}/${path('__state=error')}`);
    await expect(page.locator('main').getByRole('button', { name: 'Retry' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('shortcuts dialog open', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: path() });
    await page.locator('body').click();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  });
});
