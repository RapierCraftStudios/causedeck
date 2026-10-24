// The admin staff gate (#309): non-staff users, staff without 2FA, disabled staff, and requests from
// disallowed IPs get the same generic 404 on every admin route and API, so direct URL probing
// reveals nothing. Enrolled staff are sent to the TOTP step, then reach the console.
import type { Page } from '@playwright/test';

import { ALLOWED_HEADERS, expect, test, totpCode } from '../../fixtures/index.ts';

const PROBES = [
  '/',
  '/flags',
  '/workspaces',
  '/support',
  // A support session page (#314): someone else's, unknown or not, the same 404.
  '/support/00000000-0000-4000-8000-000000000000',
  '/audit',
  '/adapters',
  '/does-not-exist',
  '/api/anything',
  '/api/auth/list-sessions',
  '/api/auth/two-factor/enable',
];

async function probe(page: Page, path: string) {
  const response = await page.request.get(path, { maxRedirects: 0 });
  return { status: response.status(), body: await response.text(), headers: response.headers() };
}

test.describe('admin staff gate', () => {
  test('signed-out visitors get one generic 404 everywhere but sign-in', async ({
    browser,
    adminServer,
  }) => {
    const context = await browser.newContext({
      baseURL: adminServer.url,
      extraHTTPHeaders: ALLOWED_HEADERS,
    });
    const page = await context.newPage();
    const results = await Promise.all(PROBES.map((path) => probe(page, path)));
    const first = results[0];
    for (const [i, result] of results.entries()) {
      expect(result.status, PROBES[i]).toBe(404);
      expect(result.body, PROBES[i]).toBe(first?.body);
      expect(result.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(first?.body).not.toMatch(/staff|console|sign in/i);
    const signIn = await page.goto('/sign-in');
    expect(signIn?.status()).toBe(200);
    await context.close();
  });

  for (const kind of ['nonStaff', 'noTwoFactor', 'disabled'] as const) {
    test(`${kind} gets the generic 404 on every route and API`, async ({ adminAs }) => {
      const page = await adminAs(kind, { verify: false });
      const reference = await probe(page, '/does-not-exist');
      expect(reference.status).toBe(404);
      for (const path of [...PROBES, '/sign-in', '/verify-2fa']) {
        const result = await probe(page, path);
        expect(result.status, path).toBe(404);
        expect(result.body, path).toBe(reference.body);
      }
    });
  }

  test('a request from a disallowed IP gets the 404, even for enrolled staff', async ({
    adminAs,
  }) => {
    const page = await adminAs('staff');
    for (const path of ['/', '/flags', '/sign-in', '/api/anything']) {
      const response = await page.request.get(path, {
        headers: { 'x-forwarded-for': '198.51.100.7' },
        maxRedirects: 0,
      });
      expect(response.status(), path).toBe(404);
    }
    const allowed = await page.request.get('/', { maxRedirects: 0 });
    expect(allowed.status()).toBe(200);
  });

  test('enrolled staff go through the TOTP step, then reach the console', async ({ adminAs }) => {
    const page = await adminAs('staff', { verify: false });
    const api = await page.request.get('/api/anything', { maxRedirects: 0 });
    expect(api.status()).toBe(404);
    await page.goto('/flags');
    await expect(page).toHaveURL(/\/verify-2fa$/);
    await page.getByLabel('Code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('That code did not work. Try again.')).toBeVisible();
    await page.goto('/verify-2fa');
    await page.getByLabel('Code').fill(totpCode());
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('staff-strip')).toContainText('Staff console');
    await expect(page.getByTestId('staff-strip')).toContainText('STAFF');
    await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link')).toHaveText([
      'Overview',
      'Adapters',
      'Sources',
      'Data Ops',
      'Review queue',
      'Coverage',
      'Flags',
      'Workspaces',
      'Support sessions',
      'Audit',
      'Business',
      'Growth',
    ]);
    const headers = (await page.request.get('/flags')).headers();
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
