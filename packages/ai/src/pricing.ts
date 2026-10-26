// Unit-cost table in paise (INR x 100), per provider and model. Source: the documented unit costs
// in docs/product/09 §9 at the planning rate of INR 84 per USD. Change a rate here, not at call
// sites; `estimateUsage` is what the gateway reserves before every call.
import type { ProviderId, TaskDef, Usage } from './types.ts';

export interface PriceEntry {
  /** Paise per million input tokens. */
  inputPerMTok?: number;
  /** Paise per million output tokens. */
  outputPerMTok?: number;
  /** Paise per audio second. */
  perSecond?: number;
  /** Paise per document page. */
  perPage?: number;
  /** Paise per character. */
  perChar?: number;
}

export const PRICES: Readonly<Record<string, PriceEntry>> = {
  // Claude Haiku-class on Bedrock (USD 1 / 5 per million tokens).
  'bedrock:haiku': { inputPerMTok: 8_400, outputPerMTok: 42_000 },
  // Claude Sonnet-class on Bedrock (USD 3 / 15 per million tokens).
  'bedrock:sonnet': { inputPerMTok: 25_200, outputPerMTok: 126_000 },
  // Sarvam: STT INR 30 per hour, document OCR INR 1.50 per page, translate INR 20 per 10k chars.
  'sarvam:stt': { perSecond: 30_00 / 3_600 },
  'sarvam:ocr': { perPage: 150 },
  'sarvam:translate': { perChar: 0.2 },
  'mock:mock': {},
};

/** The price row for a provider and model id (`anthropic.claude-sonnet...` maps to sonnet). */
export function priceFor(provider: ProviderId, model: string): PriceEntry {
  if (provider === 'bedrock') {
    return PRICES[/sonnet/i.test(model) ? 'bedrock:sonnet' : 'bedrock:haiku'] ?? {};
  }
  return PRICES[`${provider}:${model}`] ?? PRICES[`${provider}:mock`] ?? {};
}

/** Whole paise for `usage`, rounded up so a reservation never under-holds. */
export function costPaise(provider: ProviderId, model: string, usage: Usage): number {
  const p = priceFor(provider, model);
  const total =
    (usage.inputTokens * (p.inputPerMTok ?? 0)) / 1_000_000 +
    (usage.outputTokens * (p.outputPerMTok ?? 0)) / 1_000_000 +
    (usage.seconds ?? 0) * (p.perSecond ?? 0) +
    (usage.pages ?? 0) * (p.perPage ?? 0) +
    (usage.chars ?? 0) * (p.perChar ?? 0);
  // Round before ceil: floating point error must not add a paise to an exact total.
  return Math.ceil(Math.round(total * 1e6) / 1e6);
}

/** What a call will use at most, from the input alone. Every call has an estimate. */
export function estimateUsage(task: TaskDef, input: unknown): Usage {
  const record = (input ?? {}) as Record<string, unknown>;
  const num = (k: string): number => (typeof record[k] === 'number' ? record[k] : 0);
  const text = typeof record.text === 'string' ? record.text : '';
  const textLength = text.length;
  const hasBinary =
    typeof record.audioBase64 === 'string' || typeof record.contentBase64 === 'string';
  const serialised = hasBinary ? 0 : JSON.stringify(input ?? {}).length;
  const usage: Usage = {
    inputTokens: Math.ceil(serialised / 3),
    outputTokens: task.maxOutputTokens,
  };
  if (num('durationSeconds') > 0) usage.seconds = num('durationSeconds');
  if (num('pageCount') > 0) usage.pages = num('pageCount');
  if (task.id === 'translate') usage.chars = textLength;
  return usage;
}

export function estimatePaise(
  provider: ProviderId,
  model: string,
  task: TaskDef,
  input: unknown,
): number {
  // Translation on Sarvam is priced per character; on Bedrock per token.
  const usage = estimateUsage(task, input);
  const effective: Usage =
    provider === 'sarvam' ? { ...usage, inputTokens: 0, outputTokens: 0 } : { ...usage, chars: 0 };
  return costPaise(provider, model, effective);
}
