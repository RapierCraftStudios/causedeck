// Calendar settings (#53; PRD CA-5): `/w/<slug>/settings/integrations/calendar`. An owner creates the
// private feed after acknowledging the "outside India" note, sees the URL once (masked after a
// reload), fetches it as a calendar app would (`text/calendar`, 304 on the ETag, no cookie needed),
// rotates it through a dialog that names its effect (the old URL is a 404 at once) and revokes it.
// The import card sends an `.ics` file to the capture inbox and opens its review. Clerks and viewers
// may create a `mine` feed; a dark flag is a 404. `@a11y` tests run axe on the page they end on;
// `@visual` runs in every viewport and theme once baselines exist (see e2e/README.md). Every test
// starts from the reset e2e seed, where every flag is off.
import { existsSync } from 'node:fs';

import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

/** Turn `capture.ics-feed` on for the shell workspace and the `ics` capture channel with it. */
async function enableCalendar(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into workspace_feature_flag (workspace_id, key, enabled, updated_by)
      select o.id, 'capture.ics-feed', true, m.user_id
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1`;
    await sql`
      insert into workspace_capture_channel (workspace_id, channel, enabled, enabled_by, enabled_at, disclosure_version)
      select o.id, 'ics', true, m.user_id, now(), '2026-10-v1'
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1`;
  } finally {
    await sql.end();
  }
}

async function openCalendar(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `settings/integrations/calendar${query}` });
  await expect(
    page.locator('main').getByRole('heading', { level: 1, name: 'Calendar' }),
  ).toBeVisible();
  await shellReady(page);
}

const feedUrl = (page: Page) => page.getByRole('textbox', { name: 'Feed URL' });

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Example//Diary//EN',
  'BEGIN:VEVENT',
  'UID:e2e-hearing-1@example.test',
  'DTSTAMP:20261001T080000Z',
  'DTSTART;TZID=Asia/Kolkata:20271201T103000',
  'SUMMARY:W.P. 99001/2026 hearing (fictional)',
  'LOCATION:Court 12',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

test.describe('settings calendar', () => {
  test('a dark flag is a plain 404', async ({ page, asUser }) => {
    await asUser('owner', { path: 'settings/integrations/calendar' });
    await expect(page.getByText('This page could not be found')).toBeVisible();
  });

  test(
    'empty: the disclosure must be acknowledged before the feed is created',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableCalendar(db.name);
      await openCalendar(page, asUser);
      await expect(
        page.getByText('No feed yet. Create one to see hearings in your phone calendar.'),
      ).toBeVisible();
      await expect(
        page.getByText(
          'Your calendar app may fetch this feed from servers outside India. We keep the content minimal.',
        ),
      ).toBeVisible();
      const create = page.getByRole('button', { name: 'Create feed' });
      await expect(create).toBeDisabled();
      await page.getByRole('checkbox', { name: 'I understand' }).check();
      await expect(create).toBeEnabled();
      // Party names are off by default, with the reason.
      await expect(page.getByRole('switch', { name: /Include party names/ })).not.toBeChecked();
    },
  );

  test(
    'an owner creates the feed, sees the URL once, fetches it, rotates it and revokes it',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableCalendar(db.name);
      await openCalendar(page, asUser);
      await page.getByRole('checkbox', { name: 'I understand' }).check();
      await page.getByRole('button', { name: 'Create feed' }).click();
      await expect(feedUrl(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
      const first = await feedUrl(page).inputValue();
      await expect(page.getByText('Copy it now. It will not be shown again.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy URL' })).toBeVisible();

      // A calendar app has no session: the token is the only credential.
      const response = await page.request.get(first, { headers: { cookie: '' } });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8');
      expect(response.headers()['cache-control']).toContain('private');
      expect(await response.text()).toContain('BEGIN:VTIMEZONE');
      const etag = response.headers()['etag'] ?? '';
      const again = await page.request.get(first, { headers: { 'if-none-match': etag } });
      expect(again.status()).toBe(304);

      // Only the hash is stored: after a reload the link is masked again.
      await page.reload();
      await expect(feedUrl(page)).toHaveValue(/\/api\/ics\/••••••••/);

      await page.getByRole('button', { name: 'Rotate', exact: true }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Rotate the feed link?' });
      await expect(dialog).toContainText('The current link stops working at once');
      await dialog.getByRole('button', { name: 'Rotate link' }).click();
      await expect(dialog).toBeHidden();
      await expect(feedUrl(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
      const second = await feedUrl(page).inputValue();
      expect(second).not.toBe(first);
      expect((await page.request.get(first)).status()).toBe(404);
      expect((await page.request.get(second)).status()).toBe(200);

      await page.getByRole('button', { name: 'Revoke', exact: true }).click();
      await page
        .getByRole('alertdialog', { name: 'Revoke the feed?' })
        .getByRole('button', { name: 'Revoke feed' })
        .click();
      await expect(
        page.getByText('No feed yet. Create one to see hearings in your phone calendar.'),
      ).toBeVisible();
      expect((await page.request.get(second)).status()).toBe(404);
    },
  );

  test('a clerk may create a feed for the matters they can read, but not the workspace', async ({
    page,
    asUser,
    db,
  }) => {
    await enableCalendar(db.name);
    await openCalendar(page, asUser, 'clerk');
    await expect(
      page.getByText('Only workspace owners can share the whole workspace.'),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'I understand' }).check();
    await page.getByRole('button', { name: 'Create feed' }).click();
    await expect(feedUrl(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
  });

  test('an unknown token is a bodyless 404', async ({ page, asUser, db }) => {
    await enableCalendar(db.name);
    await openCalendar(page, asUser);
    const response = await page.request.get(`/api/ics/${'a'.repeat(43)}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe('');
  });

  test(
    'importing a calendar file opens its review',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableCalendar(db.name);
      await openCalendar(page, asUser);
      await page.locator('[data-slot="calendar-import-file"]').setInputFiles({
        name: 'diary.ics',
        mimeType: 'text/calendar',
        buffer: Buffer.from(SAMPLE_ICS, 'utf8'),
      });
      await expect(page).toHaveURL(/\?capture=[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { name: 'Calendar import' })).toBeVisible();
      // There is never a bulk confirm for next dates.
      await expect(page.getByRole('button', { name: /confirm all/i })).toHaveCount(0);
    },
  );

  test('offline: the controls are disabled with the reason', async ({ page, asUser, db }) => {
    await enableCalendar(db.name);
    await openCalendar(page, asUser);
    await page.getByRole('checkbox', { name: 'I understand' }).check();
    await page.context().setOffline(true);
    await expect(
      page.getByText('Settings can be changed when you are back online.').first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create feed' })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'Create feed' })).toBeEnabled();
  });

  test('loading and error states (dev previews)', async ({ page, asUser, db }) => {
    await enableCalendar(db.name);
    await openCalendar(page, asUser, 'owner', '?__state=loading');
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/integrations/calendar?__state=error`);
    await expect(page.getByText('Could not load the calendar settings.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('never scrolls sideways', async ({ page, asUser, db }) => {
    await enableCalendar(db.name);
    await openCalendar(page, asUser);
    await page.getByRole('checkbox', { name: 'I understand' }).check();
    await page.getByRole('button', { name: 'Create feed' }).click();
    await expect(feedUrl(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test(
    'visual: the empty calendar page',
    { tag: '@visual' },
    async ({ page, asUser, db }, testInfo) => {
      const baseline = testInfo.snapshotPath('settings-calendar.png', { kind: 'screenshot' });
      test.skip(
        testInfo.config.updateSnapshots === 'none' && !existsSync(baseline),
        'no baseline yet: dispatch the e2e workflow with update_snapshots',
      );
      await enableCalendar(db.name);
      await openCalendar(page, asUser);
      await expect(page).toHaveScreenshot('settings-calendar.png', { fullPage: true });
    },
  );
});
