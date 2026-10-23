// @vitest-environment jsdom
// The Business page (#519): MRR/ARR, active users, conversion and churn, and per-plan cost to serve
// with its fetch/captcha/AI/infrastructure breakdown and margin, rendered from a stubbed data layer
// with a breach marker; and the role gate: support and ops are denied, admin reaches it.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as audit from '@causedeck/core/audit';
import type * as business from '@causedeck/core/business';
import { buildBusinessReport, evaluateCostThresholds } from '@causedeck/core/business';

import { canStaff } from '../lib/roles.ts';

const mocks = vi.hoisted(() => ({ requireStaff: vi.fn(), snapshot: vi.fn() }));

vi.mock('../lib/staff.ts', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('../lib/env.ts', () => ({
  serverEnv: () => ({
    BUSINESS_USD_INR: 100,
    BUSINESS_INFRA_COST_PAISE_MONTHLY: 0,
    BUSINESS_COST_PER_USER_ALERT_PAISE: 4000,
  }),
}));
vi.mock('@causedeck/core/runtime', () => ({ db: { runtime: true } }));
vi.mock('@causedeck/core/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof audit>()),
  record: vi.fn(() => Promise.resolve()),
}));
vi.mock('@causedeck/core/business', async (importOriginal) => ({
  ...(await importOriginal<typeof business>()),
  staffBusinessSnapshot: mocks.snapshot,
}));

const { default: BusinessPage } = await import('../app/(console)/business/page.tsx');
const { businessMetrics } = await import('../lib/data/index.ts');

afterEach(cleanup);

const ADMIN = { userId: '0192d3b0-0000-7000-8000-000000000519', role: 'admin' as const };

const plan = (over: Record<string, unknown>) => ({
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

// Pro: 2 active users; AI 6000 paise, fetch $1 and captcha $0.5 at Rs 100 per dollar (10000 and
// 5000 paise), so per user: fetch 5000, captcha 2500, AI 3000, total 10500, over the 4000 threshold.
const SNAPSHOT = {
  plans: [
    plan({ subscribers: 8, mau: 3, dau: 1, wau: 2 }),
    plan({
      planId: 'pro',
      name: 'Pro',
      pricePaise: 100_000,
      subscribers: 2,
      mrrPaise: 200_000,
      mau: 2,
      dau: 1,
      wau: 2,
      churned30d: 1,
      new30d: 1,
      aiSpendPaise: 6000,
      fetchDollars: 1,
      captchaDollars: 0.5,
    }),
  ],
  shared: { fetchDollars: 0, captchaDollars: 0 },
};

describe('Business page', () => {
  it('renders the breakdown and marks the plan over the threshold', async () => {
    mocks.requireStaff.mockResolvedValue(ADMIN);
    mocks.snapshot.mockResolvedValue(SNAPSHOT);
    render(await BusinessPage());

    expect(mocks.requireStaff).toHaveBeenCalledWith('business');
    const row = screen.getByRole('row', { name: /^Pro/ });
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    // subscribers, MRR, ARR, daily, weekly, monthly, churn, fetch, captcha, AI, infra, total, margin
    expect(cells).toEqual([
      '2',
      'Rs 2000.00',
      'Rs 24000.00',
      '1',
      '2',
      '2',
      '50.0%',
      'Rs 50.00',
      'Rs 25.00',
      'Rs 30.00',
      'Rs 0.00',
      'Rs 105.00',
      '89.5%',
    ]);
    expect(within(row).getByText('Over threshold')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Pro');
    expect(screen.getByText('Free to paid').nextSibling?.textContent).toBe('20.0%');
  });

  it('agrees with the pure report the digest uses', () => {
    const report = buildBusinessReport(SNAPSHOT, {
      usdInr: 100,
      infraCostPaiseMonthly: 0,
      costAlertPaisePerUser: 4000,
    });
    expect(evaluateCostThresholds(report, 4000).map((b) => b.planId)).toEqual(['pro']);
  });
});

describe('Business role gate', () => {
  it('reaches admin only', () => {
    expect(canStaff('admin', 'business')).toBe(true);
    expect(canStaff('support', 'business')).toBe(false);
    expect(canStaff('ops', 'business')).toBe(false);
  });

  it.each(['support', 'ops'] as const)(
    'refuses %s in the data layer before any read',
    async (role) => {
      mocks.snapshot.mockClear();
      await expect(
        businessMetrics(
          { userId: ADMIN.userId, role },
          { usdInr: 100, infraCostPaiseMonthly: 0, costAlertPaisePerUser: 4000 },
        ),
      ).rejects.toThrow(/may not read business\.metrics/);
      expect(mocks.snapshot).not.toHaveBeenCalled();
    },
  );
});
