// The Adapters page (#312): registry rows through the AdapterHealthSource with a status chip and the
// last-checked time. The adapter data migrations (Madras, Karnataka, NCLT) seed `access_mode_registry`
// rows, so the test clears the registry first to see the empty state; rows inserted into the worker
// database then show as unknown, never checked.
import postgres from 'postgres';

import { expect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

async function clearRegistry(database: string) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from access_mode_registry`;
  } finally {
    await sql.end();
  }
}

async function registerAdapters(database: string) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into access_mode_registry (adapter_id, resource, mode, enabled)
      values ('madras-hc', 'case-status', 'user_supplied', true),
             ('karnataka-hc', 'a2-retrieval', 'device_user_triggered', false)`;
  } finally {
    await sql.end();
  }
}

test.describe('admin adapters page', () => {
  test('shows the empty state, then registry rows with status chips', async ({ adminAs, db }) => {
    await clearRegistry(db.name);
    const page = await adminAs('staff');
    await page.goto('/adapters');
    await expect(page.getByRole('heading', { level: 1, name: 'Adapters' })).toBeVisible();
    await expect(page.getByText('No adapters registered yet.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    await registerAdapters(db.name);
    await page.reload();
    const rows = page.getByTestId('adapter-row');
    await expect(rows).toHaveCount(2);
    // Ordered by adapter, then resource.
    await expect(rows.nth(0)).toContainText('karnataka-hc');
    await expect(rows.nth(1)).toContainText('madras-hc');
    for (const row of await rows.all()) {
      await expect(row.locator('[data-status="unknown"]')).toHaveText('Unknown');
      await expect(row.getByText('Never checked')).toBeVisible();
    }
    await expect(page.getByRole('status')).toContainText('No health data yet');
    await expect(page.getByText('No adapters registered yet.')).toHaveCount(0);
  });
});
