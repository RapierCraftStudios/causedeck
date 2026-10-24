// Notification preferences (#199) on every viewport × theme project, as the seeded `chennai-solo`
// owner. Covers: a channel switch persists (reload and the `notification_pref` row); the mandatory
// security alert channels are locked with the explanation; the digest choice persists and moves
// the unlocked email rows to `daily` while security alert email stays instant; turning In-app off
// for a category hides its notifications from the bell (a later delivery is affected); the
// court-hours and lock-screen toggles persist; 360 px shows per-category cards; the email footer
// link `/settings/notifications` lands on this page; axe has no serious or critical violations.
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';

import type { AsUser } from '../../fixtures/auth.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { E2E_WORKSPACES, e2eUser, expect, test } from '../../fixtures/index.ts';
import { layoutOf, shellReady } from '../shell/helpers.ts';

const WORKSPACE = E2E_WORKSPACES['chennai-solo'];
const OWNER = e2eUser('owner', 'chennai-solo');
const PATH = `/w/${WORKSPACE.slug}/settings/notifications`;

async function withSql<T>(database: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

interface PrefRow {
  category: string;
  channel: string;
  enabled: boolean;
  digest: string;
}

/** The owner's preference rows in `chennai-solo` (superuser: RLS does not apply). */
async function prefRows(database: string): Promise<PrefRow[]> {
  return withSql(database, (sql) =>
    sql<PrefRow[]>`
      select category, channel::text as channel, enabled, digest::text as digest
      from notification_pref
      where workspace_id = ${WORKSPACE.id} and user_id = ${OWNER.id}
      order by category, channel`.then((rows) => [...rows]),
  );
}

async function settingRow(database: string) {
  return withSql(database, async (sql) => {
    const [row] = await sql<{ court_hours_quiet: boolean; lock_screen_details: boolean }[]>`
      select court_hours_quiet, lock_screen_details from notification_setting
      where workspace_id = ${WORKSPACE.id} and user_id = ${OWNER.id}`;
    return row;
  });
}

async function insertNotification(database: string, category: string, title: string) {
  await withSql(database, async (sql) => {
    await sql`
      insert into notification (workspace_id, user_id, category, title)
      values (${WORKSPACE.id}, ${OWNER.id}, ${category}, ${title})`;
  });
}

/** The visible preferences layout: the table from 768 px, the cards below. */
function layout(page: Page): Locator {
  return page.locator(
    layoutOf(page) === 'phone'
      ? '[data-slot="preferences-cards"]'
      : '[data-slot="preferences-matrix"]',
  );
}

const cell = (page: Page, category: string, channel: string) =>
  layout(page).getByRole('switch', { name: `${category}: ${channel}` });

const status = (page: Page) => page.getByRole('status').filter({ hasText: /Saved|Could not/ });

async function openPreferences(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'settings/notifications' });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Notification preferences' }),
  ).toBeVisible();
  await shellReady(page);
}

