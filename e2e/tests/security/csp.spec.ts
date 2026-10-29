// CSP violation reporting (#104): the page's CSP names the API's `/v1/csp-report` and a violation on
// a real page is blocked and raised. The browser's own POST is not awaited: Chromium prefers
// `report-to`, whose endpoint Caddy declares (`Reporting-Endpoints`, infra/caddy) and whose reports
// it batches with a delay, so waiting for it here would be a timing test. The API route (sanitised
// log line, `csp_violations_total`) is covered by apps/api/src/__tests__/csp-report.test.ts.
import { expect, test } from '../../fixtures/index.ts';

test.describe('CSP violation reports', () => {
  test('the CSP names the report endpoint and an inline script is blocked', async ({ page }) => {
    const response = await page.goto('/sign-in');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/report-uri \S+\/v1\/csp-report/);
    expect(csp).toContain('report-to csp-endpoint');

    const violation = await page.evaluate(
      () =>
        new Promise<{ directive: string; sample: string }>((resolve) => {
          document.addEventListener(
            'securitypolicyviolation',
            (event) => {
              resolve({ directive: event.effectiveDirective, sample: event.sample });
            },
            { once: true },
          );
          const script = document.createElement('script');
          script.textContent = 'window.__cspViolation = true'; // no nonce: blocked by script-src
          document.head.append(script);
        }),
    );
    expect(violation.directive).toMatch(/^script-src/);
    expect(await page.evaluate(() => (window as { __cspViolation?: boolean }).__cspViolation)).toBe(
      undefined,
    );
  });
});
