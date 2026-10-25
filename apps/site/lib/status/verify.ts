// HMAC-SHA256 verification in the browser (WebCrypto). The algorithm is core's `canonicalStatusJson`
// plus `verifySnapshot` (`packages/core/src/status/publish.ts`). The key is a public build-time
// value, so this detects corruption and accidental tampering, not a forger who can read the key.
import { statusSnapshotSchema, type StatusSnapshot } from './model.ts';

/** JSON with object keys sorted at every level, undefined dropped (same bytes as core). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))));
}

/** Constant-time string compare for equal-length hex digests. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The parsed snapshot when it matches the schema and its signature verifies, else null. */
export async function verifySnapshot(
  raw: unknown,
  key: string,
): Promise<StatusSnapshot | null> {
  const parsed = statusSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { signature, ...unsigned } = parsed.data;
  const expected = await hmacHex(canonicalJson(unsigned), key);
  return safeEqual(expected, signature.value) ? parsed.data : null;
}
