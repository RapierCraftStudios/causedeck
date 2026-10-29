// Limitation tracker gated off (#942, part 4 of #84): `limitation.enabled` is a legal-gated flag
// that ships off. With it off the route is a plain "Page not found" and the shell nav has no
// Limitation link. Nothing here enables the flag, so the seeded rules stay unreachable.
import { expect, test } from '../../fixtures/index.ts';
import { seedLimitation } from '../../fixtures/limitation-data.ts';
import { SHELL_WORKSPACE, contentReady, openShell } from '../shell/helpers.ts';

test.describe('limitation tracker, flag off', () => {
  test(
    'the route is not found, even for the owner and with rules seeded',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await seedLimitation(db.name);
      await asUser('owner', { workspace: SHELL_WORKSPACE, path: 'limitation' });
      // The page streams behind the workspace loading boundary before notFound(): status is 200.
      await expect(
        page.locator('main').getByRole('heading', { level: 1 }).filter({ visible: true }),
      ).toHaveText('Page not found');
      await expect(page.locator('[data-route="limitation"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="limitation-card"]')).toHaveCount(0);
    },
  );

  test('the nav has no Limitation entry', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await contentReady(page);
    await expect(page.locator('a[href$="/matters"]').first()).toBeAttached();
    await expect(page.locator('a[href$="/limitation"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Limitation' })).toHaveCount(0);
  });

  test('a clerk gets the same not-found page', async ({ page, asUser }) => {
    await asUser('clerk', { workspace: SHELL_WORKSPACE, path: 'limitation' });
    await expect(
      page.locator('main').getByRole('heading', { level: 1 }).filter({ visible: true }),
    ).toHaveText('Page not found');
  });
});
