// Offline court-day journeys (#65 part 6, #747): sign in, let the 7-day prefetch fill the encrypted
// store, then `context.setOffline(true)` and check what the member still has. CI only (Playwright
// is never run on the build host). Seed: fixtures/court-day-data.ts in `chennai-solo`.
//   - /today, /tomorrow and a brief render from the device store, with no network;
//   - an uncached route lands on the branded /offline page;
//   - the store belongs to one user and one workspace; access revoked on the server is purged on
//     the next online prefetch;
//   - axe and a keyboard-only pass on the offline board.
import postgres from 'postgres';

import { COURT_DAY, seedCourtDay } from '../../fixtures/court-day-data.ts';
import { expect as baseExpect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE, contentReady } from '../shell/helpers.ts';

import {
  briefHref,
  expectOfflineBoard,
  goOffline,
  offlineDbNames,
  savedRows,
  waitForPrefetch,
} from './offline-helpers.ts';

const expect = baseExpect.configure({ timeout: 15_000 });

const OTHER_WORKSPACE = 'bengaluru-chamber';

test.describe('offline court day', () => {
  // Each test seeds a day, waits for a prefetch and drives a service worker.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, asUser, db }) => {
    await seedCourtDay(db);
    await page.setViewportSize({ width: 1280, height: 800 });
    await asUser('owner', { path: 'today' });
    await contentReady(page);
    await waitForPrefetch(page);
  });

  test('prefetch saves the window on this device, sealed', async ({ page }) => {
    expect(await offlineDbNames(page)).toHaveLength(1);
    expect(await savedRows(page, 'courtDay')).toBeGreaterThanOrEqual(2);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) {
          urls.push(new URL(request.url).pathname);
        }
      }
      return urls;
    });
    // The worker never stores a signed-in response (ADR-0042); the data lives in IndexedDB.
    for (const url of cached) expect(url).not.toMatch(/^\/(api|w)\//);
  });

  test('today renders offline from the saved day', { tag: '@a11y' }, async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    await expect(page.locator('[data-offline-board]')).toContainText(COURT_DAY.sharedTitle);
    await expect(page.locator('[data-offline-board]')).toContainText(COURT_DAY.first);
  });

  test('tomorrow renders offline from the saved day', async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/tomorrow`);
    await expectOfflineBoard(page);
    await expect(page.locator('[data-offline-board]')).toContainText('Tomorrow v. State');
    await expect(page.locator('[data-offline-board]')).not.toContainText(COURT_DAY.sharedTitle);
  });

  test('a prefetched brief opens offline', async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    await page.goto(await briefHref(page, COURT_DAY.sharedTitle));
    await expect(page.locator('[data-brief-sheet]')).toBeVisible();
  });

  test('an uncached route falls back to the branded offline page', async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/matters`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-offline-board]')).toHaveCount(0);
    await expect(page.getByRole('link').first()).toBeVisible();
  });

  test('keyboard only: Tab reaches the saved briefs in order', async ({ page, context }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    let reached = false;
    for (let press = 0; press < 12 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () => document.activeElement?.getAttribute('href')?.includes('/briefs/') ?? false,
      );
    }
    expect(reached).toBe(true);
    // The focus ring is not removed.
    const outline = await page.evaluate(
      () => getComputedStyle(document.activeElement as Element).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });

  test('another member of the workspace never reads the first member store', async ({
    page,
    context,
    asUser,
  }) => {
    // The owner's store holds the owner-only matter (item 20); the clerk signs in on the same device.
    await asUser('clerk', { path: 'today' });
    await contentReady(page);
    await expect.poll(() => offlineDbNames(page).then((names) => names.length)).toBe(2);
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    await expect(page.locator('[data-offline-board]')).not.toContainText(COURT_DAY.restrictedTitle);
  });

  test('another workspace has its own store', async ({ page, context, asUser }) => {
    await asUser('owner', { workspace: OTHER_WORKSPACE, path: 'today' });
    await contentReady(page);
    await expect.poll(() => offlineDbNames(page).then((names) => names.length)).toBe(2);
    await goOffline(page, context);
    await page.goto(`/w/${OTHER_WORKSPACE}/today`);
    await expect(page.getByText(COURT_DAY.sharedTitle)).toHaveCount(0);
  });

  test('access revoked on the server is purged from the device on the next prefetch', async ({
    page,
    context,
    db,
  }) => {
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    const href = await briefHref(page, COURT_DAY.sharedTitle);
    const listingId = /\/briefs\/([^/?#]+)/.exec(href)?.[1];
    if (listingId === undefined) throw new Error(`e2e: no listing id in ${href}`);
    await context.setOffline(false);

    // Restrict the matter to nobody on the server, then come back online: the pull names the
    // listing in `purge` and the device deletes the saved brief.
    const sql = postgres(databaseUrl(db.name, 'owner'), { max: 1, onnotice: () => undefined });
    try {
      await sql.begin(async (tx) => {
        const [row] = await tx<{ workspace_id: string; matter_id: string }[]>`
          select l.workspace_id, p.matter_id
            from listing l join proceeding p on p.id = l.proceeding_id
           where l.id = ${listingId}`;
        if (row === undefined) throw new Error(`e2e: listing ${listingId} not found`);
        await tx`select set_config('app.workspace_id', ${row.workspace_id}, true)`;
        await tx`
          insert into matter_restriction (workspace_id, matter_id, allowed_user_ids)
          values (${row.workspace_id}, ${row.matter_id}, '{}'::uuid[])`;
      });
    } finally {
      await sql.end();
    }
    const before = await savedRows(page, 'briefs');
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await contentReady(page);
    await expect.poll(() => savedRows(page, 'briefs'), { timeout: 30_000 }).toBeLessThan(before);
  });

  // Not reachable from the UI yet: `enqueueEdit` and `drainOutbox` (apps/web/lib/offline/sync.ts)
  // have no caller outside lib/offline, so no click while offline writes to the outbox. Their
  // behaviour is covered by apps/web/__tests__/offline/sync.test.ts; the e2e cases follow once the
  // brief sheet and the next-date control enqueue (tracked by the #747 deferral).
  test.fixme('carry ticks, notes and captures made offline replay in order once online', () => {
    // Offline: tick a carry item, edit a note; online: the outbox drains once, no duplicates.
  });

  test.fixme('a next-date edit made offline surfaces a conflict card when the server changed', () => {
    // Offline edit becomes a proposal; the server value changes; reconnect shows the conflict card.
  });
});
