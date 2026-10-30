// CSP violation reporting (#104): the page's CSP names the API's `/v1/csp-report`, and an inline
// script without the nonce on a real page is refused. The script is injected into the served HTML
// (the real CSP header is kept), because a script added through DevTools evaluation is not a page
// script. The browser's own POST is not awaited: Chromium prefers `report-to`, whose endpoint Caddy
// declares (`Reporting-Endpoints`, infra/caddy) and whose reports it batches with a delay. The API
// route (sanitised log line, `csp_violations_total`) is covered by apps/api/src/__tests__/csp-report.test.ts.
import { expect, test } from '../../fixtures/index.ts';

test.describe('CSP violation reports', () => {
  test('the CSP names the report endpoint and an inline script is refused', async ({ page }) => {
    await page.route('**/sign-in', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      const body = (await response.text()).replace(
        '<head>',
        '<head><script>window.__cspViolation = true</script>',
      );
      await route.fulfill({ response, body });
    });
    const refused = page.waitForEvent('console', {
      predicate: (message) => /Content Security Policy/i.test(message.text()),
      timeout: 10_000,
    });

    const response = await page.goto('/sign-in');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/report-uri \S+\/v1\/csp-report/);
    expect(csp).toContain('report-to csp-endpoint');
    expect(csp).toMatch(/script-src [^;]*'nonce-/);

    expect((await refused).text()).toMatch(/script/i);
    expect(await page.evaluate(() => (window as { __cspViolation?: boolean }).__cspViolation)).toBe(
      undefined,
    );
  });
});
