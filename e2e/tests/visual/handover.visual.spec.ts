// Handover visual baselines (#71): light and dark at 360, 768 and 1280 px come from the viewport
// and theme projects. Baselines are generated and compared in CI.
import { expect, test } from '../../fixtures/index.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

test.describe('handover visual', { tag: '@visual' }, () => {
  test('sheet', async ({ page, asUser }) => {
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: `matters/${MATTERS.appeal.id}` });
    await contentReady(page);
    await page.getByRole('button', { name: 'Handover' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveScreenshot('handover-sheet.png');
  });
});
