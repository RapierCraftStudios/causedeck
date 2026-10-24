// Notification bell and panel (#198) on every viewport × theme project. Rows are written straight
// into the worker database for the seeded `chennai-solo` owner, timed around the frozen clock
// (2026-03-12 09:30 IST), so Today/Earlier are stable. Covers the `9+` badge, the panel (newest
// first, grouped, Mark all read), opening an item (navigates and marks read), 30 s polling and
// focus refetch, Shift+N and the keyboard, the empty, error and offline states, the More-sheet
// entry on phones, and axe with the panel open (zero serious or critical violations).
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';

import { databaseUrl } from '../../support/db-reset.ts';
import { E2E_WORKSPACES, e2eUser, expect, FROZEN_TIME, test } from '../../fixtures/index.ts';
import { layoutOf, shellReady } from '../shell/helpers.ts';

const WORKSPACE = E2E_WORKSPACES['chennai-solo'];
const OWNER = e2eUser('owner', 'chennai-solo');

interface Row {
  title: string;
  /** Minutes before the frozen clock. */
  minutesAgo: number;
  read?: boolean;
  body?: string;
  href?: string;
  category?: string;
}

const at = (minutesAgo: number) =>
  new Date(Date.parse(FROZEN_TIME) - minutesAgo * 60_000).toISOString();

