// Courts accessibility (#425): zero serious or critical axe violations on the courts pages in every
// viewport and theme project (360/768/1280, light and dark). `@a11y`: the fixture runs axe on the
// page each test ends on (fixtures/index.ts), so each test ends on the state it names.
import { expect, test } from '../../fixtures/index.ts';
import { A0_FORUM, COURTS_WORKSPACE, DEGRADED_FORUM } from '../../fixtures/courts-data.ts';

import { courtsPath, emptyCatalogue, openCourts } from './helpers.ts';

const url = (path: string) => `/w/${COURTS_WORKSPACE}/${path}`;

test.describe('courts accessibility', { tag: '@a11y' }, () => {
  test('index with the degraded banner and the planned section', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await expect(page.locator('[data-forum-banner="degraded"]')).toBeVisible();
    await expect(page.locator('[data-courts-planned]')).toBeVisible();
  });

  test('add-forum dialog open', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.locator('[data-slot="add-forum"]').click();
    await expect(page.getByRole('dialog', { name: 'Add a forum' })).toBeVisible();
  });

  test('halls tab with an unreadable hall', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: courtsPath(DEGRADED_FORUM) });
    await expect(page.locator('[data-hall-unreadable]')).toBeVisible();
  });

  test('adapter tab with the levels popover open', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: courtsPath(DEGRADED_FORUM, 'adapter') });
    await page.locator('[data-adapter-levels-trigger]').click();
    await expect(page.locator('[data-adapter-levels]')).toBeVisible();
  });

  test('links tab', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: courtsPath(DEGRADED_FORUM, 'links') });
    await expect(page.locator('[data-deep-link]').first()).toBeVisible();
  });

  test('empty halls tab', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: courtsPath(A0_FORUM) });
    await expect(page.locator('[data-halls-empty]')).toBeVisible();
  });

  test('empty index', async ({ page, asUser, db }) => {
    await emptyCatalogue(db.name);
    await openCourts(page, asUser);
    await expect(page.locator('main [data-pattern-state="empty"]')).toBeVisible();
  });

  test('error state', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url('courts?__state=error'));
    await expect(page.locator('main').getByText('Could not load courts.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('offline banner', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.context().setOffline(true);
    await expect(page.locator('main [data-courts-offline]')).toBeVisible();
  });
});
