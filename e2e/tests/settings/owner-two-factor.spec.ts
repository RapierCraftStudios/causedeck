// Owner 2FA policy (#290, apps/web/lib/require-2fa-for-owners.ts): an owner without two-factor
// authentication 7 days after the owner role grant sees a persistent banner on every workspace
// page and cannot run destructive actions (billing here; delete and export share the guard) until
// 2FA is on. The seed grants the role at seed time, so the grant is back-dated on the worker
// database as the superuser (RLS does not apply). Also: the banner is absent inside the grace,
// gone once 2FA is on, wraps without horizontal scroll at 360 px, passes axe (`@a11y`), and has
// light/dark baselines at every viewport (generated only by the e2e workflow's update_snapshots
// dispatch; without one the visual test is skipped).
import { existsSync } from 'node:fs';

import type { Page } from '@playwright/test';
import postgres from 'postgres';

import type { AsUser } from '../../fixtures/auth.ts';
import { E2E_WORKSPACES, e2eUser, expect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { shellReady } from '../shell/helpers.ts';

const WORKSPACE = 'chennai-solo';
const BANNER = '[data-slot="owner-two-factor-banner"]';

async function withSql(database: string, fn: (sql: postgres.Sql) => Promise<unknown>) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Back-date the owner's role grant past the 7-day grace. */
function graceOver(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      update member set role_granted_at = now() - interval '8 days'
      where workspace_id = ${E2E_WORKSPACES[WORKSPACE].id} and role = 'owner'`;
  });
}

/** Turn 2FA on for the owner (what the #289 setup dialog's verify step stores). */
function enableTwoFactor(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      update "user" set two_factor_enabled = true
      where email = ${e2eUser('owner', WORKSPACE).email}`;
  });
}

async function openBilling(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'billing' });
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await shellReady(page);
}

test.describe('owner 2FA policy', () => {
  test('no banner while the 7-day grace runs', async ({ page, asUser }) => {
    await openBilling(page, asUser);
    await expect(page.locator(BANNER)).toHaveCount(0);
  });

  test(
    'after the grace: a persistent banner and billing changes are refused',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await graceOver(db.name);
      await openBilling(page, asUser);
      const banner = page.locator(BANNER);
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute('role', 'status');
      await expect(banner).toContainText('Turn on two-factor authentication');
      await expect(banner.getByRole('link', { name: 'Set up two-factor' })).toHaveAttribute(
        'href',
        '/account#two-factor',
      );

      const seats = page.locator('[data-slot="billing-seats"]');
      await seats.getByRole('button', { name: 'Add a seat' }).click();
      await seats.getByRole('button', { name: 'Review change' }).click();
      await expect(seats.locator('[data-slot="billing-quote"]')).toHaveCount(0);

      // Persistent: every workspace page shows it, and there is nothing to dismiss it with.
      await page.goto(`/w/${WORKSPACE}/settings/profile`);
      await expect(page.locator(BANNER)).toBeVisible();
      await expect(page.locator(BANNER).getByRole('button')).toHaveCount(0);
    },
  );

  test('the banner goes once 2FA is on, and billing works again', async ({ page, asUser, db }) => {
    await graceOver(db.name);
    await enableTwoFactor(db.name);
    await openBilling(page, asUser);
    await expect(page.locator(BANNER)).toHaveCount(0);
    const seats = page.locator('[data-slot="billing-seats"]');
    await seats.getByRole('button', { name: 'Add a seat' }).click();
    await seats.getByRole('button', { name: 'Review change' }).click();
    await expect(seats.locator('[data-slot="billing-quote"]')).toBeVisible();
  });

  test('the banner wraps without horizontal scroll at 360 px', async ({ page, asUser, db }) => {
    await graceOver(db.name);
    await page.setViewportSize({ width: 360, height: 800 });
    await openBilling(page, asUser);
    await expect(page.locator(BANNER)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('owner-two-factor-banner.png', async ({ page, asUser, db }, testInfo) => {
    const name = 'owner-two-factor-banner.png';
    test.skip(
      testInfo.config.updateSnapshots === 'none' &&
        !existsSync(testInfo.snapshotPath(name, { kind: 'screenshot' })),
      'no baseline yet: dispatch the e2e workflow with update_snapshots',
    );
    await graceOver(db.name);
    await asUser('owner', { path: 'settings/profile' });
    await expect(page.locator(BANNER)).toBeVisible();
    await shellReady(page);
    await expect(page).toHaveScreenshot(name, { animations: 'disabled', caret: 'hide' });
  });
});
