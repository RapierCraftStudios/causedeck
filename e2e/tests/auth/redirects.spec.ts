import { expect, test } from '../../fixtures/index.ts';

test.describe('auth redirects', () => {
  test(
    'unauthenticated workspace visit goes to sign-in with `next`',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.goto('/w/chennai-solo/today');
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Fchennai-solo%2Ftoday$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Sign in to CauseDeck' }),
      ).toBeVisible();
    },
  );

  test('unauthenticated account visit goes to sign-in with `next`', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  });

  test('a signed-in user on sign-in is sent to a safe `next`', async ({ page, asUser }) => {
    await asUser('clerk');
    await page.goto('/sign-in?next=/account');
    await expect(page).toHaveURL((url) => url.pathname === '/account');
  });

  for (const unsafe of ['//evil.example/x', 'https://evil.example/x', '/\\evil.example']) {
    test(`unsafe next ${unsafe} stays on this origin`, async ({ page, asUser, baseURL }) => {
      await asUser('clerk');
      await page.goto(`/sign-in?next=${encodeURIComponent(unsafe)}`);
      await page.waitForURL((url) => url.pathname !== '/sign-in');
      expect(new URL(page.url()).origin).toBe(baseURL);
    });
  }

  test('a workspace the user does not belong to is not found', async ({ page, asUser }) => {
    await asUser('owner', { workspace: 'chennai-solo' });
    await page.goto('/w/bengaluru-chamber/today');
    // The layout streams, so `notFound()` renders the not-found UI rather than a 404 status.
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveURL(/\/w\/bengaluru-chamber\/today$/);
  });
});
