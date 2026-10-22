// The AI gateway wiring (#44): budgets, ai_call rows, India-only and sensitive policy, idempotent
// results and per-capture cost, against a real database.
import { randomUUID } from 'node:crypto';

import { BudgetExceededError, SensitiveMatterBlockedError, type Provider } from '@causedeck/ai';
import { schema } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { getUsage, reconcileAiCalls } from '../../usage/index.ts';
import { createAiPorts, createCoreAiGateway, getCaptureCostPaise } from '../wiring.ts';

const NOW = new Date('2026-03-10T06:30:00.000Z');
const now = () => NOW;

/** An in-region provider that reports `inputTokens` of Haiku-class usage (8400 paise per 1M). */
function bedrock(inputTokens: number): Provider {
  return {
    id: 'bedrock',
    region: 'ap-south-1',
    dataResidency: 'in',
    supports: ['classify_document'],
    modelFor: () => 'apac.anthropic.claude-haiku',
    call: () =>
      Promise.resolve({
        output: { documentType: 'order', confidence: 0.9 },
        usage: { inputTokens, outputTokens: 0 },
        model: 'apac.anthropic.claude-haiku',
      }),
  };
}

const input = { text: 'Order dated 2026-01-12.' };

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  await seedPlans(tx);
  return newWorkspace(tx);
}

const calls = (tx: Parameters<Parameters<typeof withTestDb>[0]>[0], workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
  );

describe('createCoreAiGateway', () => {
  it('reserves, writes the ai_call row, commits the spend and reconciles', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const captureId = randomUUID();
      const gateway = createCoreAiGateway(tx, { now, providers: [bedrock(100_000)] });

      const result = await gateway.run('classify_document', input, {
        workspaceId,
        captureId,
        purpose: 'capture.classify',
      });

      // 100_000 tokens x 8400 paise per million = 840 paise.
      expect(result.usage.costPaise).toBe(840);
      const [row] = await calls(tx, workspaceId);
      expect(row).toMatchObject({
        id: result.callId,
        task: 'classify_document',
        status: 'ok',
        provider: 'bedrock',
        region: 'ap-south-1',
        costPaise: 840,
        captureId,
        suspicious: false,
      });
      expect(row?.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await getUsage({ db: tx, workspaceId, now }, 'ai.spend_paise')).toBe(840);
      expect((await reconcileAiCalls({ db: tx, workspaceId, now })).mismatches).toEqual([]);
      expect(await getCaptureCostPaise(tx, workspaceId, captureId)).toBe(840);
    });
  });

  it('throws BudgetExceededError over budget, audits it and leaves no reservation', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      // Junior budget is 1_000 paise: 200_000 tokens estimate nothing, but a 2M-token input does.
      const gateway = createCoreAiGateway(tx, { now, providers: [bedrock(0)] });
      const huge = { text: 'x'.repeat(3_000_000) };
      await expect(
        gateway.run('classify_document', huge, { workspaceId, purpose: 'capture.classify' }),
      ).rejects.toBeInstanceOf(BudgetExceededError);
      const rows = await calls(tx, workspaceId);
      expect(rows.map((r) => r.status)).toEqual(['budget_exceeded']);
      const held = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.usageReservation),
      );
      expect(held).toEqual([]);
    });
  });

  it('blocks a sensitive matter before the provider is contacted', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const [matter] = await inWorkspace(tx, workspaceId, (s) =>
        s
          .insert(schema.matter)
          .values({ workspaceId, title: 'Sensitive', practiceArea: 'family', sensitive: true })
          .returning({ id: schema.matter.id }),
      );
      const provider = bedrock(10);
      const spy = vi.spyOn(provider, 'call');
      const gateway = createCoreAiGateway(tx, { now, providers: [provider] });
      await expect(
        gateway.run('classify_document', input, {
          workspaceId,
          matterId: matter?.id ?? '',
          purpose: 'capture.classify',
        }),
      ).rejects.toBeInstanceOf(SensitiveMatterBlockedError);
      expect(spy).not.toHaveBeenCalled();
      const [row] = await calls(tx, workspaceId);
      expect(row).toMatchObject({
        status: 'blocked_sensitive',
        inputSha256: null,
        provider: 'none',
      });
    });
  });

  it('blocks an ai_blocked capture through the supplied check', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const gateway = createCoreAiGateway(tx, {
        now,
        providers: [bedrock(10)],
        isCaptureAiBlocked: () => Promise.resolve(true),
      });
      await expect(
        gateway.run('classify_document', input, {
          workspaceId,
          captureId: randomUUID(),
          purpose: 'capture.classify',
        }),
      ).rejects.toBeInstanceOf(SensitiveMatterBlockedError);
    });
  });

  it('defaults to the mock provider and India-only on', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const policy = await createAiPorts(tx, { now }).settings.getPolicy(workspaceId, {});
      expect(policy).toMatchObject({
        indiaOnly: true,
        matterSensitive: false,
        captureAiBlocked: false,
      });
      const result = await createCoreAiGateway(tx, { now }).run('classify_document', input, {
        workspaceId,
        purpose: 'capture.classify',
      });
      expect(result).toMatchObject({ provider: 'mock', usage: { costPaise: 0 } });
    });
  });

  it('reuses the stored result for a job retry instead of paying twice', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const provider = bedrock(100_000);
      const spy = vi.spyOn(provider, 'call');
      const gateway = createCoreAiGateway(tx, { now, providers: [provider] });
      const ctx = { workspaceId, purpose: 'capture.classify', idempotencyKey: 'job-42' };
      const first = await gateway.run('classify_document', input, ctx);
      const retry = await gateway.run('classify_document', input, ctx);
      expect(retry).toEqual(first);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await calls(tx, workspaceId)).toHaveLength(1);
      expect(await getUsage({ db: tx, workspaceId, now }, 'ai.spend_paise')).toBe(840);
    });
  });
});

describe('cross-tenant isolation', () => {
  it('ai_call and ai_call_result rows are visible only in their own workspace', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const gateway = createCoreAiGateway(tx, { now, providers: [bedrock(1_000)] });
      await gateway.run('classify_document', input, {
        workspaceId: a.workspaceId,
        purpose: 'capture.classify',
        idempotencyKey: 'job-a',
      });
      expect(await calls(tx, a.workspaceId)).toHaveLength(1);
      expect(await calls(tx, b.workspaceId)).toEqual([]);
      const results = (workspaceId: string) =>
        inWorkspace(tx, workspaceId, (s) =>
          s
            .select()
            .from(schema.aiCallResult)
            .where(and(eq(schema.aiCallResult.idempotencyKey, 'job-a:classify_document'))),
        );
      expect(await results(a.workspaceId)).toHaveLength(1);
      expect(await results(b.workspaceId)).toEqual([]);
      // B cannot reuse A's key: it runs its own call.
      const other = await gateway.run('classify_document', input, {
        workspaceId: b.workspaceId,
        purpose: 'capture.classify',
        idempotencyKey: 'job-a',
      });
      expect(other.callId).not.toBe((await calls(tx, a.workspaceId))[0]?.id);
    });
  });
});
