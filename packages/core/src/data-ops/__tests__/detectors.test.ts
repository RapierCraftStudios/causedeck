// Each detector fires on a fixture scenario and clears when the source recovers (#515, R5), and
// every alert type links to a runbook entry that exists (R7). Pure: no database.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DATA_OPS_ALERT_TYPES,
  RUNBOOK_ANCHORS,
  createAlertRouter,
  dedupKey,
  runDetectors,
  runbookUrl,
  type AlertChannel,
  type AlertMessage,
  type SourceMetrics,
} from '../index.ts';

const NOW = new Date('2026-10-23T12:00:00Z');
const minutesAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000);

const healthy: SourceMetrics = {
  sourceId: 'in.nclt.bengaluru',
  now: NOW,
  slo: { freshnessMinutes: 30, successRate: 0.9, parseYieldFloor: 0.8 },
  lastSuccessAt: minutesAgo(5),
  calls: { total: 20, failures: 0, blocks: 0 },
  backedOff: false,
  latestParse: { parserVersion: 'v3', expected: 50, parsed: 49 },
  cost: { last24h: 0.2, baselineDaily: 0.2 },
  conflicts: { parsed: 100, conflicts: 2 },
};

const breached = (m: SourceMetrics): string[] =>
  runDetectors(m)
    .filter((d) => d.breached)
    .map((d) => d.type);

describe('detectors', () => {
  it('is quiet for a healthy source and returns one verdict per alert type', () => {
    expect(runDetectors(healthy).map((d) => d.type)).toEqual([...DATA_OPS_ALERT_TYPES]);
    expect(breached(healthy)).toEqual([]);
  });

  const scenarios: [string, Partial<SourceMetrics>][] = [
    ['freshness', { lastSuccessAt: minutesAgo(95) }],
    ['error_rate', { calls: { total: 20, failures: 8, blocks: 0 } }],
    ['block_signature', { calls: { total: 20, failures: 0, blocks: 2 } }],
    ['parse_yield', { latestParse: { parserVersion: 'v4', expected: 50, parsed: 5 } }],
    ['cost_anomaly', { cost: { last24h: 4, baselineDaily: 0.2 } }],
    ['conflict_rate', { conflicts: { parsed: 100, conflicts: 40 } }],
  ];

  it.each(scenarios)('%s fires on its scenario and resolves when it recovers', (type, patch) => {
    expect(breached({ ...healthy, ...patch })).toContain(type);
    expect(breached(healthy)).not.toContain(type);
  });

  it('skips a source with no SLO and a source with too little data', () => {
    const none = {
      ...healthy,
      slo: { freshnessMinutes: null, successRate: null, parseYieldFloor: null },
    };
    expect(
      breached({
        ...none,
        lastSuccessAt: null,
        calls: { total: 20, failures: 20, blocks: 0 },
        latestParse: { parserVersion: 'v4', expected: 50, parsed: 0 },
      }),
    ).toEqual([]);
    expect(breached({ ...healthy, calls: { total: 2, failures: 2, blocks: 0 } })).toEqual([]);
    expect(breached({ ...healthy, conflicts: { parsed: 5, conflicts: 5 } })).toEqual([]);
  });

  it('does not page on a tiny cost baseline', () => {
    expect(breached({ ...healthy, cost: { last24h: 0.01, baselineDaily: 0.0001 } })).toEqual([]);
  });

  it('carries the parser version of a yield drop and a stable dedup key', () => {
    const drop = runDetectors({
      ...healthy,
      latestParse: { parserVersion: 'v4', expected: 50, parsed: 5 },
    });
    expect(drop.find((d) => d.type === 'parse_yield')?.parserVersion).toBe('v4');
    expect(dedupKey('freshness', 'in.nclt.bengaluru')).toBe('freshness:in.nclt.bengaluru');
  });
});

describe('runbooks', () => {
  const runbook = readFileSync(
    path.resolve(import.meta.dirname, '../../../../../infra/runbooks/data-ops/runbook.md'),
    'utf8',
  );
  const anchors = [...runbook.matchAll(/^## (.+)$/gm)].map((m) =>
    (m[1] ?? '').toLowerCase().replace(/\s+/g, '-'),
  );

  it.each([...DATA_OPS_ALERT_TYPES])('%s links to an existing runbook heading', (type) => {
    expect(anchors).toContain(RUNBOOK_ANCHORS[type]);
    expect(runbookUrl(type)).toBe(`infra/runbooks/data-ops/runbook.md#${RUNBOOK_ANCHORS[type]}`);
  });
});

describe('alert router', () => {
  const message: AlertMessage = {
    id: 'a',
    type: 'freshness',
    sourceId: 's',
    detail: 'd',
    runbookUrl: runbookUrl('freshness'),
    oncallEmail: null,
  };
  const channel = (name: string, fail = false): AlertChannel => ({
    name,
    send: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve()),
  });

  it('succeeds when any channel takes the notice and throws when none does', async () => {
    await expect(
      createAlertRouter([channel('slack', true), channel('email')]).opened(message),
    ).resolves.toBeUndefined();
    await expect(createAlertRouter([channel('slack', true)]).opened(message)).rejects.toThrow(
      /no channel/,
    );
  });
});
