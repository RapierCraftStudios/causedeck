// Accept an invitation (#180): `/invite/<token>` against the seeded invitations to chennai-solo for
// the bengaluru-chamber viewer (packages/db/src/seed/e2e.ts). A matching signed-in user joins with
// the invited role; another email is rejected; expired, revoked and used tokens each show their
// own state; a signed-out visitor goes through sign-in and comes back to accept.
import { E2E_INVITATIONS } from '@causedeck/db/seed/e2e';
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { shellReady, switcherList, switcherTrigger } from '../shell/helpers.ts';

const valid = E2E_INVITATIONS.valid;
const invitePath = (token: string) => `/invite/${token}`;
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

async function expectJoinedAsJunior(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/w\/chennai-solo\/today$/);
  await expect(page.locator('main')).toHaveAttribute('data-workspace-slug', 'chennai-solo');
  await shellReady(page);
  await switcherTrigger(page).click();
  const joined = switcherList(page).locator('[data-slug="chennai-solo"]');
  await expect(joined).toBeVisible();
  await expect(joined.locator('[data-role]')).toHaveText('Junior');
}

test.describe('accept invitation', () => {
  test('the invited user accepts and joins with the invited role, once', async ({
    page,
    asUser,
  }) => {
    await asUser('viewer', { workspace: 'bengaluru-chamber' });
    await page.goto(invitePath(valid.token));
    await expect(page.locator('main')).toHaveAttribute('data-invite-state', 'valid');
    await expect(heading(page)).toHaveText('Join Meenakshi Iyer Law Practice');
    await expect(page.locator('[data-role="junior"]')).toHaveText('Junior');

    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expectJoinedAsJunior(page);

    // Single-use: the same link now shows the used state.
    await page.goto(invitePath(valid.token));
    await expect(page.locator('main')).toHaveAttribute('data-invite-state', 'used');
    await expect(heading(page)).toHaveText('This invitation has already been used');
  });

  test('a different signed-in email is rejected with a clear message', async ({ page, asUser }) => {
    await asUser('viewer', { workspace: 'chennai-solo' });
    await page.goto(invitePath(valid.token));
    await expect(page.locator('main')).toHaveAttribute('data-invite-state', 'email_mismatch');
    await expect(heading(page)).toHaveText('This invitation is for a different email');
    await expect(page.getByText('You are signed in as viewer@chennai-solo.e2e.test')).toBeVisible();
    await expect(page.getByText(valid.email)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Sign in with a different account' }),
    ).toBeVisible();
  });

  for (const [state, title] of [
    ['expired', 'This invitation has expired'],
    ['revoked', 'This invitation was withdrawn'],
    ['used', 'This invitation has already been used'],
  ] as const) {
    test(`a ${state} token shows its own state`, async ({ page, asUser }) => {
      await asUser('viewer', { workspace: 'bengaluru-chamber' });
      await page.goto(invitePath(E2E_INVITATIONS[state].token));
      await expect(page.locator('main')).toHaveAttribute('data-invite-state', state);
      await expect(heading(page)).toHaveText(title);
      await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
    });
  }

  test('an unknown token is not valid', async ({ page, asUser }) => {
    await asUser('viewer', { workspace: 'bengaluru-chamber' });
    await page.goto(invitePath('not-a-real-token'));
    await expect(page.locator('main')).toHaveAttribute('data-invite-state', 'invalid');
    await expect(heading(page)).toHaveText('This invitation link is not valid');
  });

  test('signed out, the invite goes through sign-in and completes after it', async ({
    page,
    readMagicLink,
  }) => {
    await page.goto(invitePath(valid.token));
    await expect(page).toHaveURL(`/sign-in?next=${encodeURIComponent(invitePath(valid.token))}`);
    await page.getByLabel('Email', { exact: true }).fill(valid.email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText(valid.email)).toBeVisible();

    await page.goto(await readMagicLink(valid.email));
    await expect(page).toHaveURL((url) => url.pathname === invitePath(valid.token));
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expectJoinedAsJunior(page);
  });
});
