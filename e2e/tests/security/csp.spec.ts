// CSP violation reporting (#104): a deliberate violation on a real page makes the browser POST a
// report to the API's `/v1/csp-report`. The API itself (sanitised log line, `csp_violations_total`)
// is covered by apps/api/src/__tests__/csp-report.test.ts; this proves the page's CSP names the
// endpoint and that what the browser sends is something the route accepts.
import { expect, test } from '../../fixtures/index.ts';

test.describe('CSP violation reports', () => {
  test('an inline script blocked by the CSP is reported to /v1/csp-report', async ({ page }) => {
    const reported = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/v1/csp-report'),
    );
    // Answer the report ourselves: the API is not part of the e2e stack.
    await page.route('**/v1/csp-report', (route) => route.fulfill({ status: 204 }));

    await page.goto('/sign-in');
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__cspViolation = true'; // no nonce: blocked by script-src
      document.head.append(script);
    });

    const request = await reported;
    expect(request.headers()['content-type']).toMatch(/application\/(csp-report|reports\+json)/);
    const body = request.postData() ?? '';
    expect(body).toMatch(/script-src/);
    expect(await page.evaluate(() => (window as { __cspViolation?: boolean }).__cspViolation)).toBe(
      undefined,
    );
  });
});
