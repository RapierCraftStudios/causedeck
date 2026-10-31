// Bulk scheduler on the mock provider (#492): gate, budgets, off-peak, kill switches, alarms,
// backoff to zero traffic and the page cache. No network: the governed fetcher runs the mock.
import { describe, expect, it } from 'vitest';

import {
  createBulkScheduler,
  createFetcher,
  createMockProvider,
  isOffPeak,
  pageSourceFromFetcher,
  type BulkAlert,
  type BulkJob,
  type BulkKillSwitches,
  type BulkSchedulerConfig,
  type FetchPolicy,
  type MockFixture,
  type PageSource,
} from '../index.ts';

const HOST_A = 'hc-a.ecourts.example.in';
const HOST_B = 'hc-b.ecourts.example.in';
const NIGHT = new Date('2026-10-31T20:00:00Z'); // 01:30 IST, off-peak
const NOON_IST = new Date('2026-10-31T06:30:00Z'); // 12:00 IST, peak

const policyFor = (
  sourceId: string,
  host: string,
  over: Partial<FetchPolicy> = {},
): FetchPolicy => ({
  sourceId,
  kind: 'court',
  baseUrl: `https://${host}`,
  rateLimitPerMinute: 1_000,
  maxTier: 'proxy',
  maxCostDollars: 0.02,
  captchaBulkCleared: true,
  captchaBulkApprovalRef: 'OPINION-118-A',
  version: 'v1',
  ...over,
});

interface Setup {
  now: { t: Date };
  kill: { global: boolean; hosts: Set<string> };
  alerts: BulkAlert[];
  providerCalls: string[];
  policies: Map<string, FetchPolicy>;
}

function setup(
  opts: {
    fixtures?: Record<string, MockFixture>;
    config?: BulkSchedulerConfig;
    pages?: PageSource;
  } = {},
) {
  const s: Setup = {
    now: { t: NIGHT },
    kill: { global: false, hosts: new Set() },
    alerts: [],
    providerCalls: [],
    policies: new Map([
      ['src.a', policyFor('src.a', HOST_A)],
      ['src.a2', policyFor('src.a2', HOST_A)],
      ['src.b', policyFor('src.b', HOST_B)],
    ]),
  };
  const registry = {
    policyFor: (id: string) => {
      const p = s.policies.get(id);
      return p === undefined ? Promise.reject(new Error('SourceNotCleared')) : Promise.resolve(p);
    },
  };
  const mock = createMockProvider(opts.fixtures);
  const fetcher = createFetcher({
    registry,
    alterlab: { fetch: (r) => (s.providerCalls.push(r.url), mock.fetch(r)) },
    clock: { now: () => s.now.t },
    usage: { record: () => Promise.resolve() },
    log: { record: () => Promise.resolve() },
    hostRequestsPerMinute: 1_000,
  });
  const kill: BulkKillSwitches = { global: () => s.kill.global, host: (h) => s.kill.hosts.has(h) };
  const scheduler = createBulkScheduler({
    registry,
    pages: opts.pages ?? pageSourceFromFetcher(fetcher),
    clock: { now: () => s.now.t },
    kill,
    alerts: { alert: (e) => void s.alerts.push(e) },
    config: { hostRequestsPerMinute: 100, hostConcurrency: 5, ...opts.config },
  });
  return { s, scheduler };
}

const job = (
  sourceId: string,
  host: string,
  path: string,
  priority: BulkJob['priority'] = 'launch',
): BulkJob => ({
  sourceId,
  url: `https://${host}/${path}`,
  priority,
});

describe('gate in the scheduler', () => {
  it('refuses a source without the clearance flag or the approval reference, with zero network calls', async () => {
    const { s, scheduler } = setup();
    s.policies.set('src.a', policyFor('src.a', HOST_A, { captchaBulkCleared: false }));
    s.policies.set('src.a2', policyFor('src.a2', HOST_A, { captchaBulkApprovalRef: null }));
    scheduler.enqueue(job('src.a', HOST_A, 'one'));
    scheduler.enqueue(job('src.a2', HOST_A, 'two'));
    scheduler.enqueue(job('unknown', HOST_A, 'three'));
    const report = await scheduler.tick();
    expect(report.jobs.map((j) => [j.disposition, j.denial])).toEqual([
      ['denied_gate', 'not_cleared'],
      ['denied_gate', 'approval_ref_missing'],
      ['denied_gate', 'source_not_cleared'],
    ]);
    expect(s.providerCalls).toEqual([]);
    expect(scheduler.pending()).toBe(0);
  });

  it('runs a cleared source', async () => {
    const { s, scheduler } = setup();
    scheduler.enqueue(job('src.a', HOST_A, 'list'));
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('fetched');
    expect(s.providerCalls).toHaveLength(1);
  });
});

