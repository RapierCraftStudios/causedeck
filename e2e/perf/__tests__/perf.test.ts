import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bundleReport, chunkKey, formatReport } from '../../../scripts/check-bundle-budget.ts';
import { compareP95, p95FromK6Summary, regressionReport, stageBSummary } from '../compare.ts';
import {
  assertAllowedTarget,
  assertEgressBlocked,
  checkMockProviders,
  PerfTargetError,
} from '../guard.ts';
import { planScale, scaleSlug } from '../seed-scale.ts';
import {
  ANDROID_PROFILE_FLAGS,
  BUDGETS,
  k6Thresholds,
  lighthouseAssertions,
  STAGE_B_TRIGGERS,
} from '../thresholds.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(here, '..', file), 'utf8');

describe('thresholds', () => {
  it('encode the issue budgets', () => {
    const t = k6Thresholds();
    expect(t['http_req_duration{group:action}']).toEqual(['p(95)<300']);
    expect(t['http_req_duration{group:read}']).toEqual(['p(95)<400']);
    expect(t['http_req_duration{group:court_day_cache}']).toEqual(['p(95)<300']);
    expect(t['http_req_duration{group:brief_assembly}']).toEqual(['p(95)<5000']);
    expect(t.http_req_failed).toEqual(['rate<0.005']);
    expect(t.readiness_flaps).toEqual(['count<1']);
    expect(t.cross_tenant_leaks).toEqual(['count<1']);
    expect(BUDGETS.courtDayJsBytes).toBe(180 * 1024);
    expect(STAGE_B_TRIGGERS).toEqual({ p95Ms: 400, dbCpuPercent: 60, seats: 1000 });
  });

  it('shares the Lighthouse bar and cold start budget', () => {
    expect(lighthouseAssertions()['categories:performance']).toEqual(['error', { minScore: 0.95 }]);
    expect(lighthouseAssertions().interactive).toEqual(['error', { maxNumericValue: 2500 }]);
  });
});

describe('allow-list', () => {
  it('accepts local stacks and the configured staging host', () => {
    expect(assertAllowedTarget('http://localhost:3100').hostname).toBe('localhost');
    expect(assertAllowedTarget('http://127.0.0.1:8025').port).toBe('8025');
    const env = { PERF_STAGING_HOST: 'app.staging.example.test' };
    expect(assertAllowedTarget('https://app.staging.example.test/readyz', env).protocol).toBe(
      'https:',
    );
  });

  it('refuses production and unknown hosts', () => {
    expect(() => assertAllowedTarget('https://app.causedeck.in')).toThrow(PerfTargetError);
    expect(() => assertAllowedTarget('https://evil.example.com')).toThrow(PerfTargetError);
    expect(() => assertAllowedTarget('https://localhost.evil.com')).toThrow(PerfTargetError);
    expect(() =>
      assertAllowedTarget('https://app.causedeck.in', { PERF_STAGING_HOST: 'app.causedeck.in' }),
    ).toThrow(/not a staging host/);
    expect(() => assertAllowedTarget('not a url')).toThrow(PerfTargetError);
  });
});

describe('mock providers and egress', () => {
  it('requires mock AI, billing and local mail and storage', () => {
    const good = {
      AI_PROVIDER: 'mock',
      BILLING_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://127.0.0.1:1025',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
    };
    expect(checkMockProviders(good)).toEqual([]);
    expect(
      checkMockProviders({
        ...good,
        AI_PROVIDER: 'openai',
        S3_ENDPOINT: 'https://s3.amazonaws.com',
      }),
    ).toEqual(['AI_PROVIDER must be mock', 'S3_ENDPOINT points outside the local stack']);
  });

  it('passes when the external probe fails and throws when it gets through', async () => {
    await expect(assertEgressBlocked(() => Promise.reject(new Error('ENETUNREACH')))).resolves.toBe(
      true,
    );
    await expect(assertEgressBlocked(() => Promise.resolve(false))).resolves.toBe(true);
    await expect(assertEgressBlocked(() => Promise.resolve(true))).rejects.toThrow(/not blocked/);
  });
});

