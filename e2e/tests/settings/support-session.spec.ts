// Owner support access (#313, spike §6, PRD PL-6): a staff request (seeded; the staff request
// flow is #314) reaches the owner as a security alert and on `/w/<slug>/settings/support`, which
// explains in plain language what support can see. `Grant for 1 hour` starts a session and the
// product shell shows `Support is viewing this workspace until HH:MM`; `End session` there ends it
// at once. `Deny` and `Revoke now` work from the page, an elapsed grant shows neither a session nor
// the banner, nothing offers to extend a grant, and only owners see the section.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import { seedSupport, shellTime, supportSessionRow, SUPPORT_REASON } from './support-data.ts';

const WORKSPACE = 'chennai-solo';
const PENDING = '00000000-0000-4000-8000-0000000e3131';
const ACTIVE = '00000000-0000-4000-8000-0000000e3132';
const ELAPSED = '00000000-0000-4000-8000-0000000e3133';

const banner = (page: Page) => page.locator('[data-slot="support-banner"]');
const request = (page: Page, id: string) =>
  page.locator(`[data-slot="support-request"][data-session-id="${id}"]`);
const activeSession = (page: Page, id: string) =>
  page.locator(`[data-slot="support-active-session"][data-session-id="${id}"]`);

async function openSupport(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'settings/support' });
  await expect(
    page.locator('main').getByRole('heading', { level: 1, name: 'Support access' }),
  ).toBeVisible();
  await shellReady(page);
}

test.describe('owner support access', () => {
  test('the owner is alerted to a request and the page explains the scope', async ({
    page,
    asUser,
    db,
  }) => {
    await seedSupport(db.name, WORKSPACE, [{ id: PENDING, state: 'requested' }]);
    await openSupport(page, asUser);
    // The security alert is in the bell (in-app); its email is covered by the core support tests.
    await page.locator('[data-notifications-bell]').first().click();
    const alert = page
      .getByRole('dialog', { name: 'Notifications' })
      .locator('[data-notification-item]')
      .filter({ hasText: 'CauseDeck support asked to view this workspace' });
    await expect(alert).toHaveCount(1);
    await page.keyboard.press('Escape');

    const scope = page.locator('[data-slot="support-scope"]');
    await expect(scope).toContainText('support cannot change anything');
    await expect(scope).toContainText('recorded in the audit log');
    await expect(request(page, PENDING)).toContainText(`Reason: ${SUPPORT_REASON}`);
    await expect(request(page, PENDING).getByRole('combobox', { name: 'Length' })).toHaveValue(
      '60',
    );
  });

  test('Grant for 1 hour shows the shell banner; End session ends it at once', async ({
    page,
    asUser,
    db,
  }) => {
    await seedSupport(db.name, WORKSPACE, [{ id: PENDING, state: 'requested' }]);
    await openSupport(page, asUser);
    await expect(banner(page)).toHaveCount(0);

    await request(page, PENDING).getByRole('button', { name: 'Grant for 1 hour' }).click();
    await expect(activeSession(page, PENDING)).toBeVisible();

    const granted = await supportSessionRow(db.name, PENDING);
    expect(granted?.status).toBe('granted');
    const minutes =
      ((granted?.expiresAt?.getTime() ?? 0) - (granted?.grantedAt?.getTime() ?? 0)) / 60_000;
    expect(minutes).toBe(60);
    const until = shellTime(granted?.expiresAt ?? new Date());
    await expect(activeSession(page, PENDING)).toContainText(`Until ${until}`);
    // No extend: an active session offers only `Revoke now`.
    await expect(activeSession(page, PENDING).getByRole('button')).toHaveText(['Revoke now']);

    // The banner is in the product shell, on every workspace page.
    await page.goto(`/w/${WORKSPACE}/today`);
    await expect(banner(page)).toContainText(`Support is viewing this workspace until ${until}`);
    await banner(page).getByRole('button', { name: 'End session' }).click();
    await expect(banner(page)).toHaveCount(0);
    expect((await supportSessionRow(db.name, PENDING))?.status).toBe('ended');

    await page.reload();
    await expect(page.locator('main')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test('Deny turns a request down', async ({ page, asUser, db }) => {
    await seedSupport(db.name, WORKSPACE, [{ id: PENDING, state: 'requested' }]);
    await openSupport(page, asUser);
    await request(page, PENDING).getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText('No support requests.')).toBeVisible();
    expect((await supportSessionRow(db.name, PENDING))?.status).toBe('denied');
    await expect(banner(page)).toHaveCount(0);
  });

  test('Revoke now ends an active session and the banner goes', async ({ page, asUser, db }) => {
    await seedSupport(db.name, WORKSPACE, [{ id: ACTIVE, state: 'granted', minutes: 120 }]);
    await openSupport(page, asUser);
    await expect(banner(page)).toBeVisible();
    await activeSession(page, ACTIVE).getByRole('button', { name: 'Revoke now' }).click();
    await expect(page.getByText('No support requests.')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    expect((await supportSessionRow(db.name, ACTIVE))?.status).toBe('ended');
  });

  test('an elapsed grant shows no session and no banner, even before the expiry job', async ({
    page,
    asUser,
    db,
  }) => {
    await seedSupport(db.name, WORKSPACE, [{ id: ELAPSED, state: 'elapsed' }]);
    await openSupport(page, asUser);
    await expect(page.getByText('No support requests.')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test('only owners see support access; a direct URL is denied', async ({ page, asUser, db }) => {
    await seedSupport(db.name, WORKSPACE, [{ id: ACTIVE, state: 'granted' }]);
    await asUser('advocate', { path: 'settings/support' });
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
    await expect(
      page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', {
        name: 'Support access',
      }),
    ).toHaveCount(0);
    // The banner is the owner's: other members are not shown it.
    await expect(banner(page)).toHaveCount(0);
  });
});
