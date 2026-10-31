// The bulk captcha tick (#1078): feed and tick, the solver chain behind an eCourts challenge page,
// the alert sink and the paid-spend ledger. Mock fetcher, mock OCR and mock paid tier: no network,
// no key, no database.
import type { EcourtsChallengeIo } from '@causedeck/adapters';
import {
  createMockOcrEngine,
  type BulkAlert,
  type BulkKillSwitches,
  type FetchPolicy,
  type Fetcher,
} from '@causedeck/fetch';
import { describe, expect, it, vi } from 'vitest';

import type { AlertMessage, AlertNotifier } from '../../data-ops/index.ts';

import {
  CAPTCHA_BULK_TICK_CRON,
  buildCaptchaBulkTicker,
  captchaBulkTick,
  runCaptchaBulkTick,
  type CaptchaBulkTicker,
} from './captcha-bulk-tick.ts';

const log = { info: vi.fn(), warn: vi.fn() };
const ctx = { db: {} as never, log: log as never };

const NIGHT = new Date('2026-10-31T20:00:00Z'); // 01:30 IST, off-peak
const HOST = 'district.ecourts.example.in';
const URL_A = `https://${HOST}/search`;

const policy = (over: Partial<FetchPolicy> = {}): FetchPolicy => ({
  sourceId: 'ecourts-d1',
  kind: 'court',
  baseUrl: `https://${HOST}`,
  rateLimitPerMinute: 1_000,
  maxTier: 'proxy',
  maxCostDollars: 0.02,
  captchaBulkCleared: true,
  captchaBulkApprovalRef: 'OPINION-118-A',
  version: 'v1',
  ...over,
});

const CHALLENGE = `<html><body><form action="/search" method="post">
  <img id="captcha_image" src="/captcha/1.png"><input type="text" name="captcha_code">
  <input type="hidden" name="token" value="t1"></form></body></html>`;
const RESULT = '<html><body><table><tr><td>Case list</td></tr></table></body></html>';

const IMAGE = new Uint8Array([1, 2, 3, 4]);

function harness(options: { answerLocally: boolean; killed?: boolean; fail?: boolean }) {
  const state = { now: NIGHT, solves: [] as unknown[], submits: [] as string[] };
  const fetcher = {
    fetchSource: () => Promise.resolve({ status: 200, body: CHALLENGE, contentType: 'text/html' }),
  } as unknown as Fetcher;
  const io: EcourtsChallengeIo = {
    loadImage: () => Promise.resolve(IMAGE),
    submit: (_id, challenge, answer) => {
      state.submits.push(
        `${challenge.answerField}=${answer}&token=${challenge.fields.token ?? ''}`,
      );
      return Promise.resolve({
        status: options.fail === true ? 503 : 200,
        body: options.fail === true ? CHALLENGE : RESULT,
        contentType: 'text/html',
      });
    },
  };
  const alerts: BulkAlert[] = [];
  const kill: BulkKillSwitches = { global: () => options.killed === true, host: () => false };
  const ticker = buildCaptchaBulkTicker({
    db: {} as never,
    wiring: {
      fetcher: () => fetcher,
      ocr: createMockOcrEngine(options.answerLocally ? [[IMAGE, 'k7m2p']] : []),
      io,
      kill,
      config: { offPeak: null, hostRequestsPerMinute: 100 },
    },
    alerts: { alert: (e) => void alerts.push(e) },
    registry: { policyFor: () => Promise.resolve(policy()) },
    recordSolve: (event) => {
      state.solves.push(event);
      return Promise.resolve();
    },
    now: () => state.now,
  });
  return { ticker, state, alerts };
}

