// Amazon Bedrock adapter, Converse API (Claude, India inference profile in ap-south-1). The request
// carries a system prompt, one user message and `inferenceConfig` only: no tool definitions, no
// guardrail or retrieval parameters, which a static test enforces. Bedrock does not train on
// requests or store them, so there is no retention parameter to send (spike §6).
import { z } from 'zod';

import { ProviderError } from '../errors.ts';
import { isIndiaRegion } from '../policy/residency.ts';
import { systemPrompt, wrapAsData } from '../policy/injection.ts';
import { CircuitBreaker, withRetry, type RetryOptions } from '../retry.ts';
import type { CallOptions, Provider, ProviderResult, TaskDef, TaskId } from '../types.ts';
import { signRequest } from './sigv4.ts';

export const BEDROCK_TASKS: readonly TaskId[] = [
  'classify_document',
  'extract_order',
  'structure_hearing',
  'structure_diary',
  'structure_chat',
  'parse_list_a0',
  'parse_order_a0',
  'translate',
  'summarise',
];

export interface BedrockConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Haiku-class India inference profile id (the default model). */
  modelId: string;
  /** Sonnet-class profile id for `tier: 'drafting'` tasks; falls back to `modelId`. */
  draftingModelId?: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  retry?: RetryOptions;
  breaker?: CircuitBreaker;
}

interface ConverseResponse {
  output?: { message?: { content?: { text?: string }[] } };
  usage?: { inputTokens?: number; outputTokens?: number };
}

const THROTTLE = new Set([429, 503, 529]);

export function buildConverseRequest(
  task: TaskDef,
  input: unknown,
  opts: CallOptions,
): { system: { text: string }[]; messages: unknown[]; inferenceConfig: Record<string, number> } {
  const schemaHint = JSON.stringify(z.toJSONSchema(task.output));
  const label = task.promptId;
  const user = [wrapAsData(label, JSON.stringify(input))];
  if (opts.repair !== undefined) {
    user.push(
      `Your previous reply failed validation (${opts.repair.issues}). Reply again with only the corrected JSON object.`,
    );
  }
  return {
    system: [{ text: systemPrompt(task.promptId, schemaHint) }],
    messages: [{ role: 'user', content: user.map((text) => ({ text })) }],
    inferenceConfig: { maxTokens: task.maxOutputTokens, temperature: 0 },
  };
}

export function createBedrockProvider(config: BedrockConfig): Provider {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const breaker = config.breaker ?? new CircuitBreaker();
  const host = `bedrock-runtime.${config.region}.amazonaws.com`;
  const modelFor = (task: TaskDef): string =>
    task.tier === 'drafting' ? (config.draftingModelId ?? config.modelId) : config.modelId;

  async function once(task: TaskDef, input: unknown, opts: CallOptions): Promise<ProviderResult> {
    const model = modelFor(task);
    const body = JSON.stringify(buildConverseRequest(task, input, opts));
    const path = `/model/${encodeURIComponent(model)}/converse`;
    const headers = signRequest({
      region: config.region,
      service: 'bedrock',
      host,
      path,
      body,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      now: now(),
    });
    let response: Response;
    try {
      response = await doFetch(`https://${host}${path}`, { method: 'POST', headers, body });
    } catch {
      throw new ProviderError('bedrock', 'network error', { retryable: true });
    }
    if (!response.ok) {
      throw new ProviderError('bedrock', `HTTP ${String(response.status)}`, {
        retryable: THROTTLE.has(response.status) || response.status >= 500,
        status: response.status,
      });
    }
    const json = (await response.json()) as ConverseResponse;
    const text = json.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    return {
      output: text,
      usage: {
        inputTokens: json.usage?.inputTokens ?? 0,
        outputTokens: json.usage?.outputTokens ?? 0,
      },
      model,
      modelVersion: model,
    };
  }

  return {
    id: 'bedrock',
    region: config.region,
    dataResidency: isIndiaRegion(config.region) ? 'in' : 'other',
    supports: BEDROCK_TASKS,
    modelFor,
    call: (task, input, opts) =>
      breaker.run('bedrock', () => withRetry(() => once(task, input, opts), config.retry)),
  };
}
