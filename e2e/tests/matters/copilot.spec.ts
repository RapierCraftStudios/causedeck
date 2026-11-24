// The matter copilot (#1115), CI only (post-deploy check `copilot-demo-journey`): with
// `copilot.enabled` on and a page of the matter's own document seeded, the question returns a verified
// claim with its source kind, page and paragraph; a corpus claim links to the corpus record, and any
// claim the server could not verify is labelled "Not verified" and kept out of the claims. Axe is clean
// in every viewport and theme project. The answer model is the mock provider (deterministic, grounded).
// #1168: the answer is prose with citation chips; the sources sit in a rail from `lg` up and open in a
// Sheet below it. At 390px the page never scrolls sideways.
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { MATTERS } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';

import { openMatters } from './helpers.ts';

const path = `matters/${MATTERS.appeal.id}/copilot`;

/** Turns the copilot on and seeds page 3 of a document of the matter. */
async function seed(db: { name: string }): Promise<void> {
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
}

/** Asks the question; returns the visible sources (the rail, or the sheet it opens below lg). */
async function ask(page: Page) {
  await page.getByLabel(/Your question/).fill('Is written consent needed before surgery?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.locator('[data-slot="copilot-answer"]').first()).toBeVisible();
  const open = page.locator('[data-slot="copilot-sources-open"]').first();
  if (await open.isVisible()) await open.click();
  return page.locator('[data-slot="copilot-claim"]:visible');
}

test.describe('matter copilot', { tag: '@a11y' }, () => {
  test('asks a question and shows a verified claim with page and paragraph; axe is clean', async ({
    page,
    asUser,
    db,
  }) => {
    await seed(db);
    await openMatters(page, asUser, { path });
    const claims = await ask(page);
    await expect(claims.first()).toBeVisible();
    // Every chip names a verified source; there is no bare [n] in the prose.
    await expect(page.locator('[data-slot="copilot-answer"]').first()).not.toContainText(/\[\d+\]/);
    await expect(page.locator('[data-slot="copilot-no-authority"]')).toHaveCount(0);
    const docClaim = claims.filter({ hasText: 'never taken' }).first();
    await expect(docClaim.locator('[data-slot="copilot-source"]')).toContainText(/page 3 · para 7/);
    // A claim from a judgment links to its corpus record.
    for (const source of await claims.locator('[data-slot="copilot-source"]').all()) {
      if ((await source.textContent())?.startsWith('Judgment') === true) {
        await expect(source.locator('a[target="_blank"]')).toHaveAttribute('href', /.+/);
      }
    }
    // Anything the server could not verify is labelled and kept out of the claims (collapsed group).
    const notVerified = page
      .getByRole('button', { name: /^Not verified/ })
      .filter({ visible: true });
    if ((await notVerified.count()) > 0) await notVerified.first().click();
    for (const row of await page.locator('[data-slot="copilot-unsupported"]').all()) {
      await expect(row).toContainText('Not verified');
    }
  });

  test('at 390px the page does not scroll sideways and the sources open in a sheet', async ({
    page,
    asUser,
    db,
  }) => {
    await seed(db);
    await page.setViewportSize({ width: 390, height: 844 });
    await openMatters(page, asUser, { path });
    const noSideScroll = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    expect(await noSideScroll()).toBe(true);
    await expect(page.locator('[data-slot="copilot-rail"]')).toBeHidden();
    const claims = await ask(page);
    await expect(page.locator('[data-slot="copilot-sources-sheet"]')).toBeVisible();
    await expect(claims.first()).toBeVisible();
    expect(await noSideScroll()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await noSideScroll()).toBe(true);
  });
});
