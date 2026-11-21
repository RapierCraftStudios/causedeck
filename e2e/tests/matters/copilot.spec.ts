// The matter copilot (#1115), CI only: with `copilot.enabled` on, a question in a seeded matter returns
// either verified claims (source kind, quote, page or paragraph, a link to the corpus record) or "no
// authority found", never an unlabelled claim; axe is clean in every
// viewport and theme project. The answer model is the mock provider (deterministic, grounded).
import { MATTERS } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';

import { openMatters } from './helpers.ts';

const path = `matters/${MATTERS.appeal.id}/copilot`;

test.describe('matter copilot', { tag: '@a11y' }, () => {
  test('asks a question and shows verified claims or no authority; axe is clean', async ({
    page,
    asUser,
    db,
  }) => {
    await withSql(db.name, async (sql) => {
      await sql`
        insert into feature_flag (key, enabled, updated_by)
        values ('copilot.enabled', true, ${e2eUser('owner').id})
        on conflict (key) do update set enabled = true`;
    });
    await openMatters(page, asUser, { path });
    await page.getByLabel(/Your question/).fill('Is written consent needed before surgery?');
    await page.getByRole('button', { name: 'Ask' }).click();
    const claim = page.locator('[data-slot="copilot-claim"]').first();
    const none = page.locator('[data-slot="copilot-no-authority"]');
    await expect(claim.or(none)).toBeVisible();
    if ((await claim.count()) > 0) {
      await expect(claim.locator('[data-slot="copilot-source"]')).toContainText(/page \d+/);
    }
    // Anything the server could not verify is labelled and kept out of the claims.
    for (const row of await page.locator('[data-slot="copilot-unsupported"]').all()) {
      await expect(row).toContainText('Not verified');
    }
  });
});
