// ai_call to usage_event reconciliation (#225): matched calls, the three mismatch kinds, period
// filtering, workspace isolation and the gateway protocol end to end.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import { recordAiCall, type AiCallInput } from '../../audit/ai-call.ts';
import { newWorkspace } from '../../audit/__tests__/fixtures.ts';
import { commit, reserve } from '../budget.ts';
import { increment } from '../meter.ts';
import { usagePeriod } from '../period.ts';
import { reconcileAiCalls } from '../reconcile.ts';

const NOW = new Date('2026-03-10T06:30:00.000Z');
const MARCH = usagePeriod(NOW);
const APRIL = usagePeriod(new Date('2026-04-10T06:30:00.000Z'));

const call = (costPaise: number): AiCallInput => ({
  purpose: 'brief.draft',
  provider: 'mock',
  model: 'mock-1',
  region: 'ap-south-1',
  inputTokens: 100,
  outputTokens: 20,
  costPaise,
  automationLevel: 2,
});

/** An `ai_call` row created at `at` (recordAiCall stamps the transaction's now()). */
async function aiCallAt(tx: Transaction, workspaceId: string, costPaise: number, at = NOW) {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.aiCall)
      .values({ workspaceId, ...call(costPaise), createdAt: at })
      .returning({ id: schema.aiCall.id }),
  );
  if (!row) throw new Error('ai_call insert failed');
  return row.id;
}

function spend(tx: Transaction, workspaceId: string, amount: number, aiCallId: string, at = NOW) {
  return increment({ db: tx, workspaceId }, 'ai.spend_paise', amount, {
    idempotencyKey: `spend:${randomUUID()}`,
    metadata: { ai_call_id: aiCallId },
    at,
  });
}

describe('reconcileAiCalls', () => {
  it('matches each ai_call with its ledger total and reports every mismatch kind', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const ctx = { db: tx, workspaceId: a.id, now: () => NOW };
      expect(await reconcileAiCalls(ctx)).toEqual({
        period: MARCH,
        checked: 0,
        matched: 0,
        mismatches: [],
      });

      // Matched, including a spend split over two ledger rows.
      const ok = await aiCallAt(tx, a.id, 120);
      await spend(tx, a.id, 120, ok);
      const split = await aiCallAt(tx, a.id, 50);
      await spend(tx, a.id, 30, split);
      await spend(tx, a.id, 20, split);
      // A call with no ledger row.
      const missing = await aiCallAt(tx, a.id, 40);
      // A ledger row naming no call.
      const orphan = randomUUID();
      await spend(tx, a.id, 15, orphan);
      // A call whose ledger total differs.
      const off = await aiCallAt(tx, a.id, 90);
      await spend(tx, a.id, 70, off);
      // Not part of the reconciliation: other keys and spend without an ai_call_id.
      await increment(ctx, 'ai.tokens_in', 100, {
        idempotencyKey: 'tokens',
        metadata: { ai_call_id: ok },
      });
      await increment(ctx, 'ai.spend_paise', 5, { idempotencyKey: 'unlinked' });

      const result = await reconcileAiCalls(ctx, MARCH);
      expect(result.checked).toBe(5);
      expect(result.matched).toBe(2);
      expect(result.mismatches).toEqual(
        [
          { aiCallId: missing, kind: 'missing_usage', costPaise: 40, usagePaise: null },
          { aiCallId: orphan, kind: 'orphan_usage', costPaise: null, usagePaise: 15 },
          { aiCallId: off, kind: 'amount_mismatch', costPaise: 90, usagePaise: 70 },
        ].sort((x, y) => x.aiCallId.localeCompare(y.aiCallId)),
      );
    });
  });

  it('only reads rows created in the period', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const ctx = { db: tx, workspaceId: a.id };
      const march = await aiCallAt(tx, a.id, 10);
      await spend(tx, a.id, 10, march);
      const april = await aiCallAt(tx, a.id, 20, new Date(APRIL.start.getTime() + 60_000));
      await spend(tx, a.id, 20, april, new Date(APRIL.start.getTime() + 60_000));
      // A call at 23:59 IST on 31 March whose spend lands in April shows up in both periods.
      const edge = await aiCallAt(tx, a.id, 7, new Date(APRIL.start.getTime() - 60_000));
      await spend(tx, a.id, 7, edge, new Date(APRIL.start.getTime() + 60_000));

      const inMarch = await reconcileAiCalls(ctx, MARCH);
      expect(inMarch).toMatchObject({ checked: 2, matched: 1 });
      expect(inMarch.mismatches).toEqual([
        { aiCallId: edge, kind: 'missing_usage', costPaise: 7, usagePaise: null },
      ]);
      const inApril = await reconcileAiCalls(ctx, APRIL);
      expect(inApril).toMatchObject({ checked: 2, matched: 1 });
      expect(inApril.mismatches).toEqual([
        { aiCallId: edge, kind: 'orphan_usage', costPaise: null, usagePaise: 7 },
      ]);
    });
  });

  it("never sees another workspace's calls or spend", async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seedTwoTenants(tx);
      const id = await aiCallAt(tx, a.id, 33);
      await spend(tx, a.id, 30, id);
      expect(await reconcileAiCalls({ db: tx, workspaceId: b.id }, MARCH)).toEqual({
        period: MARCH,
        checked: 0,
        matched: 0,
        mismatches: [],
      });
      expect((await reconcileAiCalls({ db: tx, workspaceId: a.id }, MARCH)).mismatches).toEqual([
        { aiCallId: id, kind: 'amount_mismatch', costPaise: 33, usagePaise: 30 },
      ]);
    });
  });

  it('reconciles cleanly after the gateway protocol: reserve, recordAiCall, commit with aiCallId', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { workspaceId } = await newWorkspace(tx);
      const now = new Date();
      const ctx = { db: tx, workspaceId, now: () => now };
      const r = await reserve(ctx, { estimatePaise: 300, purpose: 'brief.draft' });
      const { id } = await recordAiCall(tx, workspaceId, call(240));
      expect(await commit(ctx, r, 240, { aiCallId: id })).toMatchObject({ applied: true });

      const result = await reconcileAiCalls(ctx);
      expect(result).toEqual({ period: usagePeriod(now), checked: 1, matched: 1, mismatches: [] });
    });
  });
});
