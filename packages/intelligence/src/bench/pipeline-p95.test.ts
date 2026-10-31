import { describe, expect, it } from 'vitest';

import {
  createBenchGateway,
  missingRealCredentials,
  renderMarkdown,
  reportProblems,
  resolveMode,
  runBenchmark,
} from './pipeline-p95.ts';
import { percentile, summarise } from './stats.ts';

const FULL_ENV = {
  BEDROCK_REGION: 'ap-south-1',
  BEDROCK_ACCESS_KEY_ID: 'AKIATEST',
  BEDROCK_SECRET_ACCESS_KEY: 'secret',
  BEDROCK_MODEL_ID: 'model',
  SARVAM_API_KEY: 'key',
  SARVAM_NO_TRAINING_CONFIRMED: 'true',
};

describe('percentiles', () => {
  it('uses nearest rank over observed values', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 95)).toBeNaN();
  });

  it('summarises', () => {
    expect(summarise([3, 1, 2])).toMatchObject({ count: 3, minMs: 1, maxMs: 3, p50Ms: 2 });
  });
});

describe('mode resolution', () => {
  it('is mock without credentials and real with all of them', () => {
    expect(resolveMode('auto', {})).toBe('mock');
    expect(resolveMode('auto', FULL_ENV)).toBe('real');
    expect(resolveMode('mock', FULL_ENV)).toBe('mock');
  });

  it('refuses real without credentials and names what is missing', () => {
    expect(() => resolveMode('real', {})).toThrow(/SARVAM_API_KEY/);
    expect(missingRealCredentials({ ...FULL_ENV, SARVAM_NO_TRAINING_CONFIRMED: '' })).toEqual([
      'SARVAM_NO_TRAINING_CONFIRMED',
    ]);
  });
});

describe('mock run', () => {
  it('runs every iteration, reports percentiles and passes the sanity check', async () => {
    const report = await runBenchmark({
      gateway: createBenchGateway('mock', null),
      mode: 'mock',
      iterations: 5,
    });
    expect(report.runs).toHaveLength(5);
    expect(report.failures).toBe(0);
    expect(Number.isFinite(report.endToEnd.p95Ms)).toBe(true);
    expect(report.budgetMet).toBeNull();
    expect(reportProblems(report)).toEqual([]);
    expect(renderMarkdown(report)).toContain('| end to end | 5 |');
  });

  it('fails a real report over budget and a mock report that failed iterations', async () => {
    const report = await runBenchmark({
      gateway: createBenchGateway('mock', null),
      mode: 'mock',
      iterations: 2,
    });
    expect(
      reportProblems({ ...report, mode: 'real', budgetEnforced: true, budgetMet: false }),
    ).toEqual([expect.stringContaining('not under')]);
    expect(reportProblems({ ...report, failures: 1 })).toEqual([expect.stringContaining('failed')]);
  });
});
