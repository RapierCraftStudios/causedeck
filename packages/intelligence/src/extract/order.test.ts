import type { AiGateway } from '@causedeck/ai';
import { describe, expect, it, vi } from 'vitest';

import type { PageText } from './anchors.ts';
import { extractOrder } from './order.ts';
import type { ModelOrderOutput } from './validate.ts';

const DOC = '3f2b7d0e-5a41-4b6c-9a52-0d7c1f8e2a11';
const WS = '9d4a5f6e-7182-4d9e-8fa0-2b3c4d5e6f70';
const CALL = '8c3f4e5d-6071-4c8d-8e9f-1a2b3c4d5e6f';

const TEXT = ['Dated: 05.01.2026', 'Post on 12.03.2026 for hearing.'].join('\n');
const pages: PageText[] = [{ pageNo: 1, text: TEXT, textSource: 'layer' }];

const modelOutput: ModelOrderOutput = {
  bench: [],
  orderDate: null,
  caseNumbers: [],
  neutralCitation: null,
  orderType: 'procedural',
  directions: [],
  nextDate: {
    date: '2026-03-12',
    phrase: 'Post on 12.03.2026',
    page: 1,
    quote: 'Post on 12.03.2026 for hearing.',
  },
  stageCues: [],
  confidence: 0.9,
};

const gateway = (delayMs = 0) => {
  const run = vi.fn(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          resolve({ output: modelOutput, callId: CALL });
        }, delayMs),
      ),
  );
  return { gateway: { run } as unknown as AiGateway, run };
};

const base = { documentId: DOC, pipelineVersion: 'v1', pages };

describe('extractOrder', () => {
  it('calls the gateway once with hints from the pre-parse and an idempotency key', async () => {
    const g = gateway();
    const result = await extractOrder({
      ...base,
      ai: { gateway: g.gateway, scope: { workspaceId: WS } },
    });
    expect(g.run).toHaveBeenCalledTimes(1);
    const [task, input, ctx] = g.run.mock.calls[0] as unknown as [
      string,
      { hints: { nextDates: { date: string }[] } },
      { idempotencyKey: string; automationLevel: number },
    ];
    expect(task).toBe('extract_order');
    expect(input.hints.nextDates.map((d) => d.date)).toEqual(['2026-03-12']);
    expect(ctx).toMatchObject({ idempotencyKey: `extract-order:${DOC}:v1`, automationLevel: 2 });
    expect(result.aiCallId).toBe(CALL);
    expect(result.extraction.deterministicOnly).toBe(false);
    expect(result.extraction.nextDate?.date).toBe('2026-03-12');
  });

  it('never contacts the gateway when AI is not allowed (ai_blocked or sensitive matter)', async () => {
    const g = gateway();
    const result = await extractOrder({ ...base, ai: null });
    expect(g.run).not.toHaveBeenCalled();
    expect(result.aiCallId).toBeNull();
    expect(result.extraction.deterministicOnly).toBe(true);
    expect(result.extraction.confidence).toBeLessThanOrEqual(0.6);
    expect(result.extraction.nextDate?.date).toBe('2026-03-12');
  });

  it('falls back to the deterministic result when the model runs past its budget', async () => {
    const g = gateway(200);
    const result = await extractOrder({
      ...base,
      ai: { gateway: g.gateway, scope: { workspaceId: WS } },
      modelBudgetMs: 20,
    });
    expect(result.modelTimedOut).toBe(true);
    expect(result.aiCallId).toBeNull();
    expect(result.extraction.deterministicOnly).toBe(true);
    expect(result.extraction.nextDate?.date).toBe('2026-03-12');
  });

  it('lets a gateway failure propagate so the job retries', async () => {
    const run = vi.fn(() => Promise.reject(new Error('provider down')));
    await expect(
      extractOrder({
        ...base,
        ai: { gateway: { run } as unknown as AiGateway, scope: { workspaceId: WS } },
      }),
    ).rejects.toThrow('provider down');
  });

  it('stays well inside the 40 s budget for a 20-page order (mock latency profile)', async () => {
    const twenty: PageText[] = Array.from({ length: 20 }, (_, i) => ({
      pageNo: i + 1,
      text: `${i === 0 ? 'Dated: 05.01.2026\n' : ''}${'The matter was heard at length. '.repeat(120)}${i === 19 ? '\nPost on 12.03.2026 for hearing.' : ''}`,
      textSource: 'layer' as const,
    }));
    const g = gateway(50);
    const timings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      const result = await extractOrder({
        ...base,
        pages: twenty,
        ai: { gateway: g.gateway, scope: { workspaceId: WS } },
      });
      timings.push(performance.now() - started);
      expect(result.modelTimedOut).toBe(false);
    }
    timings.sort((a, b) => a - b);
    expect(timings[Math.ceil(timings.length * 0.95) - 1] ?? Infinity).toBeLessThan(40_000);
  });
});
