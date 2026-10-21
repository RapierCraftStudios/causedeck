// Flag management in the staff console (#311, acceptance from #27):
//   - toggling global and workspace flags works, each after a diff confirmation;
//   - kill switches (env) display as `Forced off by environment` (the e2e admin server sets
//     KILL_INSIGHTS_ENABLED, support/server-pool.ts);
//   - enabling a legal-gated flag needs a note, an acknowledgement and a fresh TOTP code, and only
//     takes effect once a second staff member with the `admin` role approves it;
//   - every change is audited with actor, old and new value.
import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { ADMIN_FIXTURES, E2E_WORKSPACES, expect, test, totpCode } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

interface AuditRow {
  action: string;
  actor_email: string;
  target_id: string | null;
  workspace_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** The flag audit events, oldest first, read as the superuser (RLS does not apply). */
async function flagAudit(database: string): Promise<AuditRow[]> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await sql<AuditRow[]>`
      select e.action, u.email as actor_email, e.target_id, e.workspace_id, e.metadata
        from audit_event e join "user" u on u.id = e.actor_user_id
       where e.action like 'flag.%'
       order by e.id`;
  } finally {
    await sql.end();
  }
}

async function toggle(page: Page, table: string, key: string, to: 'on' | 'off') {
  const row = page.getByRole('table', { name: table }).getByTestId(`flag-row-${key}`);
  await row.getByRole('switch', { name: `${key}: turn ${to}` }).click();
  return page.getByRole('dialog');
}

test.describe('admin flags', () => {
  test('toggles global and workspace flags after a diff, and shows kill switches', async ({
    adminAs,
    db,
  }) => {
    const page = await adminAs('ops');
    await page.goto('/flags');
    await expect(page.getByRole('heading', { name: 'Flags', level: 1 })).toBeVisible();

    const killed = page
      .getByRole('table', { name: 'Global flags' })
      .getByTestId('flag-row-insights.enabled');
    await expect(killed.getByText('Forced off by environment')).toBeVisible();
    await expect(killed.getByText('KILL_INSIGHTS_ENABLED')).toBeVisible();
    await expect(killed.getByRole('switch')).toBeDisabled();

    let dialog = await toggle(page, 'Global flags', 'pwa.offline', 'on');
    await expect(dialog.getByTestId('flag-diff')).toHaveText(
      'pwa.offline · Global · Off (default) → On',
    );
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole('table', { name: 'Global flags' })
        .getByRole('switch', { name: 'pwa.offline: turn off' }),
    ).toBeChecked();

    const workspaceId = E2E_WORKSPACES['chennai-solo'].id;
    await page.getByLabel('Workspace id').fill(workspaceId);
    await page.getByRole('button', { name: 'Show overrides' }).click();
    const overrides = `Overrides for workspace ${workspaceId}`;
    dialog = await toggle(page, overrides, 'pwa.offline', 'on');
    await expect(dialog.getByTestId('flag-diff')).toHaveText(
      `pwa.offline · Workspace ${workspaceId} · Inherit → On`,
    );
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('table', { name: overrides }).getByRole('switch', {
        name: 'pwa.offline: turn off',
      }),
    ).toBeChecked();

    const changed = (await flagAudit(db.name)).filter((r) => r.action === 'flag.changed');
    expect(changed).toEqual([
      expect.objectContaining({
        actor_email: ADMIN_FIXTURES.ops.email,
        target_id: 'pwa.offline',
        workspace_id: null,
        metadata: expect.objectContaining({ oldValue: null, newValue: true }),
      }),
      expect.objectContaining({
        actor_email: ADMIN_FIXTURES.ops.email,
        target_id: 'pwa.offline',
        workspace_id: workspaceId,
        metadata: expect.objectContaining({ oldValue: null, newValue: true }),
      }),
    ]);
  });

  test('a legal-gated enable needs a note, an acknowledgement, TOTP and a second admin', async ({
    adminAs,
    db,
  }) => {
    const ops = await adminAs('ops');
    await ops.goto('/flags');
    const dialog = await toggle(ops, 'Global flags', 'limitation.enabled', 'on');
    await expect(dialog.getByText(/second admin before it takes effect/)).toBeVisible();
    const send = dialog.getByRole('button', { name: 'Send for approval' });
    await expect(send).toBeDisabled();
    await dialog.getByLabel('Legal note').fill('Counsel rule tables delivered (#120)');
    await dialog.getByRole('checkbox').click();
    await dialog.getByLabel('Authenticator code').fill(totpCode());
    await send.click();
    await expect(dialog).toBeHidden();

    // Still off: nothing applies until a second admin approves.
    await expect(
      ops
        .getByRole('table', { name: 'Global flags' })
        .getByRole('switch', { name: 'limitation.enabled: turn on' }),
    ).not.toBeChecked();
    const pendingForOps = ops.getByRole('table', { name: 'Pending approvals' });
    await expect(pendingForOps.getByText('limitation.enabled')).toBeVisible();
    await expect(pendingForOps.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    const admin = await adminAs('staff');
    await admin.goto('/flags');
    const pending = admin.getByRole('table', { name: 'Pending approvals' });
    await expect(pending.getByText('Counsel rule tables delivered (#120)')).toBeVisible();
    await pending.getByRole('button', { name: 'Approve' }).click();
    const approve = admin.getByRole('dialog');
    await expect(approve.getByTestId('approve-diff')).toHaveText(
      'limitation.enabled · Global · Off → On',
    );
    await approve.getByLabel('Authenticator code').fill(totpCode());
    await approve.getByRole('button', { name: 'Approve and apply' }).click();
    await expect(approve).toBeHidden();
    await expect(admin.getByText('No pending approvals.')).toBeVisible();
    await expect(
      admin
        .getByRole('table', { name: 'Global flags' })
        .getByRole('switch', { name: 'limitation.enabled: turn off' }),
    ).toBeChecked();

    const audit = await flagAudit(db.name);
    expect(audit.map((r) => [r.action, r.actor_email])).toEqual([
      ['flag.change_requested', ADMIN_FIXTURES.ops.email],
      ['flag.changed', ADMIN_FIXTURES.staff.email],
      ['flag.change_approved', ADMIN_FIXTURES.staff.email],
    ]);
    expect(audit[1]).toMatchObject({
      target_id: 'limitation.enabled',
      metadata: expect.objectContaining({ oldValue: null, newValue: true, legalAck: true }),
    });
    expect(JSON.stringify(audit)).not.toContain('Counsel rule tables');
  });
});