describe('system.captcha-bulk.tick job', () => {
  it('is a workspace-less system job on a one-minute schedule', () => {
    expect(captchaBulkTick.name).toBe('system.captcha-bulk.tick');
    expect(captchaBulkTick.schedule?.cron).toBe(CAPTCHA_BULK_TICK_CRON);
  });

  it('does nothing while the flag is off', async () => {
    const tick = vi.fn();
    const ticker: CaptchaBulkTicker = { enqueue: vi.fn(), tick };
    const feed = vi.fn();
    const report = await runCaptchaBulkTick(ctx, {
      flagEnabled: () => Promise.resolve(false),
      feed,
      ticker,
    });
    expect(report.ran).toBe(false);
    expect(feed).not.toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
  });

  it('feeds the cleared sources and ticks once, counting dispositions', async () => {
    const jobs: unknown[] = [];
    const ticker: CaptchaBulkTicker = {
      enqueue: (job) => {
        jobs.push(job);
        return jobs.length === 1 ? 'queued' : 'duplicate';
      },
      tick: () =>
        Promise.resolve({
          offPeak: true,
          jobs: [
            { job: {} as never, disposition: 'fetched' },
            { job: {} as never, disposition: 'fetched' },
            { job: {} as never, disposition: 'blocked' },
          ],
          pending: 4,
        }),
    };
    const report = await runCaptchaBulkTick(ctx, {
      flagEnabled: () => Promise.resolve(true),
      feed: () =>
        Promise.resolve([
          { sourceId: 'a', url: 'https://a.example.in/', priority: 'launch' as const },
          { sourceId: 'b', url: 'https://b.example.in/', priority: 'launch' as const },
        ]),
      ticker,
      notifier: { opened: vi.fn(), resolved: vi.fn() },
    });
    expect(report).toEqual({
      ran: true,
      fed: 1,
      offPeak: true,
      pending: 4,
      dispositions: { fetched: 2, blocked: 1 },
    });
  });
});

describe('eCourts challenge behind the solver chain', () => {
  it('answers a challenge locally at no cost', async () => {
    const { ticker, state } = harness({ answerLocally: true });
    ticker.enqueue({ sourceId: 'ecourts-d1', url: URL_A, priority: 'launch' });
    const report = await ticker.tick();
    expect(report.jobs[0]?.disposition).toBe('fetched');
    expect(state.submits).toEqual(['captcha_code=k7m2p&token=t1']);
    expect(state.solves).toMatchObject([{ solved: true, tier: 'local', costDollars: 0 }]);
  });

  it('falls back to the paid mock when local cannot read it, and records the spend', async () => {
    const { ticker, state } = harness({ answerLocally: false });
    ticker.enqueue({ sourceId: 'ecourts-d1', url: URL_A, priority: 'launch' });
    const report = await ticker.tick();
    expect(report.jobs[0]?.disposition).toBe('fetched');
    expect(state.submits).toEqual(['captcha_code=MOCK00&token=t1']);
    expect(state.solves).toMatchObject([{ solved: true, tier: 'paid', costDollars: 0.003 }]);
  });

  it('counts an unanswered challenge as an error against the host and alarms, then backs off', async () => {
    const { ticker, alerts } = harness({ answerLocally: false, fail: true });
    for (let i = 0; i < 10; i += 1) {
      ticker.enqueue({
        sourceId: 'ecourts-d1',
        url: `${URL_A}?p=${String(i)}`,
        priority: 'launch',
      });
    }
    for (let i = 0; i < 10; i += 1) await ticker.tick();
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain('error');
    expect(kinds).toContain('host_backoff');
  });

  it('drops queued work when the kill switch is set', async () => {
    const { ticker, state } = harness({ answerLocally: true, killed: true });
    ticker.enqueue({ sourceId: 'ecourts-d1', url: URL_A, priority: 'launch' });
    const report = await ticker.tick();
    expect(report.jobs[0]?.disposition).toBe('dropped_killed');
    expect(state.submits).toEqual([]);
  });
});

describe('alerts reach the data-ops notifier', () => {
  it('routes block, error and backoff events as data-ops notices naming the runbook', async () => {
    const { createBulkAlertSink } = await import('../../data-ops/index.ts');
    const sent: AlertMessage[] = [];
    const notifier: AlertNotifier = {
      opened: (m) => {
        sent.push(m);
        return Promise.resolve();
      },
      resolved: () => Promise.resolve(),
    };
    const sink = createBulkAlertSink({ notifier: () => notifier });
    const at = new Date('2026-10-31T20:00:00Z');
    await sink.alert({
      kind: 'block',
      host: HOST,
      sourceId: 'ecourts-d1',
      signature: 'http_403',
      at,
    });
    await sink.alert({ kind: 'error', host: HOST, sourceId: 'ecourts-d1', consecutive: 5, at });
    await sink.alert({
      kind: 'host_backoff',
      host: HOST,
      until: new Date(at.getTime() + 3_600_000),
      reason: 'blocks',
      at,
    });
    expect(sent.map((m) => m.type)).toEqual(['block_signature', 'error_rate', 'block_signature']);
    expect(sent[0]?.runbookUrl).toContain('#block-signature');
    expect(sent[1]?.detail).toContain('5 consecutive errors');
    expect(sent[2]?.sourceId).toBe(HOST);
  });
});
