// Limitation tracker tables (#84, part 1): a platform rule (null workspace_id) is readable by a
// workspace only once counsel has reviewed it; a workspace's own rules and computations stay inside
// it; a computation can cite a platform rule or its own workspace's rule, never another workspace's.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOwnerDb } from '../owner.ts';
import { limitationComputation, limitationRule } from '../schema/limitation.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { seedTwoTenants } from '../testing/two-tenants.ts';
import { sqlState } from './rls/fixtures.ts';

// Platform rows are written by the owner role and committed: the app-role transactions below read them.
const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const TAG = randomUUID().slice(0, 8);
const REVIEWED = `p.reviewed.${TAG}`;
const PENDING = `p.pending.${TAG}`;

beforeAll(async () => {
  await owner.insert(limitationRule).values([platform(REVIEWED, true), platform(PENDING, false)]);
});
afterAll(async () => {
  await owner.delete(limitationRule).where(inArray(limitationRule.code, [REVIEWED, PENDING]));
  await owner.$client.end();
});

function platform(code: string, reviewed: boolean) {
  return {
    workspaceId: null,
    code,
    title: 'Platform rule',
    statute: 'Limitation Act 1963',
    periodValue: 3,
    periodUnit: 'years',
    startEvent: 'cause_of_action',
    tableVersion: 'v1',
    reviewed,
    reviewedAt: reviewed ? new Date() : null,
  };
}

describe('limitation_rule platform policy (#84)', () => {
  it('shows a workspace reviewed platform rules and its own rules only', async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seedTwoTenants(tx);
      const codes = (ws: string) =>
        inWorkspace(tx, ws, async (scoped) =>
          (await scoped.select({ code: limitationRule.code }).from(limitationRule)).map(
            (r) => r.code,
          ),
        );
      const aCodes = await codes(a.id);
      expect(aCodes).toContain(REVIEWED);
      expect(aCodes).not.toContain(PENDING);
      const own = (list: string[]) => list.filter((c) => c.startsWith('xt.'));
      expect(own(aCodes).length).toBeGreaterThan(0);
      const bCodes = await codes(b.id);
      expect(bCodes).toContain(REVIEWED);
      expect(bCodes).not.toContain(PENDING);
      expect(own(bCodes).length).toBeGreaterThan(0);
      expect(own(aCodes).filter((c) => own(bCodes).includes(c))).toEqual([]);
    });
  });

  it('requires a review date on a reviewed rule', async () => {
    const state = await sqlState(
      owner.transaction((tx) =>
        tx.insert(limitationRule).values({ ...platform(`p.bad.${TAG}`, true), reviewedAt: null }),
      ),
    );
    expect(state).toBe('23514');
  });
});

describe('limitation_computation (#84)', () => {
  it("hides one workspace's computations from the other and rejects another workspace's rule", async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seedTwoTenants(tx);
      const aComputation = a.rows.limitation_computation?.id ?? '';
      const bRule = b.rows.limitation_rule?.id ?? '';
      await inWorkspace(tx, b.id, async (scoped) => {
        expect(
          await scoped
            .select({ id: limitationComputation.id })
            .from(limitationComputation)
            .where(eq(limitationComputation.id, aComputation)),
        ).toEqual([]);
      });
      await inWorkspace(tx, a.id, async (scoped) => {
        const state = await sqlState(
          scoped.transaction((sp) =>
            sp.insert(limitationComputation).values({
              workspaceId: a.id,
              matterId: a.rows.limitation_computation?.matterId ?? '',
              ruleId: bRule,
              input: {},
              result: {},
              startDate: '2026-04-01',
              expiresOn: '2029-04-01',
            }),
          ),
        );
        expect(state).toBeDefined();
      });
    });
  });
});
