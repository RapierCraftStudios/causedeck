// The AI gateway wiring (#44): budgets, ai_call rows, India-only and sensitive policy, idempotent
// results and per-capture cost, against a real database.
import { randomUUID } from 'node:crypto';

import {
  BudgetExceededError,
  getTask,
  ResidencyViolationError,
  SensitiveMatterBlockedError,
  type Provider,
} from '@causedeck/ai';
import { createEnv } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { getUsage, reconcileAiCalls } from '../../usage/index.ts';
import {
  createAiPorts,
  createCoreAiGateway,
  embedBatchSizeFromEnv,
  embedProviderFromEnv,
  getCaptureCostPaise,
  previewPlanProviderFromEnv,
} from '../wiring.ts';

// The real clock: `ai_call.created_at` is the database's now(), and reconciliation matches calls and
// ledger rows by period, so a fixed clock would put them in different months.
const now = () => new Date();

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

// #1165: the preview-only chatgpt-plan provider answers demo workspaces only, at zero cost.
describe('preview plan provider', () => {
  const SOURCE = 'The surgery was done without informed consent.';
  const question = {
    question: 'surgery without informed consent',
    sources: [{ id: 'doc:d1:2', text: SOURCE }],
  };
  const plan: Provider = {
    id: 'chatgpt-plan',
    region: 'openai',
    dataResidency: 'other',
    supports: ['answer_matter_question', 'answer_research_query'],
    modelFor: () => 'gpt-plan-test',
    call: () =>
      Promise.resolve({
        output: {
          claims: [{ statement: 'No consent was taken.', sourceId: 'doc:d1:2', quote: SOURCE }],
        },
        usage: { inputTokens: 900, outputTokens: 80 },
        model: 'gpt-plan-test',
      }),
  };
  const ctxFor = (workspaceId: string) => ({ workspaceId, purpose: 'copilot.answer' });

  it('a demo workspace writes an ok ai_call row for chatgpt-plan at cost 0, with no text or reservation', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ isDemo: true, slug: `demo-${workspaceId.slice(0, 8)}` })
          .where(eq(schema.organization.id, workspaceId)),
      );
      const gateway = createCoreAiGateway(tx, { now, providers: [plan] });
      const result = await gateway.run('answer_matter_question', question, ctxFor(workspaceId));
      expect((result.output as { claims: unknown[] }).claims).toHaveLength(1);
      const rows = await calls(tx, workspaceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: 'chatgpt-plan',
        model: 'gpt-plan-test',
        status: 'ok',
        costPaise: 0,
      });
      const text = JSON.stringify(rows);
      expect(text).not.toContain('informed consent');
      expect(text).not.toContain('surgery');
      const reservations = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.usageReservation)
          .where(eq(schema.usageReservation.workspaceId, workspaceId)),
      );
      expect(reservations).toEqual([]);
      expect(await getUsage({ db: tx, workspaceId, now }, 'ai.spend_paise')).toBe(0);
    });
  });

  it('a non-demo workspace raises ResidencyViolationError and audits provider none', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const call = vi.spyOn(plan, 'call');
      const gateway = createCoreAiGateway(tx, { now, providers: [plan] });
      await expect(
        gateway.run('answer_matter_question', question, ctxFor(workspaceId)),
      ).rejects.toBeInstanceOf(ResidencyViolationError);
      expect(call).not.toHaveBeenCalled();
      call.mockRestore();
      const rows = await calls(tx, workspaceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'residency_violation', provider: 'none' });
    });
  });

  it('a demo workspace without a demo slug is not a preview-plan workspace', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ isDemo: true })
          .where(eq(schema.organization.id, workspaceId)),
      );
      const gateway = createCoreAiGateway(tx, { now, providers: [plan] });
      await expect(
        gateway.run('answer_matter_question', question, ctxFor(workspaceId)),
      ).rejects.toBeInstanceOf(ResidencyViolationError);
    });
  });

  it('builds the provider only for AI_PROVIDER=chatgpt-plan with the allow flag', () => {
    const base = { NODE_ENV: 'test', SKIP_ENV_VALIDATION: undefined };
    const planEnv = {
      ...base,
      AI_PROVIDER: 'chatgpt-plan',
      CHATGPT_PLAN_TOKEN_FILE: '/tmp/plan-tokens.json',
      CHATGPT_PLAN_MODEL: 'gpt-plan-test',
    };
    expect(previewPlanProviderFromEnv(createEnv({ ...base, AI_PROVIDER: 'mock' }))).toBeNull();
    expect(previewPlanProviderFromEnv(createEnv(planEnv))).toBeNull();
    const env = createEnv({ ...planEnv, ALLOW_PREVIEW_PLAN_PROVIDER: 'true' });
    const provider = previewPlanProviderFromEnv(env);
    expect(provider).toMatchObject({ id: 'chatgpt-plan', dataResidency: 'other' });
    expect(provider?.modelFor(getTask('answer_matter_question'))).toBe('gpt-plan-test');
    expect(previewPlanProviderFromEnv(env)).toBe(provider);
  });

  it('embedProviderFromEnv selects bge-m3 only when EMBED_PROVIDER=bge-m3 and BGE_M3_URL are set', () => {
    const base = { NODE_ENV: 'test', SKIP_ENV_VALIDATION: undefined };
    const defaults = createEnv(base);
    const mock = embedProviderFromEnv(defaults);
    expect(mock).toMatchObject({ id: 'mock-embed', model: 'mock-embed', dataResidency: 'in' });
    expect(embedProviderFromEnv(defaults)).toBe(mock);
    expect(embedBatchSizeFromEnv(defaults)).toBe(32);

    const bgeEnv = { ...base, EMBED_PROVIDER: 'bge-m3', BGE_M3_URL: 'http://embed:8080' };
    const bge = embedProviderFromEnv(createEnv(bgeEnv));
    expect(bge).toMatchObject({
      id: 'bge-m3',
      model: 'bge-m3',
      region: 'self-hosted',
      dataResidency: 'other',
    });
    const preview = createEnv({ ...bgeEnv, ALLOW_PREVIEW_SELF_HOSTED_EMBED: 'true' });
    expect(embedProviderFromEnv(preview)).toMatchObject({ id: 'bge-m3', dataResidency: 'in' });
    expect(embedProviderFromEnv(preview)).toBe(embedProviderFromEnv(preview));
    expect(() => createEnv({ ...base, EMBED_PROVIDER: 'bge-m3' })).toThrow(/BGE_M3_URL/);
    expect(embedBatchSizeFromEnv(createEnv({ ...base, EMBED_BATCH_SIZE: '16' }))).toBe(16);
  });
});
