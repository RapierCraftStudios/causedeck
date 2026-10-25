// Workspace export (#305, wiring #301 and #304). With `workspace.export` on, the owner's export page
// shows `Export everything` and the History card. Requesting needs a recent step-up (passkey or TOTP
// within 10 minutes): with one, the export job is created and audited; without, the card asks
// `Confirm it is you` and nothing is created (the refusal is audited as
// `auth.step_up_required`). While the job builds, the card polls every 3 s and names the step;
// ready, it offers Download (a signed link from the download route, for the requester only) and
// Copy SHA-256; past its 24 h expiry it is gone; failed, it offers Try again. Other roles get the
// permission-denied page and a FORBIDDEN, audited download. The build itself (streaming ZIP in
// bounded memory) runs in the worker and is covered by
// packages/core/src/lifecycle/__tests__/export.memory.test.ts; the e2e stack has no worker, so the
// job's progress is written here with SQL. `@a11y` tests run axe on the page they end on.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import {
  auditActions,
  enableExport,
  insertExport,
  setStepUp,
  updateExport,
  withSql,
  WORKSPACE,
  WORKSPACE_ID,
  userId,
} from './helpers.ts';

const SHA = 'ab'.repeat(32);

async function openExport(page: Page, asUser: AsUser, role: E2eRole = 'owner') {
  await asUser(role, { workspace: WORKSPACE, path: 'settings/export' });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

function ownerExports(database: string): Promise<{ id: string; status: string }[]> {
  return withSql(
    database,
    (sql) =>
      sql<{ id: string; status: string }[]>`
      select id, status from export_job
      where workspace_id = ${WORKSPACE_ID} and requested_by = ${userId('owner')}`,
  );
}

test.describe('workspace export', () => {
  test.beforeEach(async ({ db }) => {
    await enableExport(db.name);
  });

  test(
    'starts empty: helper text, Request export and No exports yet.',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openExport(page, asUser);
      const card = page.locator('[data-slot="export-card"]');
      await expect(card.getByRole('heading', { name: 'Export everything' })).toBeVisible();
      await expect(
        card.getByText(/A ZIP containing your matters, documents, memory and activity/),
      ).toBeVisible();
      await expect(card.getByRole('button', { name: 'Request export' })).toBeEnabled();
      await expect(
        page.locator('[data-slot="export-history"]').getByText('No exports yet.'),
      ).toBeVisible();
    },
  );

  test('with a fresh step-up, Request export creates and audits the export job', async ({
    page,
    asUser,
    db,
  }) => {
    await setStepUp(db.name, 'owner', true);
    await openExport(page, asUser);
    await page.getByRole('button', { name: 'Request export' }).click();
    await expect.poll(async () => (await ownerExports(db.name)).length).toBe(1);
    await expect.poll(() => auditActions(db.name, 'owner')).toContain('export.requested');
  });

  test(
    'without a step-up, the card asks Confirm it is you and creates nothing',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await setStepUp(db.name, 'owner', false);
      await openExport(page, asUser);
      await page.getByRole('button', { name: 'Request export' }).click();
      await expect(page.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Use passkey' })).toBeVisible();
      expect(await ownerExports(db.name)).toEqual([]);
      await expect.poll(() => auditActions(db.name, 'owner')).toContain('auth.step_up_required');
    },
  );

  test('polls the build every 3 s, names each step, then offers Download and Copy SHA-256', async ({
    page,
    asUser,
    db,
  }) => {
    const id = await insertExport(db.name, {
      status: 'running',
      progress: 10,
      phase: 'collecting',
    });
    await openExport(page, asUser);
    const card = page.locator('[data-slot="export-card"]');
    await expect(card.getByText('Collecting records')).toBeVisible();
    await expect(card.getByText(/You can leave this page/)).toBeVisible();
    await expect(card.getByRole('progressbar', { name: 'Export progress' })).toBeVisible();

    await updateExport(db.name, id, { status: 'running', progress: 50, phase: 'files' });
    await expect(card.getByText('Decrypting files')).toBeVisible({ timeout: 10_000 });
    await updateExport(db.name, id, { status: 'running', progress: 90, phase: 'packaging' });
    await expect(card.getByText('Packaging')).toBeVisible({ timeout: 10_000 });
    await updateExport(db.name, id, {
      status: 'ready',
      progress: 100,
      phase: 'ready',
      sizeBytes: 3 * 1024 * 1024,
      sha256: SHA,
      expiresInHours: 24,
    });
    await expect(card.getByRole('heading', { name: 'Your export is ready' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(card.getByText(`causedeck-export-${id}.zip`)).toBeVisible();
    await expect(card.getByText(/3\.0 MB · Expires in 2[34] hours/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Download' })).toBeEnabled();
    await expect(card.getByRole('button', { name: 'Copy SHA-256' })).toBeVisible();

    // The download link is signed for the requester and audited.
    const link = await page.request.post(`/api/exports/${id}/download`, {
      data: { workspaceId: WORKSPACE_ID },
    });
    expect(link.status()).toBe(200);
    const body = (await link.json()) as { url: string };
    expect(body.url).toMatch(new RegExp(`^/api/exports/${id}/download\\?token=`));
    await expect
      .poll(() => auditActions(db.name, 'owner'))
      .toContain('export.download_link_issued');
  });

  test('an export past its 24 h expiry cannot be downloaded', async ({ page, asUser, db }) => {
    const id = await insertExport(db.name, {
      status: 'ready',
      progress: 100,
      phase: 'ready',
      sizeBytes: 2048,
      sha256: SHA,
      expiresInHours: -1,
    });
    await openExport(page, asUser);
    await expect(page.getByRole('button', { name: 'Download' })).toHaveCount(0);
    await expect(page.locator('[data-slot="export-history"]').getByText('Expired')).toBeVisible();
    const link = await page.request.post(`/api/exports/${id}/download`, {
      data: { workspaceId: WORKSPACE_ID },
    });
    expect(link.status()).toBe(404);
  });

  test('a failed export offers Try again', { tag: '@a11y' }, async ({ page, asUser, db }) => {
    await insertExport(db.name, { status: 'failed' });
    await openExport(page, asUser);
    const failed = page.locator('[data-slot="export-failed"]');
    await expect(failed.getByText('The export did not finish.')).toBeVisible();
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  test('offline, Request export is disabled with Needs a connection', async ({ page, asUser }) => {
    await openExport(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByRole('button', { name: 'Request export' })).toBeDisabled();
    await expect(page.getByText('Needs a connection')).toBeVisible();
    await page.context().setOffline(false);
  });

  for (const role of ['advocate', 'clerk'] as const) {
    test(`a ${role} is denied the page and the download, and the denial is audited`, async ({
      page,
      asUser,
      db,
    }) => {
      const id = await insertExport(db.name, {
        status: 'ready',
        progress: 100,
        sizeBytes: 2048,
        sha256: SHA,
        expiresInHours: 24,
      });
      await openExport(page, asUser, role);
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(
        page.getByText('Only workspace owners can export or delete this workspace.'),
      ).toBeVisible();
      const link = await page.request.post(`/api/exports/${id}/download`, {
        data: { workspaceId: WORKSPACE_ID },
      });
      expect(link.status()).toBe(403);
      await expect.poll(() => auditActions(db.name, role)).toContain('access.denied');
    });
  }
});
