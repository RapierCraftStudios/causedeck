import { describe, expect, it } from 'vitest';

import { buildCsp, cspReportUrlOf } from './csp.ts';

describe('CSP violation reporting (#104)', () => {
  it('has no report directives without a report URL', () => {
    expect(buildCsp('n')).not.toMatch(/report-/);
  });

  it('adds report-uri and report-to when the API URL is known', () => {
    const url = cspReportUrlOf({ API_URL: 'https://api.example.in' });
    expect(url).toBe('https://api.example.in/v1/csp-report');
    const directives = buildCsp('n', { reportUrl: url }).split('; ');
    expect(directives).toContain('report-uri https://api.example.in/v1/csp-report');
    expect(directives).toContain('report-to csp-endpoint');
    expect(directives).toContain("script-src 'self' 'nonce-n' 'strict-dynamic'");
  });

  it('yields no URL for a missing or malformed API_URL', () => {
    expect(cspReportUrlOf({})).toBeUndefined();
    expect(cspReportUrlOf({ API_URL: 'not a url' })).toBeUndefined();
  });
});
