// The support session lifecycle end to end (#314, #27; spike §6, PRD PL-6): staff request a
// session with a reason in the admin console; the workspace owner, alerted in the product, grants,
// denies or revokes it in Settings, Support access; while granted, staff see the workspace through
// the read-only view under the fixed `SUPPORT SESSION: READ-ONLY` bar; a grant runs out (expiry)
// and is never extended; staff can end their own session, and the owner's shell banner goes. The
// admin server and the web server share the worker database, so one test drives both sides.
import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { E2E_WORKSPACES, expect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { supportSessionRow } from '../settings/support-data.ts';

const WORKSPACE = 'chennai-solo';
const WORKSPACE_ID = E2E_WORKSPACES[WORKSPACE].id;
const REASON = 'Customer reported that hearing dates stopped syncing';

const readOnlyBar = (page: Page) => page.locator('[data-slot="support-read-only-bar"]');
const view = (page: Page) => page.locator('[data-slot="support-view"]');
const sessionPage = (page: Page) => page.locator('[data-slot="support-session"]');
const ownerRequest = (page: Page, id: string) =>
  page.locator(`[data-slot="support-request"][data-session-id="${id}"]`);
const ownerActive = (page: Page, id: string) =>
  page.locator(`[data-slot="support-active-session"][data-session-id="${id}"]`);
const shellBanner = (page: Page) => page.locator('[data-slot="support-banner"]');

/** Staff fill in and send the request form; returns the new session id from the page it opens. */
async function requestSession(staff: Page, reason = REASON): Promise<string> {
  await staff.goto('/support');
  await staff.getByLabel('Workspace ID').fill(WORKSPACE_ID);
  await staff.getByLabel('Reason').fill(reason);
  await staff.getByRole('button', { name: 'Request session' }).click();
  await staff.waitForURL(/\/support\/[0-9a-f-]{36}$/);
  const id = new URL(staff.url()).pathname.split('/').pop() ?? '';
  await expect(sessionPage(staff)).toHaveAttribute('data-state', 'requested');
  return id;
}

/** Move a granted window `minutes` into the past, as if that much time had passed. */
async function age(database: string, id: string, minutes: number): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`update support_session
                 set granted_at = granted_at - make_interval(mins => ${minutes}),
                     expires_at = expires_at - make_interval(mins => ${minutes})
               where id = ${id}::uuid`;
  } finally {
    await sql.end();
  }
}

/** Run the expiry sweep the `system.support.session-expire` job runs. */
async function runExpirySweep(database: string): Promise<number> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql`select id from app_expire_support_sessions()`;
    return rows.length;
  } finally {
    await sql.end();
  }
}

