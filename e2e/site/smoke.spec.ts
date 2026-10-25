// Smoke, SEO, privacy, theme and accessibility checks over every route of the exported site.
// Runs in light and dark at 360, 768 and 1280 px (playwright.site.config.ts).
import { expect, test, type Page } from '@playwright/test';

import { expectNoViolations } from '../fixtures/a11y.ts';

const ROUTES = [
  { path: '/', noindex: false },
  { path: '/about/', noindex: false },
  { path: '/legal/draft-notice/', noindex: true },
];

async function meta(page: Page, selector: string): Promise<string | null> {
  return page.locator(selector).first().getAttribute('content');
}

test.describe('every route', () => {
  for (const route of ROUTES) {
    test(`${route.path} has unique SEO metadata and is accessible @a11y`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
      expect(await meta(page, 'meta[name="description"]')).toBeTruthy();
      expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(
        new RegExp(`${route.path.replace(/\//g, '\\/')}$`),
      );
      expect(await meta(page, 'meta[property="og:title"]')).toBe(title);
      expect(await meta(page, 'meta[name="twitter:card"]')).toBe('summary_large_image');
      const robots = await meta(page, 'meta[name="robots"]');
      if (route.noindex) expect(robots).toContain('noindex');
      else expect(robots ?? '').not.toContain('noindex');
      await expectNoViolations(page);
    });
  }

  test('titles and descriptions are unique', async ({ page }) => {
    const seen = new Set<string>();
    for (const route of ROUTES) {
      await page.goto(route.path);
      const key = `${await page.title()}|${(await meta(page, 'meta[name="description"]')) ?? ''}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('the 404 page is calm, noindex and accessible @a11y', async ({ page }) => {
    const response = await page.goto('/no-such-page/');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await meta(page, 'meta[name="robots"]')).toContain('noindex');
    await expectNoViolations(page);
  });
});

test('skip link is the first tab stop and moves focus to main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('focus order reaches the header controls before the content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.viewport?.width === 360, 'inline nav is hidden below 768 px');
  await page.goto('/');
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(
        () => document.activeElement?.textContent?.trim() || document.activeElement?.tagName || '',
      ),
    );
  }
  expect(order[0]).toBe('Skip to content');
  expect(order.slice(1)).toContain('Product');
});

test('no cookies, no third-party requests, no CSP violations', async ({ page, context }) => {
  const origins = new Set<string>();
  const violations: string[] = [];
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  for (const route of ROUTES) await page.goto(route.path);
  expect([...origins]).toEqual([new URL(page.url()).origin]);
  expect(await context.cookies()).toEqual([]);
  expect(violations).toEqual([]);
});

test('the theme follows the system preference before first paint', async ({ page }, testInfo) => {
  const dark = testInfo.project.use.colorScheme === 'dark';
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __dark: boolean }).__dark =
        document.documentElement.classList.contains('dark');
    });
  });
  await page.goto('/');
  expect(await page.evaluate(() => (window as unknown as { __dark: boolean }).__dark)).toBe(dark);
});

test('security headers and a script CSP without inline-script allowance', async ({ request }) => {
  for (const route of ROUTES) {
    const response = await request.get(route.path);
    const headers = response.headers();
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    const csp = headers['content-security-policy'] ?? '';
    const scriptSrc = /script-src ([^;,]*)/.exec(csp)?.[1] ?? '';
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
  }
  const asset = await request.get('/robots.txt');
  expect(asset.status()).toBe(200);
});

test('sitemap lists indexable pages only; robots points at it', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/about/');
  expect(sitemap).not.toContain('draft-notice');
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap:');
});

test('the home page has SoftwareApplication JSON-LD only', async ({ page }) => {
  await page.goto('/');
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = blocks.map((block) => (JSON.parse(block) as { '@type': string })['@type']);
  expect(types).toEqual(['SoftwareApplication']);
});