describe('regression and Stage B', () => {
  it('flags a p95 growth above 15% only', () => {
    const found = compareP95(
      { read: 100, action: 200, brief: 1000 },
      { read: 116, action: 229, brief: 900 },
    );
    expect(found.map((r) => r.route)).toEqual(['read']);
    expect(regressionReport(found)).toContain('| read | 100 | 116 | +16.0% |');
  });

  it('reads group p95 out of a k6 summary', () => {
    expect(
      p95FromK6Summary({
        metrics: { 'http_req_duration{group:read}': { values: { 'p(95)': 210 } } },
      } as never),
    ).toEqual({ read: 210 });
  });

  it('breaches on p95, DB CPU or seats', () => {
    const samples = [
      { dbCpuPercent: 40, dbConnections: 30, queueLagSeconds: 2 },
      { dbCpuPercent: 65, dbConnections: 55, queueLagSeconds: 9 },
    ];
    const summary = stageBSummary(410, samples, 1200);
    expect(summary).toMatchObject({ dbCpuPercent: 65, dbConnections: 55, queueLagSeconds: 9 });
    expect(summary.breached).toEqual(['p95', 'db_cpu', 'seats']);
    expect(stageBSummary(300, samples.slice(0, 1), 1000).breached).toEqual([]);
  });
});

describe('scaled seed', () => {
  it('plans a 1,000-seat equivalent with realistic row counts', () => {
    const plan = planScale(1000);
    expect(plan.seats).toBeGreaterThanOrEqual(1000);
    expect(plan.solo + plan.chambers).toBe(plan.workspaces);
    expect(plan.matters).toBe(plan.workspaces * 40);
    expect(plan.listings).toBeGreaterThan(plan.matters);
    expect(() => planScale(0)).toThrow(RangeError);
    expect(scaleSlug(7)).toBe('demo-scale-0007');
  });
});

describe('Lighthouse config', () => {
  it('covers the seven key pages at 0.95 and the Android profile throttles CPU 4x', () => {
    const rc = JSON.parse(read('lighthouse/lighthouserc.json')) as {
      ci: { collect: { url: string[] }; assert: { assertions: Record<string, unknown> } };
    };
    const urls = rc.ci.collect.url.join(' ');
    for (const page of [
      '/sign-in',
      '/today',
      '/briefs',
      '/obligations',
      '3200/',
      '/pricing',
      '/status',
    ])
      expect(urls).toContain(page);
    expect(rc.ci.assert.assertions['categories:performance']).toEqual([
      'error',
      { minScore: 0.95 },
    ]);
    expect(rc.ci.assert.assertions['categories:accessibility']).toEqual([
      'error',
      { minScore: 0.95 },
    ]);
    expect(rc.ci.assert.assertions.interactive).toEqual(['error', { maxNumericValue: 2500 }]);
    expect(ANDROID_PROFILE_FLAGS).toContain(
      '--collect.settings.throttling.cpuSlowdownMultiplier=4',
    );
  });
});

describe('bundle budget', () => {
  const budget = (JSON.parse(read('budgets/bundle-budget.json')) as { budgetBytes: number })
    .budgetBytes;

  it('uses the 180 KB gzip budget', () => {
    expect(budget).toBe(BUDGETS.courtDayJsBytes);
  });

  it('fails above the budget and reports what grew', () => {
    const baseline = { 'chunks/app.js': 100 * 1024, 'chunks/lib.js': 70 * 1024 };
    const report = bundleReport(
      {
        'chunks/app-0123456789abcdef.js': 112 * 1024,
        'chunks/lib-fedcba9876543210.js': 70 * 1024,
        'chunks/new-aaaaaaaaaaaa.js': 5 * 1024,
      },
      budget,
      baseline,
    );
    expect(report.ok).toBe(false);
    expect(report.grew.map((g) => g.file)).toEqual([
      'chunks/app-0123456789abcdef.js',
      'chunks/new-aaaaaaaaaaaa.js',
    ]);
    expect(formatReport(report, true)).toContain('OVER BUDGET');
    expect(bundleReport({ 'a.js': 1024 }, budget, {}).ok).toBe(true);
    expect(chunkKey('chunks/app-0123456789abcdef.js')).toBe('chunks/app.js');
  });
});