describe('off-peak queue and priority', () => {
  it('holds jobs outside the window and runs them inside it, tracked before launch before backfill', async () => {
    const { s, scheduler } = setup({ config: { hostConcurrency: 1, hostRequestsPerMinute: 100 } });
    s.now.t = NOON_IST;
    scheduler.enqueue(job('src.a', HOST_A, 'backfill', 'backfill'));
    scheduler.enqueue(job('src.a', HOST_A, 'launch', 'launch'));
    scheduler.enqueue(job('src.a', HOST_A, 'tracked', 'tracked'));
    expect((await scheduler.tick()).offPeak).toBe(false);
    expect(s.providerCalls).toEqual([]);
    expect(scheduler.pending()).toBe(3);
    s.now.t = NIGHT;
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    expect(s.providerCalls.map((u) => u.split('/').pop())).toEqual([
      'tracked',
      'launch',
      'backfill',
    ]);
  });

  it('computes the IST window across midnight', () => {
    const w = { startHour: 19, endHour: 7, utcOffsetMinutes: 330 };
    expect(isOffPeak(new Date('2026-10-31T13:29:00Z'), w)).toBe(false); // 18:59
    expect(isOffPeak(new Date('2026-10-31T13:30:00Z'), w)).toBe(true); // 19:00
    expect(isOffPeak(new Date('2026-10-31T01:29:00Z'), w)).toBe(true); // 06:59
    expect(isOffPeak(new Date('2026-10-31T01:30:00Z'), w)).toBe(false); // 07:00
  });
});

describe('per-host budgets', () => {
  it('limits requests per minute per host across sources, other hosts unaffected', async () => {
    const { s, scheduler } = setup({ config: { hostRequestsPerMinute: 2, hostConcurrency: 10 } });
    for (const p of ['1', '2', '3'])
      scheduler.enqueue(job(p === '2' ? 'src.a2' : 'src.a', HOST_A, p));
    scheduler.enqueue(job('src.b', HOST_B, 'b'));
    const first = await scheduler.tick();
    expect(first.jobs.filter((j) => j.disposition === 'fetched')).toHaveLength(3);
    expect(scheduler.pending()).toBe(1);
    await scheduler.tick();
    expect(scheduler.pending()).toBe(1);
    s.now.t = new Date(NIGHT.getTime() + 61_000);
    await scheduler.tick();
    expect(scheduler.pending()).toBe(0);
  });

  it('never exceeds the host concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const pages: PageSource = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { status: 200, body: 'x', contentType: 'text/html' };
    };
    const { scheduler } = setup({
      pages,
      config: { hostConcurrency: 2, hostRequestsPerMinute: 100 },
    });
    for (let i = 0; i < 6; i += 1) scheduler.enqueue(job('src.a', HOST_A, String(i)));
    await scheduler.tick();
    expect(peak).toBe(2);
    expect(scheduler.pending()).toBe(4);
  });
});

