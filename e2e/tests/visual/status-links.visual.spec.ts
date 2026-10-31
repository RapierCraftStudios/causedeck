// Status link visual baselines (#88): light and dark at 360, 768 and 1280 px come from the viewport
// and theme projects. Baselines are generated and compared in CI.
import { expect, test } from '../../fixtures/index.ts';

test.describe('status links visual', { tag: '@visual' }, () => {
  test('unavailable page', async ({ page }) => {
    await page.goto('/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(page).toHaveScreenshot('status-link-unavailable.png', { fullPage: true });
  });
});
