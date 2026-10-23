// `system.business.cost-alert` (#519): a plan over the cost-per-user threshold emails each founder;
// under the threshold, or with no founders configured, nothing is sent. No database: the snapshot
// and the transport are injected.
import type { EmailTransport } from '@causedeck/notifications/email';
import { describe, expect, it, vi } from 'vitest';

import type { BusinessConfig, BusinessSnapshot } from '../../business/index.ts';
import { registry } from '../registry.ts';
import {
  businessCostAlert,
  founderEmails,
  businessIstDay,
  runBusinessCostAlert,
} from './business-cost-alert.ts';
import { businessDigest, runBusinessDigest } from './business-digest.ts';

const CONFIG: BusinessConfig = {
  usdInr: 100,
  infraCostPaiseMonthly: 0,
  costAlertPaisePerUser: 4000,
};
const NOW = new Date('2026-10-26T03:30:00Z');

const planOf = (aiSpendPaise: number) => ({
  planId: 'pro',
  name: 'Pro',
  pricePaise: 100_000,
  subscribers: 1,
  seats: 1,
  mrrPaise: 100_000,
  new30d: 0,
  churned30d: 0,
  dau: 1,
  wau: 1,
  mau: 1,
  aiSpendPaise,
  fetchDollars: 0,
  captchaDollars: 0,
});
const snapshotWith = (aiSpendPaise: number): BusinessSnapshot => ({
  plans: [planOf(aiSpendPaise)],
  shared: { fetchDollars: 0, captchaDollars: 0 },
});

function harness(aiSpendPaise: number, founders: string[]) {
  const send = vi.fn(() => Promise.resolve({}));
  const email: EmailTransport = { provider: 'console', send };
  const log = { info: vi.fn() };
  const deps = {
    now: () => NOW,
    snapshot: () => Promise.resolve(snapshotWith(aiSpendPaise)),
    email,
    founders,
    config: CONFIG,
  };
  const ctx = { db: {}, log } as never;
  return { send, ctx, deps };
}

describe('runBusinessCostAlert', () => {
  it('emails every founder when a plan is over the threshold', async () => {
    const { send, ctx, deps } = harness(4001, ['a@founders.test', 'b@founders.test']);
    expect(await runBusinessCostAlert(ctx, deps)).toEqual({ breaches: 1, sent: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    const [[first]] = send.mock.calls as unknown as [
      [{ to: string; subject: string; text: string }],
    ];
    expect(first).toMatchObject({ to: 'a@founders.test' });
    expect(first.subject).toBe('CauseDeck cost alert 2026-10-26: 1 plan(s) over threshold');
    expect(first.text).toContain('Pro: cost per user Rs 40.01 against Rs 40.00');
  });

  it('sends nothing at the threshold or with no founder configured', async () => {
    const at = harness(4000, ['a@founders.test']);
    expect(await runBusinessCostAlert(at.ctx, at.deps)).toEqual({ breaches: 0, sent: 0 });
    const none = harness(9000, []);
    expect(await runBusinessCostAlert(none.ctx, none.deps)).toEqual({ breaches: 1, sent: 0 });
    expect(at.send).not.toHaveBeenCalled();
    expect(none.send).not.toHaveBeenCalled();
  });

  it('is a daily system job in the registry, keyed to one run at a time', () => {
    expect(registry.definitions).toContain(businessCostAlert);
    expect(businessCostAlert.name).toBe('system.business.cost-alert');
    expect(businessCostAlert.schedule?.cron).toBe('0 8 * * *');
    expect(businessCostAlert.singleton?.key({})).toBe('business-cost-alert');
  });

  it('parses the founder list and the IST day', () => {
    expect(founderEmails(' a@x.test, b@x.test ,')).toEqual(['a@x.test', 'b@x.test']);
    expect(founderEmails(undefined)).toEqual([]);
    expect(businessIstDay(new Date('2026-10-25T20:00:00Z'))).toBe('2026-10-26');
  });
});

describe('runBusinessDigest', () => {
  it('emails each founder the digest with the breach listed', async () => {
    const { send, ctx, deps } = harness(5000, ['a@founders.test']);
    expect(await runBusinessDigest(ctx, deps)).toEqual({ sent: 1 });
    const [[message]] = send.mock.calls as unknown as [[{ subject: string; text: string }]];
    expect(message.subject).toBe('CauseDeck business digest, week of 2026-10-26');
    expect(message.text).toContain('MRR Rs 1000.00, ARR Rs 12000.00');
    expect(message.text).toContain('Over the cost-per-user threshold:');
  });

  it('sends nothing with no founder configured', async () => {
    const { send, ctx, deps } = harness(5000, []);
    expect(await runBusinessDigest(ctx, deps)).toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('is a weekly system job in the registry', () => {
    expect(registry.definitions).toContain(businessDigest);
    expect(businessDigest.name).toBe('system.business.digest');
    expect(businessDigest.schedule?.cron).toBe('0 9 * * 1');
  });
});