test.describe('support session lifecycle', () => {
  test('request with reason, owner grant, read-only view, revoke', async ({
    adminAs,
    asUser,
    page,
    db,
  }) => {
    const staff = await adminAs('staff');
    await staff.goto('/support');
    await expect(staff.getByText('No support sessions.')).toBeVisible();

    // A reason is required: nothing is requested without one.
    await staff.getByLabel('Workspace ID').fill(WORKSPACE_ID);
    await staff.getByRole('button', { name: 'Request session' }).click();
    await expect(staff.getByText(/A reason is required/)).toBeVisible();
    await expect(staff).toHaveURL(/\/support$/);

    const id = await requestSession(staff);
    expect((await supportSessionRow(db.name, id))?.status).toBe('requested');
    await expect(readOnlyBar(staff)).toHaveCount(0);
    await expect(view(staff)).toHaveCount(0);

    // The owner is alerted and sees the request with the reason.
    await asUser('owner', { path: 'settings/support' });
    await expect(ownerRequest(page, id)).toContainText(`Reason: ${REASON}`);
    await ownerRequest(page, id).getByRole('button', { name: 'Grant for 1 hour' }).click();
    await expect(ownerActive(page, id)).toBeVisible();

    // Staff now see the workspace, read-only, with the countdown.
    await staff.reload();
    await expect(sessionPage(staff)).toHaveAttribute('data-state', 'active');
    await expect(readOnlyBar(staff)).toContainText('SUPPORT SESSION: READ-ONLY');
    await expect(readOnlyBar(staff).getByRole('status')).toContainText('read-only');
    await expect(staff.locator('[data-slot="support-countdown"]')).toContainText(/Ends in \d/);
    await expect(view(staff)).toContainText(E2E_WORKSPACES[WORKSPACE].name);
    // Nothing offers more time.
    await expect(staff.getByRole('button', { name: /extend/i })).toHaveCount(0);

    // The owner revokes: staff lose the view on the next load.
    await ownerActive(page, id).getByRole('button', { name: 'Revoke now' }).click();
    await expect(page.getByText('No support requests.')).toBeVisible();
    expect((await supportSessionRow(db.name, id))?.status).toBe('ended');
    await staff.reload();
    await expect(sessionPage(staff)).toHaveAttribute('data-state', 'ended');
    await expect(view(staff)).toHaveCount(0);
    await expect(readOnlyBar(staff)).toHaveCount(0);

    // The list shows it, ended.
    await staff.goto('/support');
    await expect(
      staff.locator(`[data-slot="support-session-row"][data-session-id="${id}"]`),
    ).toContainText('Ended');
  });

  test('the owner denies a request', async ({ adminAs, asUser, page, db }) => {
    const staff = await adminAs('staff');
    const id = await requestSession(staff);
    await asUser('owner', { path: 'settings/support' });
    await ownerRequest(page, id).getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText('No support requests.')).toBeVisible();
    expect((await supportSessionRow(db.name, id))?.status).toBe('denied');
    await staff.reload();
    await expect(sessionPage(staff)).toHaveAttribute('data-state', 'denied');
    await expect(view(staff)).toHaveCount(0);
  });

  test('a grant expires and cannot be extended', async ({ adminAs, asUser, page, db }) => {
    const staff = await adminAs('staff');
    const id = await requestSession(staff);
    await asUser('owner', { path: 'settings/support' });
    await ownerRequest(page, id).getByRole('button', { name: 'Grant for 1 hour' }).click();
    await expect(ownerActive(page, id)).toBeVisible();
    await staff.reload();
    await expect(view(staff)).toBeVisible();

    // An hour passes: the grant is over before the job runs, then the sweep flips the row.
    await age(db.name, id, 61);
    await staff.reload();
    await expect(sessionPage(staff)).toHaveAttribute('data-state', 'expired');
    await expect(view(staff)).toHaveCount(0);
    await expect(readOnlyBar(staff)).toHaveCount(0);
    expect(await runExpirySweep(db.name)).toBe(1);
    expect((await supportSessionRow(db.name, id))?.status).toBe('expired');
    await staff.reload();
    await expect(sessionPage(staff)).toHaveAttribute('data-state', 'expired');
    await expect(staff.getByRole('button', { name: /end session|extend/i })).toHaveCount(0);

    // The owner sees neither the session nor the banner; nothing can be granted again.
    await page.reload();
    await expect(page.getByText('No support requests.')).toBeVisible();
    await expect(shellBanner(page)).toHaveCount(0);
  });

  test('staff end their own session at once; the owner banner goes', async ({
    adminAs,
    asUser,
    page,
    db,
  }) => {
    const staff = await adminAs('staff');
    const id = await requestSession(staff);
    await asUser('owner', { path: 'settings/support' });
    await ownerRequest(page, id).getByRole('button', { name: 'Grant for 1 hour' }).click();
    await expect(ownerActive(page, id)).toBeVisible();

    await staff.reload();
    await expect(readOnlyBar(staff)).toBeVisible();
    await staff.getByRole('button', { name: 'End session' }).click();
    await staff.getByRole('alertdialog').getByRole('button', { name: 'End session' }).click();
    await expect(sessionPage(staff)).toHaveAttribute('data-state', 'ended');
    await expect(view(staff)).toHaveCount(0);
    expect((await supportSessionRow(db.name, id))?.status).toBe('ended');

    await page.goto(`/w/${WORKSPACE}/today`);
    await expect(page.locator('main')).toBeVisible();
    await expect(shellBanner(page)).toHaveCount(0);
  });
});
