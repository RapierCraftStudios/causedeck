// The staff console shell (#309): axe reports no serious or critical violations on the console
// pages and the sign-in and TOTP steps, in every viewport and theme project.
import { ALLOWED_HEADERS, expect, test } from '../../fixtures/index.ts';

test.describe('admin console a11y', () => {
  test('console pages', async ({ adminAs, a11y }) => {
    const page = await adminAs('staff');
    for (const path of ['/', '/adapters', '/flags', '/support']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await a11y.expectNoViolations(page);
    }
  });

  test('sign-in and TOTP step', async ({ browser, adminServer, adminAs, a11y }) => {
    const context = await browser.newContext({
      baseURL: adminServer.url,
      extraHTTPHeaders: ALLOWED_HEADERS,
    });
    const signIn = await context.newPage();
    await signIn.goto('/sign-in');
    await expect(signIn.getByRole('heading', { level: 1 })).toBeVisible();
    await a11y.expectNoViolations(signIn);
    await context.close();

    const page = await adminAs('staff', { verify: false });
    await page.goto('/verify-2fa');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await a11y.expectNoViolations(page);
  });
});