test.describe('notification preferences', () => {
  test('a channel switch persists across reloads', async ({ page, asUser, db }) => {
    await openPreferences(page, asUser);
    const email = cell(page, 'Hearing reminders', 'Email');
    await expect(email).toBeChecked();
    await email.click();
    await expect(status(page)).toHaveText('Saved');
    await expect(email).not.toBeChecked();

    await page.reload();
    await expect(cell(page, 'Hearing reminders', 'Email')).not.toBeChecked();
    expect(await prefRows(db.name)).toContainEqual({
      category: 'reminder.hearing',
      channel: 'email',
      enabled: false,
      digest: 'instant',
    });
  });

  test('security alerts are locked in-app and by email, with the explanation', async ({
    page,
    asUser,
  }) => {
    await openPreferences(page, asUser);
    for (const channel of ['In-app', 'Email']) {
      const locked = cell(page, 'Security alerts', channel);
      await expect(locked).toBeChecked();
      await expect(locked).toBeDisabled();
      await expect(locked).toHaveAccessibleDescription(/Security alerts are always sent/);
    }
    await expect(cell(page, 'Security alerts', 'Push')).toBeEnabled();
    await expect(
      layout(page).getByText(
        'Security alerts are always sent in the app and by email so you never miss a sign-in or account change.',
      ),
    ).toBeVisible();
    await expect(layout(page).getByRole('img', { name: 'Always on' })).toHaveCount(2);
  });

  test('the digest choice persists and moves unlocked email to the daily digest', async ({
    page,
    asUser,
    db,
  }) => {
    await openPreferences(page, asUser);
    const digest = page.getByRole('radiogroup', { name: 'Email digest' });
    await expect(digest.getByRole('radio', { name: 'Instant' })).toBeChecked();
    await digest.getByRole('radio', { name: 'Daily at 6:30 pm' }).click();
    await expect(status(page)).toHaveText('Saved');

    await page.reload();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Email digest' })
        .getByRole('radio', { name: 'Daily at 6:30 pm' }),
    ).toBeChecked();
    const rows = await prefRows(db.name);
    const email = rows.filter((r) => r.channel === 'email');
    expect(email.find((r) => r.category === 'reminder.hearing')).toMatchObject({ digest: 'daily' });
    expect(email.find((r) => r.category === 'digest.daily')).toMatchObject({ enabled: true });
    // The mandatory channel is never written: it stays instant.
    expect(rows.some((r) => r.category === 'security.alert')).toBe(false);
  });

  test('turning In-app off hides that category from the bell', async ({ page, asUser, db }) => {
    await insertNotification(db.name, 'proposal.new', 'Draft reply ready for review');
    await openPreferences(page, asUser);
    await cell(page, 'New proposals', 'In-app').click();
    await expect(status(page)).toHaveText('Saved');

    await page.reload();
    await shellReady(page);
    const bell = page.locator('[data-notifications-bell]');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await bell.click();
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Draft reply ready for review')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await cell(page, 'New proposals', 'In-app').click();
    await expect(status(page)).toHaveText('Saved');
    await page.reload();
    await shellReady(page);
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  });

  test('court hours and lock-screen details persist', async ({ page, asUser, db }) => {
    await openPreferences(page, asUser);
    const court = page.getByRole('switch', { name: 'Do not push during court hours' });
    const details = page.getByRole('switch', { name: 'Show details on lock screen' });
    await expect(court).not.toBeChecked();
    await expect(details).not.toBeChecked();
    await court.click();
    await expect(status(page)).toHaveText('Saved');
    await details.click();
    await expect(status(page)).toHaveText('Saved');

    await page.reload();
    await expect(
      page.getByRole('switch', { name: 'Do not push during court hours' }),
    ).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Show details on lock screen' })).toBeChecked();
    expect(await settingRow(db.name)).toEqual({
      court_hours_quiet: true,
      lock_screen_details: true,
    });
  });

  test('shows cards below 768 px and the matrix from 768 px', async ({ page, asUser }) => {
    await openPreferences(page, asUser);
    const cards = page.locator('[data-slot="preferences-cards"]');
    const matrix = page.locator('[data-slot="preferences-matrix"]');
    if (layoutOf(page) === 'phone') {
      await expect(cards).toBeVisible();
      await expect(matrix).toBeHidden();
      await expect(cards.locator('li')).toHaveCount(7);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(360);
    } else {
      await expect(matrix).toBeVisible();
      await expect(cards).toBeHidden();
      await expect(matrix.getByRole('columnheader')).toHaveText([
        'Notification',
        'In-app',
        'Email',
        'Push',
      ]);
    }
  });

  test('the email footer link opens this page', async ({ page, asUser }) => {
    await asUser('owner');
    await page.goto('/settings/notifications');
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notification preferences' }),
    ).toBeVisible();
  });
});

// Explicit axe (not the `@a11y` tag), as in bell.spec.ts.
test.describe('notification preferences accessibility', () => {
  test('has no serious or critical axe violations', async ({ page, asUser, a11y }) => {
    await openPreferences(page, asUser);
    await a11y.expectNoViolations(page);
  });
});
