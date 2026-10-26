import { schema, type Queryable } from '@causedeck/db';
import { createMemoryObjectStore } from '@causedeck/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdapterHealthSummaryRow } from '../court/index.ts';

const summary = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../court/index.ts', () => ({
  getAdapterHealthSummary: () => Promise.resolve(summary.rows),
}));

import { statusSnapshotSchema } from './model.ts';
import {
  adapterState,
  buildSnapshot,
  COURT_COMPONENT_NAME,
  courtState,
  isStale,
  publishStatus,
  sanitiseIncident,
  signSnapshot,
  STATUS_OBJECT_PATH,
  verifySnapshot,
} from './publish.ts';

const KEY = 'test-signing-key-0123456789abcdef';
const NOW = new Date('2026-10-25T10:00:00.000Z');
const INCIDENT_ID = '3f9c1c1e-6a49-4d0e-8a77-0c5f0d6a1b11';

const row = (adapterId: string, runs: number, degradedRuns: number, failedRuns: number) =>
  ({
    adapterId,
    adapterVersion: '1',
    runs,
    okRuns: runs - degradedRuns - failedRuns,
    degradedRuns,
    failedRuns,
    rowsParsed: 0,
    rowsAnchored: 0,
  }) satisfies AdapterHealthSummaryRow;

/** A chainable stand-in for the two incident selects; each resolves to the rows of its table. */
function fakeDb(incidents: unknown[] = [], updates: unknown[] = []): Queryable {
  const chain = (table: unknown): unknown => {
    const rows = table === schema.incident ? incidents : updates;
    const node: Record<string, unknown> = {};
    for (const m of ['where', 'orderBy', 'limit']) node[m] = () => node;
    node.then = (resolve: (v: unknown) => unknown) => resolve(rows);
    return node;
  };
  return { select: () => ({ from: chain }) } as unknown as Queryable;
}

const okCheck = (id: 'database' | 'storage') => ({ id, check: () => Promise.resolve() });

beforeEach(() => {
  summary.rows = [];
});

describe('thresholds', () => {
  it('maps adapter runs to states', () => {
    expect(adapterState({ runs: 0, degradedRuns: 0, failedRuns: 0 })).toBe('operational');
    expect(adapterState({ runs: 4, degradedRuns: 0, failedRuns: 4 })).toBe('operational');
    expect(adapterState({ runs: 10, degradedRuns: 1, failedRuns: 0 })).toBe('operational');
    expect(adapterState({ runs: 10, degradedRuns: 1, failedRuns: 1 })).toBe('degraded');
    expect(adapterState({ runs: 10, degradedRuns: 0, failedRuns: 4 })).toBe('degraded');
    expect(adapterState({ runs: 10, degradedRuns: 0, failedRuns: 5 })).toBe('down');
  });

  it('takes the worst adapter and sums versions per adapter', () => {
    expect(courtState([])).toBe('operational');
    expect(courtState([row('a', 10, 0, 0), row('b', 10, 0, 6)])).toBe('down');
    expect(courtState([row('a', 3, 0, 1), { ...row('a', 12, 0, 0), adapterVersion: '2' }])).toBe(
      'operational',
    );
    expect(courtState([row('a', 3, 0, 3), { ...row('a', 7, 0, 0), adapterVersion: '2' }])).toBe(
      'degraded',
    );
  });
});

describe('buildSnapshot', () => {
  it('produces a schema-valid snapshot with the court wording', async () => {
    summary.rows = [row('a', 10, 0, 6)];
    const snap = await buildSnapshot({
      db: fakeDb(),
      checks: [
        okCheck('database'),
        { id: 'storage', check: async () => Promise.reject(new Error('s3.internal:9000')) },
      ],
      now: () => NOW,
    });
    const signed = signSnapshot(snap, KEY);
    expect(statusSnapshotSchema.safeParse(signed).success).toBe(true);
    expect(snap.components.find((c) => c.id === 'court')).toEqual({
      id: 'court',
      name: 'Parsing of documents you share',
      status: 'down',
    });
    expect(COURT_COMPONENT_NAME).toBe('Parsing of documents you share');
    expect(snap.components.find((c) => c.id === 'storage')?.status).toBe('down');
    expect(snap.overall).toBe('down');
    expect(JSON.stringify(snap)).not.toContain('s3.internal');
  });

  it('is operational with no runs and healthy checks', async () => {
    const snap = await buildSnapshot({
      db: fakeDb(),
      checks: [okCheck('database')],
      now: () => NOW,
    });
    expect(snap.overall).toBe('operational');
  });
});

