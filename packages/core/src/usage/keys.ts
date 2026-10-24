// Metered usage keys (#219, #30 part 2). Each key names one billable or capped resource; every key
// matches `USAGE_KEY_PATTERN_SOURCE` (packages/db/src/schema/usage.ts), the `usage_event.key` check.

export const USAGE_KEYS = [
  'ai.spend_paise',
  'ai.tokens_in',
  'ai.tokens_out',
  'ocr.pages',
  'stt.seconds',
  'storage.bytes',
  'matters.active',
  'api.calls',
] as const;

export type UsageKey = (typeof USAGE_KEYS)[number];

/**
 * `counter` keys only grow within a period (amounts >= 0); `gauge` keys track a level and take
 * signed deltas (bytes freed, a matter closed).
 */
export const USAGE_KEY_KINDS: Readonly<Record<UsageKey, 'counter' | 'gauge'>> = {
  'ai.spend_paise': 'counter',
  'ai.tokens_in': 'counter',
  'ai.tokens_out': 'counter',
  'ocr.pages': 'counter',
  'stt.seconds': 'counter',
  'storage.bytes': 'gauge',
  'matters.active': 'gauge',
  'api.calls': 'counter',
};

export function isUsageKey(value: string): value is UsageKey {
  return (USAGE_KEYS as readonly string[]).includes(value);
}
