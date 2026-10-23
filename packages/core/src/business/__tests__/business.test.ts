// The business domain (#519): snapshot parsing, the cost-per-user maths with its breakdown, the
// threshold and the digest and alert emails. Pure; no database.
import { describe, expect, it } from 'vitest';

import {
  buildBusinessReport,
  businessConfigFromEnv,
  evaluateCostThresholds,
  parseBusinessSnapshot,
  renderBusinessDigest,
  renderCostAlert,
  type BusinessConfig,
  type PlanSnapshot,
} from '../index.ts';

const CONFIG: BusinessConfig = { usdInr: 100, infraCostPaiseMonthly: 1000, costAlertPaisePerUser: 4000 };

const plan = (over: Partial<PlanSnapshot>): PlanSnapshot => ({
  planId: 'free',
  name: 'Free',
  pricePaise: 0,
  subscribers: 0,
  seats: 0,
  mrrPaise: 0,
  new30d: 0,
  churned30d: 0,
  dau: 0,
  wau: 0,
  mau: 0,
  aiSpendPaise: 0,
  fetchDollars: 0,
  captchaDollars: 0,
  ...over,
});

// Free: 3 active users. Pro: 1 active user, a MRR of 2000 (annual 24000 / 12), AI 500 paise, delegated
// fetch $0.10 (1000 paise) and captcha $0.05 (500 paise). Shared: $0.04 fetch, $0.01 captcha.
const SNAPSHOT = {
  plans: [
    plan({ subscribers: 8, mau: 3, dau: 1, wau: 2, aiSpendPaise: 300 }),
    plan({
      planId: 'pro',
      name: 'Pro',
      pricePaise: 24_000,
      subscribers: 2,
      mrrPaise: 2000,
      mau: 1,
      dau: 1,
      wau: 1,
      new30d: 1,
      churned30d: 1,
      aiSpendPaise: 500,
      fetchDollars: 0.1,
      captchaDollars: 0.05,
    }),
  ],
  shared: { fetchDollars: 0.04, captchaDollars: 0.01 },
};

describe('buildBusinessReport', () => {
  const report = buildBusinessReport(SNAPSHOT, CONFIG);
  const pro = report.plans.find((p) => p.planId === 'pro');
  const free = report.plans.find((p) => p.planId === 'free');

  it('splits cost per user into fetch, captcha, AI and infrastructure (dollars to paise once)', () => {
    // Pro owns 1 of 4 active users: shared fetch 400 and captcha 100 paise, a quarter each; infra 250.
    expect(pro?.costPerUser).toEqual({
      fetchPaise: 1000 + 100,
      captchaPaise: 500 + 25,
      aiPaise: 500,
      infraPaise: 250,
      totalPaise: 1100 + 525 + 500 + 250,
    });
    // Free: 3 of 4; per user the share cancels out: shared 300/3 and 75/3, AI 100, infra 750/3.
    expect(free?.costPerUser).toEqual({
      fetchPaise: 100,
      captchaPaise: 25,
      aiPaise: 100,
      infraPaise: 250,
      totalPaise: 475,
    });
  });

  it('counts MRR from the snapshot, ARR as twelve months, and margin per plan', () => {
    expect(pro?.mrrPaise).toBe(2000);
    expect(pro?.arrPaise).toBe(24_000);
    expect(pro?.grossMarginBps).toBe(Math.round(((2000 - 2375) / 2000) * 10_000));
    expect(free?.grossMarginBps).toBeNull();
    expect(report.mrrPaise).toBe(2000);
  });

  it('computes conversion and churn', () => {
    expect(report.conversionBps).toBe(2000); // 2 paid of 10
    // Pro: 2 live now, 1 new, 1 churned: 2 at the start of the window, 1 lost.
    expect(pro?.churnBps).toBe(5000);
    expect(report.churnBps).toBe(5000);
    expect([report.dau, report.wau, report.mau]).toEqual([2, 3, 4]);
  });

  it('is zero and null, not NaN, with no data', () => {
    const empty = buildBusinessReport({ plans: [], shared: { fetchDollars: 0, captchaDollars: 0 } }, CONFIG);
    expect(empty).toMatchObject({ mrrPaise: 0, conversionBps: null, churnBps: null, grossMarginBps: null });
  });

  it('reads the settings from the env', () => {
    expect(
      businessConfigFromEnv({
        BUSINESS_USD_INR: 85,
        BUSINESS_INFRA_COST_PAISE_MONTHLY: 0,
        BUSINESS_COST_PER_USER_ALERT_PAISE: 4000,
      }),
    ).toEqual({ usdInr: 85, infraCostPaiseMonthly: 0, costAlertPaisePerUser: 4000 });
  });
});

