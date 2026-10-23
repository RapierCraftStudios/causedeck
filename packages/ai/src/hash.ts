import { createHash } from 'node:crypto';

/** Stable JSON: object keys sorted, strings trimmed with whitespace runs collapsed. */
export function normalise(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, normalise(v)]),
    );
  }
  return value;
}

/** sha256 hex of the normalised input: the only trace of an input the audit row keeps. */
export function inputHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalise(input)))
    .digest('hex');
}
