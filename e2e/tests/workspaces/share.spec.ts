// Brief sharing (#507): `/share/<token>` against the seeded shares of chennai-solo
// (packages/db/src/seed/e2e.ts). A signed-out visitor sees only the sanitised snapshot and a
// sign-in invitation; expired and revoked links each show their own dead end; a signed-in user
// imports the matter into their own workspace, which activates the referral.
import { E2E_SHARES, E2E_SHARE_TITLE } from '@causedeck/db/seed/e2e';

import { expect, test } from '../../fixtures/index.ts';

const sharePath = (token: string) => `/share/${token}`;

test.describe('shared brief link', () => {
  test('a non-user sees the snapshot and is invited to join', async ({ page }) => {
    await page.goto(sharePath(E2E_SHARES.valid.token));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(E2E_SHARE_TITLE);
    await expect(page.getByRole('link', { name: /Join CauseDeck/ })).toBeVisible();
    await expect(page.getByText('chennai-solo')).toHaveCount(0);
  });

  for (const [state, text] of [
    ['expired', 'This link has expired'],
    ['revoked', 'The sender has withdrawn this link'],
  ] as const) {
    test(`a ${state} link shows its own message`, async ({ page }) => {
      await page.goto(sharePath(E2E_SHARES[state].token));
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByText(E2E_SHARE_TITLE)).toHaveCount(0);
    });
  }

  test('a signed-in user imports the matter into their workspace', async ({ page, asUser }) => {
    await asUser('owner', { workspace: 'bengaluru-chamber' });
    await page.goto(sharePath(E2E_SHARES.valid.token));
    await page.getByRole('button', { name: 'Import this matter' }).click();
    await expect(page).toHaveURL(/\/w\/bengaluru-chamber\/matters\//);
  });
});
