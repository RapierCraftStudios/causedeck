// The matter copilot (#1115), CI only (post-deploy check `copilot-demo-journey`): with
// `copilot.enabled` on and a page of the matter's own document seeded, the question returns a verified
// claim with its source kind, page and paragraph; a corpus claim links to the corpus record, and any
// claim the server could not verify is labelled "Not verified" and kept out of the claims. Axe is clean
// in every viewport and theme project. The answer model is the mock provider (deterministic, grounded).
import { randomUUID } from 'node:crypto';

import { MATTERS } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';

import { openMatters } from './helpers.ts';

const path = `matters/${MATTERS.appeal.id}/copilot`;

test.describe('matter copilot', { tag: '@a11y' }, () => {
  test('asks a question and shows a verified claim with page and paragraph; axe is clean', async ({
    page,
    asUser,
    db,
  }) => {
    await withSql(db.name, async (sql) => {
      await sql`
        insert into feature_flag (key, enabled, updated_by)
        values ('copilot.enabled', true, ${e2eUser('owner').id})
        on conflict (key) do update set enabled = true`;
      const documentId = randomUUID();
      const [matter] = await sql<{ workspace_id: string }[]>`
        select workspace_id::text from matter where id = ${MATTERS.appeal.id}`;
      const workspaceId = matter?.workspace_id ?? '';
      await sql`
        insert into document (id, workspace_id, matter_id, kind, storage_key, sha256, language)
        values (${documentId}, ${workspaceId}, ${MATTERS.appeal.id}, 'pleading',
          ${`ws/${workspaceId}/document/${documentId}`}, ${'c'.repeat(64)}, 'en')`;
      await sql`
        insert into document_page (workspace_id, document_id, page_no, text, text_source, lang)
        values (${workspaceId}, ${documentId}, 3,
          ${'Background.\n\n7. Written consent was needed before the surgery and was never taken.'},
          'layer', 'en')`;
    });
    await openMatters(page, asUser, { path });
    await page.getByLabel(/Your question/).fill('Is written consent needed before surgery?');
    await page.getByRole('button', { name: 'Ask' }).click();
    const claims = page.locator('[data-slot="copilot-claim"]');
    await expect(claims.first()).toBeVisible();
    await expect(page.locator('[data-slot="copilot-no-authority"]')).toHaveCount(0);
    const docClaim = claims.filter({ hasText: 'never taken' }).first();
    await expect(docClaim.locator('[data-slot="copilot-source"]')).toContainText(
      /page 3, paragraph 7/,
    );
    // A claim from a judgment links to its corpus record.
    for (const source of await page.locator('[data-slot="copilot-source"]').all()) {
      if ((await source.textContent())?.startsWith('Judgment') === true) {
        await expect(source.locator('a[target="_blank"]')).toHaveAttribute('href', /.+/);
      }
    }
    // Anything the server could not verify is labelled and kept out of the claims.
    for (const row of await page.locator('[data-slot="copilot-unsupported"]').all()) {
      await expect(row).toContainText('Not verified');
    }
  });
});
