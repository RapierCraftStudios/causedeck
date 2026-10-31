// `POST /v1/csp-report` (#104): collects Content-Security-Policy violation reports from browsers,
// both the legacy `application/csp-report` object and the Reporting API's `application/reports+json`
// array. Public and untrusted: the body is size-capped and rate-limited per IP by the groups in
// app.ts, parsed defensively and never reflected. Each report becomes one structured log line with a
// fixed set of fields (URLs reduced to origin + path, so query strings, fragments and credentials
// never reach the logs) and one increment of `csp_violations_total{directive}`. Nothing is stored.
import { meter, type Logger } from '@causedeck/observability';

import { ApiError } from '../errors.ts';
import { createRouter, defineRoute, problemResponses, type AppRouter } from '../lib/openapi.ts';
import type { RateLimitRule } from '../middleware/rate-limit.ts';

export const CSP_REPORT_PATH = '/v1/csp-report';
export const CSP_REPORT_MAX_BYTES = 8 * 1024;
export const CSP_REPORT_RATE_LIMIT: RateLimitRule = { limit: 60, windowMs: 60_000 };
/** A burst of reports from one page load stays well under this; the rest is dropped. */
const MAX_REPORTS_PER_REQUEST = 20;
const MAX_FIELD_LENGTH = 200;

export interface CspViolationCounter {
  add(value: number, attributes: { directive: string }): void;
}

export interface CspReportDeps {
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Defaults to the `csp_violations_total` counter on the process-wide meter. */
  violations?: CspViolationCounter;
}

export interface SanitisedCspReport {
  directive: string;
  blocked: string;
  document: string;
  source: string;
  disposition: string;
}

export const cspReportRoute = defineRoute({
  method: 'post',
  path: '/csp-report',
  public: true,
  operationId: 'receiveCspReport',
  tags: ['Security'],
  summary:
    'CSP violation report (`application/csp-report` or `application/reports+json`, 8 KB maximum)',
  responses: {
    204: { description: 'Accepted: logged and counted, nothing stored' },
    ...problemResponses(400, 413, 429),
  },
});

const KEYWORD_SOURCES = new Set(['inline', 'eval', 'self', 'wasm-eval', 'trusted-types-policy']);

/** `https://host/path?q=1#f` becomes `https://host/path`; non-URLs become a short fixed token. */
export function sanitiseUrl(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  if (KEYWORD_SOURCES.has(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return `${url.origin}${url.pathname}`.slice(0, MAX_FIELD_LENGTH);
  }
  // data:, blob:, about:, chrome-extension: and the like: the scheme only, never the payload.
  return url.protocol.slice(0, 20);
}

function directiveOf(value: unknown): string {
  const first = typeof value === 'string' ? value.trim().split(/\s+/)[0] : undefined;
  // The metric label stays low-cardinality: anything that is not a plain directive name is `other`.
  return first !== undefined && /^[a-z][a-z-]{1,39}$/.test(first) ? first : 'other';
}

function dispositionOf(value: unknown): string {
  return value === 'report' ? 'report' : 'enforce';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fromLegacy(body: Record<string, unknown>): SanitisedCspReport | null {
  const report = asRecord(body['csp-report']);
  if (report === null) return null;
  return {
    directive: directiveOf(report['effective-directive'] ?? report['violated-directive']),
    blocked: sanitiseUrl(report['blocked-uri']),
    document: sanitiseUrl(report['document-uri']),
    source: sanitiseUrl(report['source-file']),
    disposition: dispositionOf(report['disposition']),
  };
}

function fromReportingApi(entry: unknown): SanitisedCspReport | null {
  const record = asRecord(entry);
  const body = asRecord(record?.['body']);
  if (record === null || body === null || record['type'] !== 'csp-violation') return null;
  return {
    directive: directiveOf(body['effectiveDirective'] ?? body['violatedDirective']),
    blocked: sanitiseUrl(body['blockedURL']),
    document: sanitiseUrl(body['documentURL'] ?? record['url']),
    source: sanitiseUrl(body['sourceFile']),
    disposition: dispositionOf(body['disposition']),
  };
}

/** Both wire formats reduced to sanitised reports; `null` when the body is neither. */
export function parseCspReports(contentType: string, text: string): SanitisedCspReport[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (contentType === 'application/reports+json') {
    if (!Array.isArray(json)) return null;
    const reports = json.slice(0, MAX_REPORTS_PER_REQUEST).map(fromReportingApi);
    return reports.every((report) => report !== null) ? reports : null;
  }
  const body = asRecord(json);
  const report = body === null ? null : fromLegacy(body);
  return report === null ? null : [report];
}

export function cspReportRouter(deps: CspReportDeps): AppRouter {
  const { logger } = deps;
  const violations: CspViolationCounter =
    deps.violations ??
    meter().createCounter('csp_violations_total', {
      description: 'Content-Security-Policy violation reports received, by directive',
    });

  return createRouter().openapi(cspReportRoute, async (c) => {
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/csp-report' && contentType !== 'application/reports+json') {
      throw new ApiError(
        400,
        'VALIDATION',
        'Content-Type must be application/csp-report or application/reports+json.',
      );
    }
    const reports = parseCspReports(contentType, await c.req.text());
    if (reports === null) {
      throw new ApiError(400, 'VALIDATION', 'The body is not a CSP violation report.');
    }
    for (const report of reports) {
      violations.add(1, { directive: report.directive });
      logger.info(report, 'csp violation reported');
    }
    return c.body(null, 204);
  });
}