describe('sanitiser', () => {
  it('projects an allowlist and drops hostnames, errors and workspace ids', () => {
    const incident = sanitiseIncident(
      {
        id: INCIDENT_ID,
        title: 'Slow\u0000 parsing',
        severity: 'degraded',
        state: 'investigating',
        component: 'court',
        startedAt: NOW,
        resolvedAt: null,
        createdBy: 'staff-secret',
        workspaceId: 'ws-secret',
        error: 'ECONNREFUSED db.internal:5432',
      },
      [{ state: 'identified', body: 'Found it', createdAt: NOW, workspaceId: 'ws-secret' }],
    );
    expect(incident).not.toBeNull();
    const text = JSON.stringify(incident);
    for (const leaked of ['staff-secret', 'ws-secret', 'ECONNREFUSED', 'db.internal', '\u0000']) {
      expect(text).not.toContain(leaked);
    }
    expect(Object.keys(incident ?? {}).sort()).toEqual(
      [
        'component',
        'id',
        'resolvedAt',
        'severity',
        'startedAt',
        'state',
        'title',
        'updates',
      ].sort(),
    );
  });

  it('rejects rows that are not publishable', () => {
    expect(sanitiseIncident({ id: INCIDENT_ID, title: '', startedAt: NOW })).toBeNull();
    expect(sanitiseIncident(null)).toBeNull();
    expect(
      sanitiseIncident({
        id: 'not-a-uuid',
        title: 't',
        severity: 'down',
        state: 'resolved',
        component: 'c',
        startedAt: NOW,
      }),
    ).toBeNull();
  });
});

describe('signature', () => {
  it('verifies, and rejects tampering and a wrong key', async () => {
    const signed = signSnapshot(
      await buildSnapshot({ db: fakeDb(), checks: [okCheck('database')], now: () => NOW }),
      KEY,
    );
    expect(verifySnapshot(signed, KEY)).toBe(true);
    expect(verifySnapshot(signed, 'another-key-another-key-another!')).toBe(false);
    expect(verifySnapshot({ ...signed, overall: 'down' }, KEY)).toBe(false);
    expect(verifySnapshot({ nope: true }, KEY)).toBe(false);
  });
});

describe('publishStatus', () => {
  it('writes once and skips an identical second run, refreshing when old', async () => {
    const store = createMemoryObjectStore();
    const put = vi.spyOn(store, 'put');
    const deps = { db: fakeDb(), checks: [okCheck('database')], store, signingKey: KEY };

    const first = await publishStatus({ ...deps, now: () => NOW });
    expect(first).toMatchObject({ published: true, reason: 'first' });
    const second = await publishStatus({ ...deps, now: () => new Date(NOW.getTime() + 60_000) });
    expect(second).toMatchObject({ published: false, reason: 'unchanged' });
    expect(put).toHaveBeenCalledTimes(1);

    const refreshed = await publishStatus({
      ...deps,
      now: () => new Date(NOW.getTime() + 400_000),
    });
    expect(refreshed).toMatchObject({ published: true, reason: 'refresh' });
    expect(put).toHaveBeenCalledTimes(2);
    expect(STATUS_OBJECT_PATH).toBe('status/status.json');
  });

  it('rewrites when the content changed', async () => {
    const store = createMemoryObjectStore();
    const base = { db: fakeDb(), store, signingKey: KEY, now: () => NOW };
    await publishStatus({ ...base, checks: [okCheck('database')] });
    const changed = await publishStatus({
      ...base,
      checks: [{ id: 'database', check: async () => Promise.reject(new Error('x')) }],
    });
    expect(changed).toMatchObject({ published: true, reason: 'changed' });
  });
});

describe('isStale', () => {
  it('is stale past the max age or when unreadable', () => {
    const generatedAt = NOW.toISOString();
    expect(isStale({ generatedAt }, new Date(NOW.getTime() + 299_000))).toBe(false);
    expect(isStale({ generatedAt }, new Date(NOW.getTime() + 301_000))).toBe(true);
    expect(isStale({ generatedAt }, new Date(NOW.getTime() + 61_000), 60)).toBe(true);
    expect(isStale({ generatedAt: 'garbage' }, NOW)).toBe(true);
  });
});
