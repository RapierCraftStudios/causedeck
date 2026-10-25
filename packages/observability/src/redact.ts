// Log and telemetry redaction (spike §1, PRD §9). Secrets become `[REDACTED]`; matter content
// (privileged under BSA s.132) becomes `[CONTENT_REDACTED:<length>]` so the raw text never leaves
// the process.
import { isSecret } from '@causedeck/config/env';

export const REDACTED = '[REDACTED]';

/** Keys whose values are credentials. Matched case-insensitively anywhere in the key. */
export const SECRET_KEY_PATTERN = /password|secret|token|authorization|cookie|api[-_]?key|otp/i;

/** Keys whose values are matter content and must never be logged. Matched exactly. */
export const CONTENT_KEYS: readonly string[] = [
  'content',
  'text',
  'body',
  'quote',
  'prompt',
  'memoryValue',
  'title',
  'filename',
  'email',
];

const contentKeySet = new Set(CONTENT_KEYS);

/**
 * pino `redact` paths: a fast first pass for the common shapes. `redactDeep` covers everything
 * else (any depth, arrays, unusual casing).
 */
export const redactPaths: string[] = [
  'password',
  'authorization',
  'cookie',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'otp',
  '*.password',
  '*.authorization',
  '*.cookie',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.otp',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function isContentKey(key: string): boolean {
  return contentKeySet.has(key);
}

/** Placeholder for a content value: only its length is kept. */
export function contentPlaceholder(value: unknown): string {
  let length: number;
  if (typeof value === 'string') {
    length = value.length;
  } else {
    try {
      length = (JSON.stringify(value) as string | undefined)?.length ?? 0;
    } catch {
      length = 0;
    }
  }
  return `[CONTENT_REDACTED:${String(length)}]`;
}

const MAX_DEPTH = 12;

/**
 * Return a redacted deep copy of `value`. Never mutates its input and is safe on cycles. Errors are
 * left to the logger's error serializer, which redacts them separately.
 */
export function redactDeep(value: unknown): unknown {
  return walk(value, new WeakSet(), 0);
}

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (isSecret(value)) return REDACTED;
  if (typeof value === 'string') return scrubSecretsInString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item: unknown) => walk(item, seen, depth + 1));
    if (value instanceof Map) {
      return walkEntries(
        [...value.entries()].map(([k, v]) => [String(k), v]),
        seen,
        depth,
      );
    }
    if (value instanceof Error) return value;
    return walkEntries(Object.entries(value), seen, depth);
  } finally {
    seen.delete(value);
  }
}

function walkEntries(
  entries: [string, unknown][],
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    if (isContentKey(key)) out[key] = contentPlaceholder(child);
    else if (isSecretKey(key)) out[key] = REDACTED;
    else out[key] = walk(child, seen, depth + 1);
  }
  return out;
}

const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const KEY_VALUE =
  /\b([A-Za-z0-9_-]*(?:password|secret|token|authorization|cookie|api[-_]?key|otp)[A-Za-z0-9_-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

/** Mask credentials embedded in free text: bearer tokens, JWTs, `key=value` secrets, URL passwords. */
export function scrubSecretsInString(input: string): string {
  return input
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${REDACTED}@`)
    .replace(KEY_VALUE, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`);
}
