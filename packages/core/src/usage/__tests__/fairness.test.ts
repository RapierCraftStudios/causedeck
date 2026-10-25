// Per-plan job-queue fairness defaults (#221) that the #15 worker reads.
import { PLAN_KINDS } from '@causedeck/billing';
import { seedPlans } from '@causedeck/db/seed/plans';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { DEFAULT_FAIRNESS_CONCURRENCY } from '../../jobs/index.ts';
import {
  FAIRNESS_CONCURRENCY_BY_PLAN,
  fairnessConcurrencyForPlan,
  getWorkspaceFairnessConcurrency,
} from '../fairness.ts';

describe('fairness defaults', () => {
  it('gives every plan kind a cap in [1, DEFAULT_FAIRNESS_CONCURRENCY]', () => {
    for (const kind of PLAN_KINDS) {
      const n = FAIRNESS_CONCURRENCY_BY_PLAN[kind];
      expect(Number.isInteger(n), kind).toBe(true);
      expect(n, kind).toBeGreaterThanOrEqual(1);
      expect(n, kind).toBeLessThanOrEqual(DEFAULT_FAIRNESS_CONCURRENCY);
    }
  });

  it('maps plan ids by kind and an unknown id to Junior', () => {
    expect(fairnessConcurrencyForPlan('junior')).toBe(1);
    expect(fairnessConcurrencyForPlan('advocate-monthly-2')).toBe(2);
    expect(fairnessConcurrencyForPlan('chamber-seat-1')).toBe(3);
    expect(fairnessConcurrencyForPlan('retired-plan')).toBe(1);
  });

  it('resolves a workspace without a subscription to Junior', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { workspaceId } = await newWorkspace(tx);
      expect(await getWorkspaceFairnessConcurrency(tx, workspaceId)).toBe(1);
    });
  });
});