describe('kill switches', () => {
  it('KILL_CAPTCHA_BULK drops the queue and stops all traffic on the next tick', async () => {
    const { s, scheduler } = setup();
    for (let i = 0; i < 3; i += 1) scheduler.enqueue(job('src.a', HOST_A, String(i)));
    s.kill.global = true;
    const report = await scheduler.tick();
    expect(report.jobs.every((j) => j.disposition === 'dropped_killed')).toBe(true);
    expect(s.providerCalls).toEqual([]);
    expect(scheduler.pending()).toBe(0);
    // Re-enqueueing after the kill is allowed (the job key was released), and still blocked.
    expect(scheduler.enqueue(job('src.a', HOST_A, '0'))).toBe('queued');
    await scheduler.tick();
    expect(s.providerCalls).toEqual([]);
  });

  it('a host kill stops that host only', async () => {
    const { s, scheduler } = setup();
    s.kill.hosts.add(HOST_A);
    scheduler.enqueue(job('src.a', HOST_A, 'a'));
    scheduler.enqueue(job('src.b', HOST_B, 'b'));
    const report = await scheduler.tick();
    expect(report.jobs.map((j) => j.disposition).sort()).toEqual(['dropped_killed', 'fetched']);
    expect(s.providerCalls).toEqual([`https://${HOST_B}/b`]);
  });

  it('a kill flipped between ticks stops the host even though its budget has refilled', async () => {
    const { s, scheduler } = setup({ config: { hostConcurrency: 1, hostRequestsPerMinute: 2 } });
    for (let i = 0; i < 20; i += 1) scheduler.enqueue(job('src.a', HOST_A, String(i)));
    await scheduler.tick();
    const before = s.providerCalls.length;
    expect(before).toBe(2);
    s.kill.hosts.add(HOST_A);
    s.now.t = new Date(s.now.t.getTime() + 61_000);
    await scheduler.tick();
    expect(s.providerCalls.length).toBe(before);
    expect(scheduler.pending()).toBe(0);
  });

  it('start() ticks on the interval and the kill bites on the next one', async () => {
    const { s, scheduler } = setup({
      config: { hostConcurrency: 1, hostRequestsPerMinute: 1_000 },
    });
    for (let i = 0; i < 50; i += 1) scheduler.enqueue(job('src.a', HOST_A, String(i)));
    const stop = scheduler.start(5);
    await new Promise((r) => setTimeout(r, 40));
    s.kill.hosts.add(HOST_A);
    await new Promise((r) => setTimeout(r, 30));
    const frozen = s.providerCalls.length;
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(frozen).toBeGreaterThan(0);
    expect(s.providerCalls.length).toBe(frozen);
    expect(scheduler.pending()).toBe(0);
  });
});

describe('block and error alarms, backoff to zero', () => {
  const challenge = { body: '<title>Just a moment...</title>', status: 200 };

  it('alarms on each block and backs the host off to zero traffic after repeated blocks', async () => {
    const fixtures: Record<string, MockFixture> = {};
    for (let i = 0; i < 6; i += 1) fixtures[`https://${HOST_A}/${String(i)}`] = challenge;
    const { s, scheduler } = setup({
      fixtures,
      config: { blockTripThreshold: 3, hostConcurrency: 1 },
    });
    for (let i = 0; i < 6; i += 1) scheduler.enqueue(job('src.a', HOST_A, String(i)));
    for (let i = 0; i < 6; i += 1) await scheduler.tick();
    expect(s.alerts.filter((a) => a.kind === 'block')).toHaveLength(3);
    expect(s.alerts.filter((a) => a.kind === 'host_backoff')).toHaveLength(1);
    expect(s.providerCalls).toHaveLength(3);
    expect(scheduler.hostBackedOffUntil(HOST_A)).not.toBeNull();
    // Zero traffic through the whole backoff window, then it resumes.
    s.now.t = new Date(NIGHT.getTime() + 59 * 60_000);
    await scheduler.tick();
    expect(s.providerCalls).toHaveLength(3);
    s.now.t = new Date(NIGHT.getTime() + 61 * 60_000);
    await scheduler.tick();
    expect(s.providerCalls).toHaveLength(4);
  });

  it('doubles the backoff on each further trip', async () => {
    const pages: PageSource = () =>
      Promise.resolve({ status: 429, body: '', contentType: 'text/html' });
    const { s, scheduler } = setup({
      pages,
      config: { blockTripThreshold: 1, backoffBaseMs: 60_000, hostConcurrency: 1 },
    });
    scheduler.enqueue(job('src.a', HOST_A, 'x'));
    await scheduler.tick();
    const first = scheduler.hostBackedOffUntil(HOST_A)?.getTime() ?? 0;
    expect(first - NIGHT.getTime()).toBe(60_000);
    s.now.t = new Date(first + 1);
    scheduler.enqueue(job('src.a', HOST_A, 'y'));
    await scheduler.tick();
    const second = scheduler.hostBackedOffUntil(HOST_A)?.getTime() ?? 0;
    expect(second - s.now.t.getTime()).toBe(120_000);
  });

  it('reports blocks to the health port and survives a failing alert sink', async () => {
    const reported: string[] = [];
    const pages: PageSource = () =>
      Promise.resolve({ status: 403, body: '', contentType: 'text/html' });
    const scheduler = createBulkScheduler({
      registry: { policyFor: () => Promise.resolve(policyFor('src.a', HOST_A)) },
      pages,
      clock: { now: () => NIGHT },
      kill: { global: () => false, host: () => false },
      alerts: { alert: () => Promise.reject(new Error('sink down')) },
      health: {
        backoffUntil: () => Promise.resolve(null),
        reportBlock: (e) => (reported.push(`${e.sourceId}:${e.signature}`), Promise.resolve()),
      },
    });
    scheduler.enqueue(job('src.a', HOST_A, 'x'));
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('blocked');
    expect(reported).toEqual(['src.a:http_403']);
  });

  it('alarms on repeated errors and backs off at twice the threshold', async () => {
    const pages: PageSource = () => Promise.reject(new Error('boom'));
    const { s, scheduler } = setup({
      pages,
      config: { errorAlarmThreshold: 2, hostConcurrency: 1 },
    });
    for (let i = 0; i < 6; i += 1) scheduler.enqueue(job('src.a', HOST_A, String(i)));
    for (let i = 0; i < 6; i += 1) await scheduler.tick();
    const errors = s.alerts.flatMap((a) => (a.kind === 'error' ? [a.consecutive] : []));
    expect(errors).toEqual([2, 3, 4]);
    expect(s.alerts.filter((a) => a.kind === 'host_backoff')).toMatchObject([{ reason: 'errors' }]);
  });

  it('a success resets the block count', async () => {
    const fixtures = { [`https://${HOST_A}/0`]: challenge, [`https://${HOST_A}/1`]: challenge };
    const { s, scheduler } = setup({
      fixtures,
      config: { blockTripThreshold: 3, hostConcurrency: 1 },
    });
    for (const p of ['0', '1', 'ok', '2', '3']) scheduler.enqueue(job('src.a', HOST_A, p));
    for (let i = 0; i < 5; i += 1) await scheduler.tick();
    expect(s.alerts.filter((a) => a.kind === 'host_backoff')).toHaveLength(0);
  });
});

