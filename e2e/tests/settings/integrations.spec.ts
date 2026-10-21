// Settings integrations page (#287): `/w/<slug>/settings/integrations` shows the private email
// intake address and ICS feed cards with masked placeholders. With a card's flag off it reads
// `Not enabled yet` and cannot rotate. With the flags on, an owner creates a token (the full value
// is shown once and gone after a reload) and rotates it through a confirm dialog that names the
// effect; the rotation lands in the audit log. Clerks and viewers get the permission-denied page.
// States: loading and error (dev previews), offline (disabled with the reason). `@a11y` tests run
// axe on the page they end on, including the open rotate dialog. Every test starts from the reset
// e2e seed, where every flag is off.
import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const FLAGS = ['capture.email-forward', 'capture.ics-feed'] as const;

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

const card = (page: Page, kind: 'email_intake' | 'ics_feed') =>
  page.locator(`[data-slot="integration-${kind}"]`);
const feedValue = (page: Page) => page.getByRole('textbox', { name: 'Feed URL' });

test.describe('settings integrations', () => {
  test(
    'flags off: both cards read Not enabled yet and cannot rotate',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openIntegrations(page, asUser);
      for (const kind of ['email_intake', 'ics_feed'] as const) {
        await expect(card(page, kind).getByText('Not enabled yet')).toBeVisible();
        await expect(card(page, kind).getByRole('button', { name: 'Create' })).toBeDisabled();
      }
      await expect(page.getByRole('textbox', { name: 'Intake address' })).toHaveValue(
        /^intake\+••••••••@/,
      );
      await expect(feedValue(page)).toHaveValue(/\/api\/ics\/••••••••$/);
    },
  );

  test(
    'an owner creates the feed link, sees it once, then rotates it through the dialog',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableFlags(db.name);
      await openIntegrations(page, asUser);
      await expect(card(page, 'ics_feed').getByText('Not enabled yet')).toHaveCount(0);
      await expect(card(page, 'ics_feed').getByText('Not created yet.')).toBeVisible();

      await card(page, 'ics_feed').getByRole('button', { name: 'Create' }).click();
      await expect(feedValue(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
      const first = await feedValue(page).inputValue();
      await expect(
        page.getByText('This is shown only once. Copy it now and keep it private.'),
      ).toBeVisible();
      await expect(card(page, 'ics_feed').getByRole('button', { name: 'Copy' })).toBeVisible();

      // Only the hash is stored: after a reload the link is masked again.
      await page.reload();
      await expect(feedValue(page)).toHaveValue(/\/api\/ics\/••••••••$/);
      await expect(card(page, 'ics_feed').getByText(/^Created on /)).toBeVisible();

      await card(page, 'ics_feed').getByRole('button', { name: 'Rotate' }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Rotate the calendar feed link?' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('the current one stops working at once');
      await dialog.getByRole('button', { name: 'Rotate' }).click();
      await expect(dialog).toBeHidden();
      await expect(feedValue(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
      expect(await feedValue(page).inputValue()).not.toBe(first);
      await expect(card(page, 'ics_feed').getByText(/^Last rotated on /)).toBeVisible();

      await page.goto(`/w/${SHELL_WORKSPACE}/activity`);
      await expect(page.getByText('workspace.integration_token_rotated').first()).toBeVisible();
    },
  );

  test(
    'the rotate dialog has no serious axe violations',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableFlags(db.name);
      await openIntegrations(page, asUser);
      await card(page, 'email_intake').getByRole('button', { name: 'Create' }).click();
      await expect(page.getByRole('textbox', { name: 'Intake address' })).toHaveValue(
        /^intake\+[\w-]{43}@/,
      );
      await card(page, 'email_intake').getByRole('button', { name: 'Rotate' }).click();
      // The test ends with the dialog open, so the axe pass covers it.
      await expect(
        page.getByRole('alertdialog', { name: 'Rotate the intake address?' }),
      ).toBeVisible();
    },
  );

  test('an advocate can create a token', async ({ page, asUser, db }) => {
    await enableFlags(db.name);
    await openIntegrations(page, asUser, 'advocate');
    await card(page, 'ics_feed').getByRole('button', { name: 'Create' }).click();
    await expect(feedValue(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
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

  test('offline: the buttons are disabled with the banner', async ({ page, asUser, db }) => {
    await enableFlags(db.name);
    await openIntegrations(page, asUser);
    await page.context().setOffline(true);
    await expect(
      page.getByText('Settings can be changed when you are back online.').first(),
    ).toBeVisible();
    await expect(card(page, 'ics_feed').getByRole('button', { name: 'Create' })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(card(page, 'ics_feed').getByRole('button', { name: 'Create' })).toBeEnabled();
  });

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
    await card(page, 'ics_feed').getByRole('button', { name: 'Create' }).click();
    await expect(feedValue(page)).toHaveValue(/\/api\/ics\/[\w-]{43}$/);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
