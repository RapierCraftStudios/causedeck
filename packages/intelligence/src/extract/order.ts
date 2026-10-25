// `extractOrder` (#46): deterministic pre-parse first, then (only where AI is allowed) one gateway
// call returning quotes, then the validator. The model call has a budget (25 s); past it the
// deterministic result is returned and routed to "Needs you", so a slow model never loses a date.
// Where AI is not allowed (an `ai_blocked` capture or a sensitive matter) the gateway is never
// contacted, so no `ai_call` row is written, and confidence is capped at 0.6.
import type { AiGateway, RunContext } from '@causedeck/ai';

import type { PageText } from './anchors.ts';
import { preParse } from './preparse.ts';
import { buildExtractInput } from './prompt.ts';
import type { OrderExtraction } from './schema.ts';
import { validateExtraction, type ModelOrderOutput } from './validate.ts';

/** Stored with every extraction; bump it when rules change so old rows stay comparable. */
export const EXTRACTION_PIPELINE_VERSION = 'extract-order.v1';

/** The model's share of the 40 s extraction budget (spike §2). */
export const MODEL_BUDGET_MS = 25_000;

export interface ExtractOrderDeps {
  documentId: string;
  pipelineVersion: string;
  pages: readonly PageText[];
  /** Absent when AI is not allowed for this capture or matter. */
  ai: {
    gateway: AiGateway;
    scope: Pick<RunContext, 'workspaceId' | 'captureId' | 'matterId' | 'userId'>;
  } | null;
  modelBudgetMs?: number;
  /** Fuzzy anchor matching on OCR pages (off by default). */
  fuzzyAnchors?: boolean;
}

export interface ExtractOrderResult {
  extraction: OrderExtraction;
  /** The `ai_call` behind the model step; null when no model ran. */
  aiCallId: string | null;
  /** The model step ran out of budget; the deterministic result stands. */
  modelTimedOut: boolean;
}

class BudgetTimeout extends Error {}

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new BudgetTimeout());
    }, ms);
  });
  return Promise.race([work, limit]).finally(() => {
    clearTimeout(timer);
  });
}

export async function extractOrder(deps: ExtractOrderDeps): Promise<ExtractOrderResult> {
  const { documentId, pipelineVersion, pages } = deps;
  const pre = preParse(pages);
  let model: ModelOrderOutput | null = null;
  let aiCallId: string | null = null;
  let modelTimedOut = false;

  if (deps.ai !== null && pages.some((p) => p.text.trim().length > 0)) {
    const { gateway, scope } = deps.ai;
    try {
      const result = await withBudget(
        gateway.run<ModelOrderOutput>('extract_order', buildExtractInput(pages, pre), {
          ...scope,
          purpose: 'extraction.order',
          automationLevel: 2,
          idempotencyKey: `extract-order:${documentId}:${pipelineVersion}`,
        }),
        deps.modelBudgetMs ?? MODEL_BUDGET_MS,
      );
      model = result.output;
      aiCallId = result.callId;
    } catch (error) {
      if (!(error instanceof BudgetTimeout)) throw error;
      modelTimedOut = true;
    }
  }

  const extraction = validateExtraction({
    documentId,
    pipelineVersion,
    pages,
    pre,
    model,
    ...(deps.fuzzyAnchors === true ? { fuzzy: true } : {}),
  });
  return { extraction, aiCallId, modelTimedOut };
}
