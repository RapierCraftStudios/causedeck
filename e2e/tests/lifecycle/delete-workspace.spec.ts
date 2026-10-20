// Workspace deletion (#305, wiring #302 and #304). The owner's danger zone lists the consequences
// and `Delete workspace` opens a 3-step dialog: the export reminder, `Confirm it is you` (passkey or
// TOTP within 10 minutes) and the workspace name typed exactly; `Delete` is enabled only when all
// three are done. The request starts a 14-day cooling-off: a `pending_cooloff` job, an in-app
// notice to every owner, and a persistent banner for every member on every workspace page. Nothing
// is erased before the cool-off ends: the workspace and its data stay readable. Any owner cancels
// from the danger zone (step-up again) and the banner goes. A step-up that has gone stale by the
// time Delete is pressed is refused, audited, and sends the dialog back to step 2. Other roles get
// the permission-denied page. The owner turns on TOTP through the #289 setup dialog first, then
// confirms with codes computed from its secret. `@a11y` tests run axe on the page they end on.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import {
  auditActions,
  confirmWithCode,
  enrollTotp,
  setStepUp,
  userId,
  withSql,
  WORKSPACE,
  WORKSPACE_ID,
  WORKSPACE_NAME,
} from './helpers.ts';

const BANNER = '[data-slot="cooloff-banner"]';

