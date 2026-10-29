// Drafting visual baselines (#829): the drafts list and the studio. Light and dark at 360, 768 and
// 1280 px come from the viewport and theme projects. The ack and export dialogs follow (#910).
// Baselines are generated and compared in CI.
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';
import {
  CITED_STUDIO,
  checkCitations,
  citationPanel,
  seedCitedDraft,
} from '../product/drafting-helpers.ts';

test.describe('drafting visual', { tag: '@visual' }, () => {
  test('drafts list', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: 'drafts' });
    await contentReady(page);
    await expect(page).toHaveScreenshot('drafts-list.png', { fullPage: true });
  });

  test('studio', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: `drafts/${DRAFTING.draft.id}` });
    await contentReady(page);
    await expect(page).toHaveScreenshot('studio.png', { fullPage: true });
  });

  test('ack dialog', async ({ page, asUser, db }) => {
    await seedCitedDraft(db.name);
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: CITED_STUDIO });
    await contentReady(page);
    await checkCitations(page);
    await citationPanel(page)
      .getByRole('button', { name: 'Acknowledge not-found citations' })
      .click();
    const dialog = page.locator('[data-slot="ack-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveScreenshot('ack-dialog.png', { animations: 'disabled' });
  });

  test('export dialog', async ({ page, asUser, db }) => {
    await seedCitedDraft(db.name);
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: CITED_STUDIO });
    await contentReady(page);
    await checkCitations(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.locator('[data-slot="export-dialog"]')).toBeVisible();
    await expect(page).toHaveScreenshot('export-dialog.png', { animations: 'disabled' });
  });
});
