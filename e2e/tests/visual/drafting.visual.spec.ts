// Drafting visual baselines (#829): the drafts list and the studio. Light and dark at 360, 768 and
// 1280 px come from the viewport and theme projects. The ack and export dialog baselines wait for
// #828. Baselines are generated and compared in CI.
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

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
});
