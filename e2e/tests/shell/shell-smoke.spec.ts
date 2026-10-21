// Smoke only (also on WebKit): the full shell suites sit beside it in this folder (#159).
import { E2E_WORKSPACE_SLUGS, expect, test, type E2eRole } from '../../fixtures/index.ts';

const ROLES: E2eRole[] = ['owner', 'advocate', 'junior', 'clerk', 'viewer'];

test.describe('app shell smoke', () => {
  for (const role of ROLES) {
    test(`${role} gets the signed-in shell`, { tag: '@smoke' }, async ({ page, asUser }) => {
      // Each role signs in as its own seeded user and lands in their own workspace.
      await asUser(role);
      // The seeded session is accepted: no bounce to sign-in.
      await expect(page).not.toHaveURL(/\/sign-in/);

      const response = await page.goto(`/w/${E2E_WORKSPACE_SLUGS[0]}/today`);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('navigation').first()).toBeVisible();
    });
  }

  test('seeded workspaces exist for every role', () => {
    expect(E2E_WORKSPACE_SLUGS).toEqual(['chennai-solo', 'bengaluru-chamber']);
  });
});
