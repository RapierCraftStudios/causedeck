// Clerk-led onboarding (#505) on a phone: the clerk of chennai-solo (seeded membership) opens the
// welcome page in Tamil, asks for approval, and the senior approves with one tap. Runs in CI.
import { expect, test } from '../../fixtures/index.ts';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('clerk-led onboarding', () => {
  test('the clerk finishes the Tamil setup and the senior approves with one tap', async ({
    page,
    asUser,
  }) => {
    await asUser('clerk', { workspace: 'chennai-solo' });
    await page.goto('/w/chennai-solo/welcome');
    const main = page.locator('main[data-clerk-welcome="clerk"]');
    await expect(main).toBeVisible();
    await page.locator('[data-locale-option="ta"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    await page.locator('[data-clerk-setup-action="request"]').click();
    await expect(page.locator('[data-clerk-setup-status="pending"]')).toBeVisible();
    await expect(page.getByRole('link', { name: /strategy/i })).toHaveCount(0);

    await asUser('owner', { workspace: 'chennai-solo' });
    await page.goto('/w/chennai-solo/welcome');
    await page.locator('[data-clerk-setup-action="approve"]').first().click();
    await expect(page.locator('[data-clerk-setup-action="approve"]')).toHaveCount(0);
  });
});