async function withSql<T>(database: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Insert notifications for the owner of `chennai-solo` (superuser: RLS does not apply). */
async function insert(database: string, rows: readonly Row[]): Promise<void> {
  await withSql(database, async (sql) => {
    for (const row of rows) {
      await sql`
        insert into notification
          (workspace_id, user_id, category, title, body, href, read_at, created_at)
        values (
          ${WORKSPACE.id}, ${OWNER.id}, ${row.category ?? 'reminder.hearing'}, ${row.title},
          ${row.body ?? null}, ${row.href ?? null}, ${row.read ? at(row.minutesAgo) : null},
          ${at(row.minutesAgo)}
        )`;
    }
  });
}

async function readTitles(database: string): Promise<string[]> {
  return withSql(database, async (sql) => {
    const rows = await sql<{ title: string }[]>`
      select title from notification
      where user_id = ${OWNER.id} and read_at is not null order by title`;
    return rows.map((row) => row.title);
  });
}

const SEED: readonly Row[] = [
  {
    title: 'Hearing tomorrow: W.P. 1234/2026',
    body: 'Court 4, item 12',
    minutesAgo: 30,
    href: `/w/${WORKSPACE.slug}/matters`,
  },
  { title: 'Cause list ready', minutesAgo: 90, read: true, category: 'system.notice' },
  // 18:00 IST the day before: Earlier.
  {
    title: 'Member joined: Arun',
    minutesAgo: 15 * 60 + 30,
    category: 'member.joined',
    href: `/w/${WORKSPACE.slug}/settings`,
  },
];

const bell = (page: Page): Locator => page.locator('[data-notifications-bell]');
/**
 * The bell's `aria-label`. Read as the attribute: with the phone sheet open (modal) everything
 * outside it is `aria-hidden`, so its computed accessible name is empty there.
 */
const expectBellLabel = (page: Page, label: string) =>
  expect(bell(page)).toHaveAttribute('aria-label', label);
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Notifications' });
const items = (page: Page): Locator => panel(page).locator('[data-notification-item]');

async function open(page: Page, asUser: (role: 'owner') => Promise<Page>): Promise<void> {
  await asUser('owner');
  await shellReady(page);
}

test.describe('notification bell', () => {
  test.beforeEach(async ({ clock }) => {
    await clock.freeze();
  });

  test('shows the unread count, capped at 9+', async ({ page, asUser, db }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await expectBellLabel(page, 'Notifications, 2 unread');
    await expect(bell(page).locator('[data-notifications-badge]')).toHaveText('2');
    const box = await bell(page).boundingBox();
    expect(box?.width).toBe(layoutOf(page) === 'phone' ? 44 : 36);

    await insert(
      db.name,
      Array.from({ length: 10 }, (_, index) => ({
        title: `Notice ${String(index)}`,
        minutesAgo: 5,
      })),
    );
    await page.reload();
    await expectBellLabel(page, 'Notifications, 12 unread');
    await expect(bell(page).locator('[data-notifications-badge]')).toHaveText('9+');
  });

  test('opens a panel, newest first, grouped Today and Earlier', async ({ page, asUser, db }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    const today = panel(page).getByRole('region', { name: 'Today' });
    const earlier = panel(page).getByRole('region', { name: 'Earlier' });
    await expect(today.locator('[data-notification-item]')).toHaveCount(2);
    await expect(today.locator('[data-notification-item]').first()).toContainText(
      'Hearing tomorrow: W.P. 1234/2026',
    );
    await expect(today.locator('[data-notification-item]').nth(1)).toContainText(
      'Cause list ready',
    );
    await expect(earlier.locator('[data-notification-item]')).toContainText(['Member joined']);
    const layout = layoutOf(page);
    await expect(panel(page)).toHaveAttribute(
      'data-notification-panel',
      layout === 'phone' ? 'sheet' : 'popover',
    );
    if (layout !== 'phone') {
      const box = await panel(page).boundingBox();
      expect(box?.width).toBe(layout === 'desktop' ? 400 : 384);
    }
  });

  test('clicking an item goes to its href and marks it read', async ({ page, asUser, db }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await bell(page).click();
    await items(page).filter({ hasText: 'Hearing tomorrow' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${WORKSPACE.slug}/matters$`));
    await expect(panel(page)).toBeHidden();
    await expectBellLabel(page, 'Notifications, 1 unread');
    await expect.poll(() => readTitles(db.name)).toContain('Hearing tomorrow: W.P. 1234/2026');
  });

  test('Mark all read clears the badge and persists', async ({ page, asUser, db }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await bell(page).click();
    await panel(page).getByRole('button', { name: 'Mark all read' }).click();
    await expectBellLabel(page, 'Notifications');
    await expect(bell(page).locator('[data-notifications-badge]')).toHaveCount(0);
    await expect.poll(async () => (await readTitles(db.name)).length).toBe(3);
    await page.reload();
    await expectBellLabel(page, 'Notifications');
  });

  test('Shift+N opens the panel; arrows move, R marks read, Esc closes', async ({
    page,
    asUser,
    db,
  }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Shift+N');
    await expect(panel(page)).toBeVisible();
    await items(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(items(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items(page).nth(2)).toBeFocused();
    await page.keyboard.press('r');
    await expectBellLabel(page, 'Notifications, 1 unread');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(bell(page)).toBeFocused();
  });

  test('shows the empty state', async ({ page, asUser }) => {
    await open(page, asUser);
    await bell(page).click();
    await expect(panel(page).getByText('You are all caught up.')).toBeVisible();
  });

  test('shows the error state, and Try again recovers', async ({ page, asUser, db }) => {
    await insert(db.name, SEED);
    // Fail every server action call (POST with a Next-Action header) until released.
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) await route.abort();
      else await route.continue();
    });
    await open(page, asUser);
    await bell(page).click();
    await expect(panel(page).getByText('Could not load notifications.')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await panel(page).getByRole('button', { name: 'Try again' }).click();
    await expect(items(page)).toHaveCount(3);
  });

  test('offline: saved list with a banner, mark-read sent on reconnect', async ({
    page,
    asUser,
    db,
  }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await expectBellLabel(page, 'Notifications, 2 unread');
    // The panel chunk loads at idle; open it once online so it is in memory (the offline cache of
    // app code is the service worker's job, out of scope here).
    await bell(page).click();
    await expect(items(page)).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await page.context().setOffline(true);
    await bell(page).click();
    await expect(panel(page).getByText('Showing saved notifications')).toBeVisible();
    await expect(items(page)).toHaveCount(3);
    await items(page).filter({ hasText: 'Member joined' }).focus();
    await page.keyboard.press('r');
    await expectBellLabel(page, 'Notifications, 1 unread');
    expect(await readTitles(db.name)).not.toContain('Member joined: Arun');
    await page.context().setOffline(false);
    await expect.poll(() => readTitles(db.name)).toContain('Member joined: Arun');
  });

  test('phones: the More sheet entry opens the notification sheet', async ({
    page,
    asUser,
    db,
  }) => {
    test.skip(layoutOf(page) !== 'phone', 'the bottom navigation exists below 768 px only');
    await insert(db.name, SEED);
    await open(page, asUser);
    await page
      .getByRole('navigation', { name: 'Bottom navigation' })
      .getByRole('button', { name: 'More' })
      .click();
    const more = page.getByRole('dialog', { name: 'More destinations' });
    const entry = more.locator('[data-more-item="notifications"]');
    await expect(entry).toContainText('Notifications');
    await expect(entry).toContainText('2');
    await entry.click();
    await expect(panel(page)).toHaveAttribute('data-notification-panel', 'sheet');
    await expect(items(page)).toHaveCount(3);
  });
});

// A running fake clock (not frozen), so the 30 s poll can be fast-forwarded.
test.describe('notification polling', () => {
  test('new notifications arrive by 30 s polling and on focus', async ({ page, asUser, db }) => {
    await page.clock.install({ time: new Date(FROZEN_TIME) });
    await insert(db.name, SEED);
    await open(page, asUser);
    await expectBellLabel(page, 'Notifications, 2 unread');

    await insert(db.name, [{ title: 'Proposal ready', minutesAgo: 1, category: 'proposal.new' }]);
    await page.clock.fastForward('00:31');
    await expectBellLabel(page, 'Notifications, 3 unread');
    await expect(page.getByRole('status').filter({ hasText: '1 new notification' })).toHaveCount(1);

    await insert(db.name, [{ title: 'Second proposal', minutesAgo: 0 }]);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await expectBellLabel(page, 'Notifications, 4 unread');
  });
});

// Explicit axe (not the `@a11y` tag), so a skipped test never audits about:blank.
test.describe('notification panel accessibility', () => {
  test.beforeEach(async ({ clock }) => {
    await clock.freeze();
  });

  test('bell and open panel have no serious or critical axe violations', async ({
    page,
    asUser,
    db,
    a11y,
  }) => {
    await insert(db.name, SEED);
    await open(page, asUser);
    await a11y.expectNoViolations(page);
    await bell(page).click();
    await expect(items(page)).toHaveCount(3);
    await a11y.expectNoViolations(page);
  });

  test('empty panel has no serious or critical axe violations', async ({ page, asUser, a11y }) => {
    await open(page, asUser);
    await bell(page).click();
    await expect(panel(page).getByText('You are all caught up.')).toBeVisible();
    await a11y.expectNoViolations(page);
  });
});
