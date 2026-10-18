// Smoke only: the full shell suites (navigation, palette, mobile nav) belong to #159.
import { E2E_WORKSPACE_SLUGS, expect, test, type E2eRole } from '../../fixtures/index.ts';

const ROLES: E2eRole[] = ['owner', 'advocate', 'junior', 'clerk', 'viewer'];

/**
 * TODO(#18): the shell still resolves workspaces from the in-memory dev stub
 * (apps/web/lib/workspace-context.ts), where every signed-in user sees `demo`. Switch this to the
 * seeded `chennai-solo` once memberships come from the database.
 */
const SHELL_WORKSPACE = 'demo';

test.describe('app shell smoke', () => {
  for (const role of ROLES) {
    test(`${role} gets the signed-in shell`, { tag: '@smoke' }, async ({ page, asUser }) => {
      await asUser(role);
      // The seeded session is accepted: no bounce to sign-in.
      await expect(page).not.toHaveURL(/\/sign-in/);

      const response = await page.goto(`/w/${SHELL_WORKSPACE}/today`);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('navigation').first()).toBeVisible();
    });
  }

  test('seeded workspaces exist for every role', () => {
    expect(E2E_WORKSPACE_SLUGS).toEqual(['chennai-solo', 'bengaluru-chamber']);
  });
});
