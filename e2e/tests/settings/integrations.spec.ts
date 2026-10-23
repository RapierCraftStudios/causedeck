// Settings integrations page (#287): `/w/<slug>/settings/integrations` shows two entry cards, one
// that links to the per-member email intake page (#54) and
// the calendar feed card, which only links to the calendar page (#53,
// e2e/tests/settings/calendar.spec.ts). The calendar card reads `Not enabled yet` until its flag is
// on. Clerks and viewers get the permission-denied page. States: loading and error (dev previews).
// `@a11y` tests run axe on the page they end on. Every test starts from the reset e2e seed, where
// every flag is off.
import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const FLAGS = ['capture.ics-feed'] as const;

/** Turn the integration flags on for the shell workspace (a workspace override row each). */
async function enableFlags(database: string): Promise<void> {
  // The superuser bypasses row-level security, so the seed rows can be written directly. The
  // insert fires `flag_changed`, which empties the server's flag cache.
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    for (const key of FLAGS) {
      await sql`
        insert into workspace_feature_flag (workspace_id, key, enabled, updated_by)
        select o.id, ${key}, true, m.user_id
          from organization o
          join member m on m.workspace_id = o.id and m.role = 'owner'
         where o.slug = ${SHELL_WORKSPACE}
         limit 1`;
    }
  } finally {
    await sql.end();
  }
}

async function openIntegrations(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `settings/integrations${query}` });
  await expect(
    page.locator('main').getByRole('heading', { level: 1, name: 'Integrations' }),
  ).toBeVisible();
  await shellReady(page);
}

const card = (page: Page, kind: 'ics_feed') => page.locator(`[data-slot="integration-${kind}"]`);

test.describe('settings integrations', () => {
  test(
    'flag off: the calendar card reads Not enabled yet and the email card links on',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openIntegrations(page, asUser);
      await expect(
        card(page, 'ics_feed').getByText('Not enabled yet', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open calendar settings' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute(
        'href',
        /\/settings\/integrations\/email$/,
      );
    },
  );

  test('flag on: the calendar card links to the calendar page', async ({ page, asUser, db }) => {
    await enableFlags(db.name);
    await openIntegrations(page, asUser);
    await expect(card(page, 'ics_feed').getByText('Not enabled yet')).toHaveCount(0);
    await card(page, 'ics_feed').getByRole('link', { name: 'Open calendar settings' }).click();
    await expect(page).toHaveURL(/\/settings\/integrations\/calendar$/);
  });

  test('the email card opens the email intake page', async ({ page, asUser }) => {
    await openIntegrations(page, asUser);
    await page.getByRole('link', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/integrations\/email$/);
  });

  for (const role of ['clerk', 'viewer'] as const) {
    test(
      `a ${role} gets the permission-denied page`,
      { tag: '@a11y' },
      async ({ page, asUser }) => {
        await asUser(role, { path: 'settings/integrations' });
        await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
          'No access',
        );
      },
    );
  }

  test('loading and error states (dev previews)', async ({ page, asUser }) => {
    await openIntegrations(page, asUser, 'owner', '?__state=loading');
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await page.goto(`/w/${SHELL_WORKSPACE}/settings/integrations?__state=error`);
    await expect(page.getByText('Could not load the integrations.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('never scrolls sideways', async ({ page, asUser, db }) => {
    await enableFlags(db.name);
    await openIntegrations(page, asUser);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
