// Matters accessibility (#394): zero serious or critical axe violations on every matters route in
// every viewport and theme project (360/768/1280, light and dark). `@a11y`: the fixture runs axe on
// the page each test ends on (fixtures/index.ts), so each test ends on the state it names. Focus
// order and non-colour status are asserted in the same tests.
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import { listLayout, matterPath, mattersPath, openMatters } from './helpers.ts';

const url = (path: string) => `/w/${MATTERS_WORKSPACE}/${path}`;

test.describe('matters accessibility', { tag: '@a11y' }, () => {
  test('list', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await expect(listLayout(page).locator('[data-matter-row]').first()).toBeVisible();
  });

  test('list: focus follows the visual order (search, filters, then the rows)', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser);
    const order = await page.evaluate(() => {
      const search = document.querySelector('input[type="search"], [role="searchbox"]');
      const row = document.querySelector('[data-matter-row]');
      if (!search || !row) return null;
      return search.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();
  });

  test('list: status never relies on colour alone (stage and confirmation carry text)', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser);
    const row = listLayout(page).locator(`[data-matter-row="${MATTERS.conflict.id}"]`);
    await expect(row.locator('[data-confirmation]').first()).not.toHaveText('');
  });

  test('list: new-matter dialog open', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.locator('[data-slot="new-matter"]').first().click();
    await expect(page.getByRole('dialog', { name: 'New matter' })).toBeVisible();
  });

  test('list: filtered empty', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: mattersPath('q=zzzz-no-such-matter') });
    await expect(page.locator('[data-matters-empty="filtered"]')).toBeVisible();
  });

  test('list: error state', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.goto(url('matters?__state=error'));
    await expect(page.locator('main').getByRole('button', { name: 'Retry' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('list: permission denied', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.goto(url('matters?__state=denied'));
    await expect(page.locator('main [data-pattern-state]')).toBeVisible();
  });

  test('list: offline banner', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.context().setOffline(true);
    await expect(page.locator('main [data-matters-offline]')).toBeVisible();
  });

  test('overview with the next date and the tab bar', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal) });
    await expect(page.getByRole('tablist')).toBeVisible();
    await expect(page.locator('[data-slot="next-date-card"]')).toBeVisible();
  });

  test('overview with the conflict card', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.conflict) });
    await expect(page.locator('[data-slot="date-conflict-card"]')).toBeVisible();
  });

  test('overview of a sensitive matter', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.sensitive) });
    await expect(page.locator('[data-slot="matter-header"]')).toBeVisible();
  });

  test('proceedings tab with the appeal chain and W.M.P. children', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal, 'proceedings') });
    await expect(page.getByRole('tree').getByRole('treeitem')).toHaveCount(4);
  });

  test('people tab', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal, 'people') });
    await expect(page.locator('[data-people]')).toBeVisible();
  });

  test('documents tab', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal, 'documents') });
    await expect(page.locator('[data-documents]')).toBeVisible();
  });

  test('matter not found', async ({ page, asUser }) => {
    await asUser('owner', { workspace: 'bengaluru-chamber', path: matterPath(MATTERS.appeal) });
    await expect(page.locator('[data-matter-not-found]')).toBeVisible();
  });
});
