// Memory wiring (#74): the carry suggestion, its citation chip and the one-click remove. Runs in CI
// only (Playwright is never run on the shared build host).
import { expect, test } from '@playwright/test';

test.describe('memory wiring in the brief', () => {
  test.fixme(
    true,
    'Needs a seeded confirmed M2 always_carry rule; enabled with the product seed in CI',
  );

  test('a carry rule shows its citation chip and can be removed', async ({ page }) => {
    await page.goto('/');
    const chip = page.locator('[data-memory-citation]').first();
    await expect(chip).toHaveAccessibleName(/because you usually carry this/i);
    await page
      .getByRole('button', { name: /^Remove / })
      .first()
      .click();
    await expect(chip).toHaveCount(0);
  });
});