describe('evaluateCostThresholds', () => {
  const report = buildBusinessReport(SNAPSHOT, CONFIG);

  it('flags a plan whose cost per user is over the threshold, and only that plan', () => {
    const breaches = evaluateCostThresholds(report, 2000);
    expect(breaches.map((b) => b.planId)).toEqual(['pro']);
    expect(breaches[0]?.thresholdPaise).toBe(2000);
    expect(report.plans.find((p) => p.planId === 'pro')?.overThreshold).toBe(false);
  });

  it('does not flag a cost at or under the threshold, nor a plan with no active user', () => {
    expect(evaluateCostThresholds(report, 2375)).toEqual([]);
    const idle = buildBusinessReport({ plans: [plan({ aiSpendPaise: 9999 })], shared: { fetchDollars: 0, captchaDollars: 0 } }, CONFIG);
    expect(evaluateCostThresholds(idle, 1)).toEqual([]);
  });

  it('orders breaches most expensive first', () => {
    const breaches = evaluateCostThresholds(report, 100);
    expect(breaches.map((b) => b.planId)).toEqual(['pro', 'free']);
  });
});

describe('digest and alert emails', () => {
  const report = buildBusinessReport(SNAPSHOT, CONFIG);
  const breaches = evaluateCostThresholds(report, 2000);

  it('puts the figures and the breach in the weekly digest', () => {
    const mail = renderBusinessDigest(report, breaches, '2026-10-26');
    expect(mail.subject).toBe('CauseDeck business digest, week of 2026-10-26');
    expect(mail.text).toContain('MRR Rs 20.00, ARR Rs 240.00');
    expect(mail.text).toContain('Free to paid: 20.0%');
    expect(mail.text).toContain('Pro: 1 active, cost per user Rs 23.75 (fetch Rs 11.00, captcha Rs 5.25, AI Rs 5.00, infra Rs 2.50)');
    expect(mail.text).toContain('Over the cost-per-user threshold:');
    expect(mail.html).toContain('<p>');
  });

  it('names each breaching plan in the alert and escapes the HTML part', () => {
    const mail = renderCostAlert(breaches.map((b) => ({ ...b, name: '<b>Pro</b>' })), '2026-10-26');
    expect(mail.subject).toBe('CauseDeck cost alert 2026-10-26: 1 plan(s) over threshold');
    expect(mail.text).toContain('<b>Pro</b>: cost per user Rs 23.75 against Rs 20.00');
    expect(mail.html).toContain('&lt;b&gt;Pro&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>');
  });
});

describe('parseBusinessSnapshot', () => {
  it('reads a jsonb object or its text and coerces numeric strings', () => {
    const doc = { plans: [{ planId: 'pro', name: 'Pro', mrrPaise: '2000.5', mau: 3 }], shared: { fetchDollars: '0.5' } };
    for (const raw of [doc, JSON.stringify(doc)]) {
      const parsed = parseBusinessSnapshot(raw);
      expect(parsed.plans[0]).toMatchObject({ planId: 'pro', mrrPaise: 2000.5, mau: 3, dau: 0 });
      expect(parsed.shared).toEqual({ fetchDollars: 0.5, captchaDollars: 0 });
    }
  });

  it('is empty for a missing document', () => {
    expect(parseBusinessSnapshot(undefined)).toEqual({ plans: [], shared: { fetchDollars: 0, captchaDollars: 0 } });
  });
});
