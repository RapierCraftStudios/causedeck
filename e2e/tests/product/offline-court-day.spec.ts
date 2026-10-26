// Offline court-day journeys (#65 part 6, #747): sign in, let the 7-day prefetch fill the encrypted
// store, then `context.setOffline(true)` and check what the member still has. CI only (Playwright
// is never run on the build host). Seed: fixtures/court-day-data.ts in `chennai-solo`.
//   - /today, /tomorrow and a brief render from the device store, with no network;
//   - an uncached route lands on the branded /offline page;
//   - the store belongs to one user and one workspace; access revoked on the server is purged on
//     the next online prefetch;
//   - axe and a keyboard-only pass on the offline board;
//   - edits made offline (carry items, a next date) sit in the outbox and replay on reconnect; a
//     next date the server changed meanwhile stops as a conflict card.
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
  reconnect,
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
    // The shell can still hold the streamed server copy of the sheet in a hidden node beside the
    // client-rendered one, so count the visible sheets: exactly one, and it is the device copy.
    const sheet = page.locator('[data-brief-sheet]:visible');
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toContainText(/offline/i);
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
        // The member here is an owner, and owners see restricted matters they are not listed on by
        // default (`can()`), so the restriction alone revokes nothing: turn that role setting off too.
        await tx`
          insert into workspace_settings (workspace_id, owners_see_restricted)
          values (${row.workspace_id}, false)
          on conflict (workspace_id) do update set owners_see_restricted = false`;
      });
    } finally {
      await sql.end();
    }
    const before = await savedRows(page, 'briefs');
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await contentReady(page);
    // The page-load prefetch waits 10 s and is skipped while the last sync is under 30 min old
    // (#556), so ask for the run the way a reconnect does.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.dispatchEvent(new Event('online')));
          return savedRows(page, 'briefs');
        },
        { timeout: 30_000 },
      )
      .toBeLessThan(before);
  });

  // The outbox (#851): edits made while offline are sealed on the device and replayed by the shell
  // on reconnect (apps/web/lib/offline/use-outbox.ts, components/pwa/offline-sync.tsx).
  test('carry items added offline replay in order once online, with no duplicates', async ({
    page,
    context,
  }) => {
    const items = ['Vakalatnama', 'Affidavit of service'];
    await goOffline(page, context);
    await page.goto(`/w/${SHELL_WORKSPACE}/today`);
    await expectOfflineBoard(page);
    const href = await briefHref(page, COURT_DAY.sharedTitle);
    await page.goto(href);
    const sheet = page.locator('[data-brief-sheet]:visible');
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toContainText(/offline/i);
    const list = sheet.locator('[data-carry-list]');
    for (const label of items) {
      await list.getByRole('textbox').fill(label);
      await list.getByRole('button', { name: /add/i }).click();
      await expect(list.getByText(label)).toBeVisible();
    }
    // Both edits are sealed in the outbox, nothing has reached the server.
    await expect.poll(() => savedRows(page, 'outbox')).toBe(items.length);

    await reconnect(page, context);
    await expect.poll(() => savedRows(page, 'outbox'), { timeout: 30_000 }).toBe(0);

    // The server now holds the items: once each, in the order they were made.
    await expect(async () => {
      await page.goto(href);
      const labels = await page.locator('[data-carry-item]:visible').allTextContents();
      for (const label of items) {
        expect(labels.filter((text) => text.includes(label))).toHaveLength(1);
      }
      expect(labels.findIndex((text) => text.includes(items[0] as string))).toBeLessThan(
        labels.findIndex((text) => text.includes(items[1] as string)),
      );
    }).toPass({ timeout: 30_000 });
  });

  test('a next-date edit made offline surfaces a conflict card when the server changed', async ({
    page,
    context,
    asUser,
    db,
  }) => {
    // The shared item's hearing (the owner appears in it) and proceeding, from the seed.
    const sql = postgres(databaseUrl(db.name, 'owner'), { max: 1, onnotice: () => undefined });
    const serverDate = '2099-03-02';
    let seeded: { hearing_id: string; workspace_id: string; proceeding_id: string };
    try {
      const [row] = await sql<
        { hearing_id: string; workspace_id: string; proceeding_id: string }[]
      >`
        select h.id as hearing_id, h.workspace_id, p.id as proceeding_id
          from hearing h
          join listing l on l.id = h.listing_id
          join proceeding p on p.id = l.proceeding_id
          join matter m on m.id = p.matter_id
         where m.title = ${COURT_DAY.sharedTitle}`;
      if (row === undefined) throw new Error('e2e: no hearing for the shared matter');
      seeded = row;
    } finally {
      await sql.end();
    }

    // Open the outcome form online (it loads the proposal), then lose the network and choose a
    // date: with no date on file the edit is queued against "none".
    await asUser('owner', { path: `hearings/${seeded.hearing_id}/outcome` });
    await contentReady(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.getByLabel('What happened').fill('Adjourned, reply to be filed');
    await page.getByLabel('Enter a date').fill('15/04/2026');
    await page.getByRole('button', { name: 'Confirm outcome' }).click();
    await expect(page.getByText('Saved on this device').first()).toBeVisible();
    await expect.poll(() => savedRows(page, 'outbox')).toBe(1);

    // Meanwhile the server gets a confirmed canonical date for the proceeding.
    const writer = postgres(databaseUrl(db.name, 'owner'), { max: 1, onnotice: () => undefined });
    try {
      await writer.begin(async (tx) => {
        await tx`select set_config('app.workspace_id', ${seeded.workspace_id}, true)`;
        await tx`
          insert into listing (workspace_id, proceeding_id, list_date, list_type, stage_raw,
            canonical, source_type, confirmation_state)
          values (${seeded.workspace_id}, ${seeded.proceeding_id}, ${serverDate}, 'daily',
                  'For hearing', true, 'manual', 'confirmed')`;
      });
    } finally {
      await writer.end();
    }

    await reconnect(page, context);
    await expect(page.getByText('The next date changed while you were offline')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('02/03/2099').first()).toBeVisible();
    // A conflict is never applied blindly: the edit stays on the device until the member chooses.
    expect(await savedRows(page, 'outbox')).toBe(1);
  });
});
