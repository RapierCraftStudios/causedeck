// POST /v1/csp-report (#104): both wire formats, the 8 KB cap, per-IP rate limit, URL sanitising,
// the structured log line and the violation counter. No database: the route reads nothing, so the
// router is mounted with the same middleware groups as app.ts.
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../middleware/error-handler.ts';
import { bodyLimit } from '../middleware/body-limit.ts';
import { rateLimit } from '../middleware/rate-limit.ts';
import { createRouter } from '../lib/openapi.ts';
import {
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_PATH,
  CSP_REPORT_RATE_LIMIT,
  cspReportRouter,
  type CspReportDeps,
  parseCspReports,
  sanitiseUrl,
} from '../routes/csp-report.ts';

function harness(limit = CSP_REPORT_RATE_LIMIT) {
  const logs: { fields: unknown; message: string }[] = [];
  const counts: { directive: string }[] = [];
  const record = (fields: unknown, message?: string) => {
    logs.push({ fields, message: message ?? '' });
  };
  const logger = { info: record, warn: record } as unknown as CspReportDeps['logger'];
  const app = createRouter();
  app.onError(errorHandler({ ...logger, debug: () => undefined, error: () => undefined } as never));
  app.use('*', bodyLimit({ groups: { [CSP_REPORT_PATH]: CSP_REPORT_MAX_BYTES } }));
  app.use('*', async (c, next) => {
    c.set('principal', null);
    await next();
  });
  app.use('*', rateLimit({ groups: { [CSP_REPORT_PATH]: limit }, trustProxy: true }));
  app.route(
    '/v1',
    cspReportRouter({ logger, violations: { add: (_n, attrs) => counts.push(attrs) } }),
  );
  const post = (body: string, contentType: string, ip = '203.0.113.7') =>
    app.request(CSP_REPORT_PATH, {
      method: 'POST',
      body,
      headers: { 'content-type': contentType, 'x-forwarded-for': ip },
    });
  return { post, logs, counts };
}

const legacy = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': 'https://app.example.in/w/abc/matters?token=SECRET#frag',
      'blocked-uri': 'https://evil.example/x.js?session=SECRET',
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      disposition: 'enforce',
      'script-sample': 'user typed content',
      ...extra,
    },
  });

const reporting = JSON.stringify([
  {
    type: 'csp-violation',
    url: 'https://app.example.in/inbox?x=1',
    body: {
      documentURL: 'https://user:pw@app.example.in/inbox?x=1#y',
      blockedURL: 'inline',
      effectiveDirective: 'script-src',
      disposition: 'report',
      sample: 'secret text',
    },
  },
]);

describe('POST /v1/csp-report', () => {
  it('accepts application/csp-report, logs a sanitised line and counts the directive', async () => {
    const { post, logs, counts } = harness();
    const response = await post(legacy(), 'application/csp-report');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(counts).toEqual([{ directive: 'script-src-elem' }]);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.fields).toEqual({
      directive: 'script-src-elem',
      blocked: 'https://evil.example/x.js',
      document: 'https://app.example.in/w/abc/matters',
      source: '',
      disposition: 'enforce',
    });
    expect(JSON.stringify(logs)).not.toMatch(/SECRET|frag|user typed content/);
  });

  it('accepts application/reports+json (with a charset) and drops credentials and fragments', async () => {
    const { post, logs, counts } = harness();
    const response = await post(reporting, 'application/reports+json; charset=utf-8');
    expect(response.status).toBe(204);
    expect(counts).toEqual([{ directive: 'script-src' }]);
    expect(logs[0]?.fields).toMatchObject({
      blocked: 'inline',
      document: 'https://app.example.in/inbox',
      disposition: 'report',
    });
    expect(JSON.stringify(logs)).not.toMatch(/pw|secret text|x=1/);
  });

  it('rejects a body over 8 KB with 413', async () => {
    const { post, logs } = harness();
    const response = await post(
      legacy({ padding: 'x'.repeat(CSP_REPORT_MAX_BYTES) }),
      'application/csp-report',
    );
    expect(response.status).toBe(413);
    expect(logs).toHaveLength(0);
  });

  it('rate-limits per IP', async () => {
    const { post } = harness({ limit: 2, windowMs: 60_000 });
    expect((await post(legacy(), 'application/csp-report', '198.51.100.1')).status).toBe(204);
    expect((await post(legacy(), 'application/csp-report', '198.51.100.1')).status).toBe(204);
    expect((await post(legacy(), 'application/csp-report', '198.51.100.1')).status).toBe(429);
    expect((await post(legacy(), 'application/csp-report', '198.51.100.2')).status).toBe(204);
  });

  it.each([
    ['application/json', legacy()],
    ['application/csp-report', 'not json'],
    ['application/csp-report', JSON.stringify({ other: 1 })],
    ['application/reports+json', JSON.stringify({ not: 'an array' })],
    ['application/reports+json', JSON.stringify([{ type: 'deprecation', body: {} }])],
  ])('rejects %s with an unusable body (400, nothing logged or counted)', async (type, body) => {
    const { post, logs, counts } = harness();
    expect((await post(body, type)).status).toBe(400);
    expect(logs).toHaveLength(0);
    expect(counts).toHaveLength(0);
  });
});

describe('sanitising', () => {
  it('reduces URLs to origin and path and unknown schemes to the scheme', () => {
    expect(sanitiseUrl('https://a.example/p/q?x=1#y')).toBe('https://a.example/p/q');
    expect(sanitiseUrl('data:text/html;base64,AAAA')).toBe('data:');
    expect(sanitiseUrl('eval')).toBe('eval');
    expect(sanitiseUrl('::::')).toBe('invalid');
    expect(sanitiseUrl(42)).toBe('');
  });

  it('keeps the metric label low-cardinality', () => {
    const [report] =
      parseCspReports('application/csp-report', legacy({ 'effective-directive': 'X <script>' })) ??
      [];
    expect(report?.directive).toBe('other');
  });

  it('caps a Reporting API batch', () => {
    const entry = JSON.parse(reporting)[0];
    const reports = parseCspReports(
      'application/reports+json',
      JSON.stringify(Array(50).fill(entry)),
    );
    expect(reports).toHaveLength(20);
  });
});