describe('page cache in the scheduler', () => {
  it('does not refetch a fresh page, refetches after the window, and sees an unchanged hash', async () => {
    const { s, scheduler } = setup({ config: { freshnessMs: 60_000 } });
    const j = job('src.a', HOST_A, 'cause-list');
    scheduler.enqueue(j);
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('fetched');
    scheduler.enqueue(j);
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('cached');
    expect(s.providerCalls).toHaveLength(1);
    s.now.t = new Date(NIGHT.getTime() + 61_000);
    scheduler.enqueue(j);
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('unchanged');
    expect(s.providerCalls).toHaveLength(2);
    scheduler.enqueue(j);
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('cached');
  });

  it('sends the cached ETag and treats a 304 as unchanged', async () => {
    const seen: (string | undefined)[] = [];
    const pages: PageSource = (_id, _url, v) => {
      seen.push(v.ifNoneMatch);
      return Promise.resolve(
        v.ifNoneMatch === undefined
          ? { status: 200, body: 'page', contentType: 'text/html', etag: '"e1"' }
          : { status: 304, body: '', contentType: 'text/html', notModified: true },
      );
    };
    const { s, scheduler } = setup({ pages, config: { freshnessMs: 1_000 } });
    const j = job('src.a', HOST_A, 'p');
    scheduler.enqueue(j);
    await scheduler.tick();
    s.now.t = new Date(NIGHT.getTime() + 2_000);
    scheduler.enqueue(j);
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('unchanged');
    expect(seen).toEqual([undefined, '"e1"']);
  });

  it('never caches a blocked response', async () => {
    const fixtures = {
      [`https://${HOST_A}/p`]: { body: '<title>Just a moment...</title>', status: 200 },
    };
    const { s, scheduler } = setup({ fixtures, config: { blockTripThreshold: 99 } });
    const j = job('src.a', HOST_A, 'p');
    scheduler.enqueue(j);
    await scheduler.tick();
    scheduler.enqueue(j);
    expect((await scheduler.tick()).jobs[0]?.disposition).toBe('blocked');
    expect(s.providerCalls).toHaveLength(2);
  });
});
