// Brief Sheet visual baselines (#61): light and dark at 360, 768 and 1280 px come from the viewport
// and theme projects. Baselines are generated and compared in CI.
import { expect, test } from '../../fixtures/index.ts';
import { openBrief } from '../product/brief-helpers.ts';

test.describe('brief sheet visual', { tag: '@visual' }, () => {
  test('default', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await expect(page).toHaveScreenshot('brief-sheet.png', { fullPage: true });
  });
});