async function open(page: Page, asUser: AsUser, path: string, role: E2eRole = 'owner') {
  await asUser(role, { workspace: WORKSPACE, path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

async function openDanger(page: Page) {
  await page.goto(`/w/${WORKSPACE}/settings/danger`);
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
}

interface DeletionRow {
  id: string;
  status: string;
  days: number;
}

function deletions(database: string): Promise<DeletionRow[]> {
  return withSql(
    database,
    (sql) =>
      sql<DeletionRow[]>`
      select id, status,
             round(extract(epoch from (cooloff_until - created_at)) / 86400)::int as days
      from deletion_job where workspace_id = ${WORKSPACE_ID} and kind = 'workspace'`,
  );
}

/** Open the dialog and walk steps 1 and 2 (export reminder, then a TOTP code). */
async function throughStepUp(page: Page, secret: string): Promise<Locator> {
  await page
    .locator('[data-slot="delete-workspace-card"]')
    .getByRole('button', { name: 'Delete workspace' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Delete this workspace' });
  const next = dialog.getByRole('button', { name: 'Next' });
  await expect(dialog.getByText('Step 1 of 3')).toBeVisible();
  await expect(next).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await next.click();
  await expect(dialog.getByText('Step 2 of 3')).toBeVisible();
  await expect(next).toBeDisabled();
  await confirmWithCode(dialog, secret);
  await expect(dialog.getByText('Confirmed. You can continue.')).toBeVisible();
  await next.click();
  await expect(dialog.getByText('Step 3 of 3')).toBeVisible();
  return dialog;
}

test.describe('workspace deletion', () => {
  test(
    'the dialog enables Delete only after the export reminder, step-up and the exact name',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await open(page, asUser, 'today');
      const secret = await enrollTotp(page);
      await openDanger(page);
      const dialog = await throughStepUp(page, secret);
      const remove = dialog.getByRole('button', { name: 'Delete', exact: true });
      await expect(remove).toBeDisabled();
      await dialog.getByLabel('Workspace name').fill(WORKSPACE_NAME.toLowerCase());
      await expect(remove).toBeDisabled();
      await dialog.getByLabel('Workspace name').fill(WORKSPACE_NAME);
      await expect(remove).toBeEnabled();
      expect(await deletions(db.name)).toEqual([]);
    },
  );

  test('the request starts a 14-day cool-off, notifies owners, erases nothing and shows the banner', async ({
    page,
    asUser,
    db,
  }) => {
    await open(page, asUser, 'today');
    const secret = await enrollTotp(page);
    await openDanger(page);
    const dialog = await throughStepUp(page, secret);
    await dialog.getByLabel('Workspace name').fill(WORKSPACE_NAME);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden();

    const [job] = await deletions(db.name);
    expect(job).toMatchObject({ status: 'pending_cooloff', days: 14 });
    await expect
      .poll(() => auditActions(db.name, 'owner'))
      .toContain('workspace.deletion_requested');
    // Every owner gets the in-app notice.
    const notices = await withSql(
      db.name,
      (sql) =>
        sql<{ user_id: string }[]>`
        select user_id from notification
        where workspace_id = ${WORKSPACE_ID}
          and dedupe_key = ${`workspace-deletion:${job?.id ?? ''}:requested`}`,
    );
    expect(notices.map((n) => n.user_id)).toEqual([userId('owner')]);
    // Nothing is erased during the cool-off: the workspace and its members are all still there.
    const remaining = await withSql(
      db.name,
      (sql) =>
        sql<{ members: number; deleted: boolean }[]>`
        select (select count(*)::int from member where organization_id = o.id) as members,
               o.deleted_at is not null as deleted
        from organization o where o.id = ${WORKSPACE_ID}`,
    );
    expect(remaining[0]?.deleted).toBe(false);
    expect(remaining[0]?.members).toBeGreaterThan(1);

    // The banner on every page: the owner gets the cancel link, a clerk does not.
    const card = page.locator('[data-slot="delete-workspace-card"]');
    await expect(card.getByText(/Scheduled for deletion on/)).toBeVisible();
    await page.goto(`/w/${WORKSPACE}/today`);
    const banner = page.locator(BANNER);
    await expect(banner).toContainText('Scheduled for deletion on');
    await expect(banner).toContainText('Cancel any time before then.');
    await expect(banner.getByRole('link', { name: 'Cancel deletion' })).toHaveAttribute(
      'href',
      `/w/${WORKSPACE}/settings/danger`,
    );
    await open(page, asUser, 'matters', 'clerk');
    await expect(page.locator(BANNER)).toContainText('Scheduled for deletion on');
    await expect(page.locator(BANNER).getByRole('link')).toHaveCount(0);
  });

  test(
    'an owner cancels from the danger zone after step-up and the banner goes',
    {
      tag: '@a11y',
    },
    async ({ page, asUser, db }) => {
      await open(page, asUser, 'today');
      const secret = await enrollTotp(page);
      await openDanger(page);
      const dialog = await throughStepUp(page, secret);
      await dialog.getByLabel('Workspace name').fill(WORKSPACE_NAME);
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.locator(BANNER)).toBeVisible();

      // The step-up has gone stale by now: cancelling asks again, then cancels.
      await setStepUp(db.name, 'owner', false);
      const card = page.locator('[data-slot="delete-workspace-card"]');
      await card.getByRole('button', { name: 'Cancel deletion' }).click();
      await expect(card.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
      // A new 30 s window, so the code differs from the one just used.
      await page.waitForTimeout(31_000);
      await confirmWithCode(card, secret);
      await expect(page.locator(BANNER)).toHaveCount(0, { timeout: 10_000 });
      const [job] = await deletions(db.name);
      expect(job?.status).toBe('cancelled');
      await expect
        .poll(() => auditActions(db.name, 'owner'))
        .toContain('workspace.deletion_cancelled');
    },
  );

  test('a step-up gone stale before Delete is refused, audited and asks again', async ({
    page,
    asUser,
    db,
  }) => {
    await open(page, asUser, 'today');
    const secret = await enrollTotp(page);
    await openDanger(page);
    const dialog = await throughStepUp(page, secret);
    await setStepUp(db.name, 'owner', false);
    await dialog.getByLabel('Workspace name').fill(WORKSPACE_NAME);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog.getByText('Step 2 of 3')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
    expect(await deletions(db.name)).toEqual([]);
    await expect.poll(() => auditActions(db.name, 'owner')).toContain('auth.step_up_required');
  });

  for (const role of ['advocate', 'clerk'] as const) {
    test(`a ${role} is denied the danger zone`, async ({ page, asUser }) => {
      await open(page, asUser, 'settings/danger', role);
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(
        page.getByText('Only workspace owners can export or delete this workspace.'),
      ).toBeVisible();
    });
  }
});
