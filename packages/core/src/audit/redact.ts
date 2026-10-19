// Privacy guards for audit rows (#227, #26 part 2): metadata holds identifiers only, never matter
// content; the user agent is stored as a hash; IPs are truncated for display.
import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

import type { AuditMetadataValue } from './events.ts';

/** Metadata keys that would carry privileged content (matched case-insensitively). */
export const AUDIT_BANNED_METADATA_KEYS: readonly string[] = [
  'content',
  'text',
  'quote',
  'body',
  'prompt',
  'transcript',
];

/** Metadata that would leak content or is not a flat map of primitives. Never fail-open. */
export class AuditRedactionError extends Error {
  readonly code = 'AUDIT_REDACTION' as const;

  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`audit metadata key "${key}" ${reason}`);
    this.name = 'AuditRedactionError';
  }
}

/** Throws `AuditRedactionError` for a banned key or a non-primitive value. */
export function assertRedacted(
  metadata: Readonly<Record<string, unknown>> | undefined,
): asserts metadata is Record<string, AuditMetadataValue> | undefined {
  if (metadata === undefined) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (AUDIT_BANNED_METADATA_KEYS.includes(key.toLowerCase())) {
      throw new AuditRedactionError(key, 'may carry privileged content');
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new AuditRedactionError(key, 'must be a string, number, boolean or null');
    }
  }
}

/** sha256 hex of the user agent; `null` when there is none. */
export function hashUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  return createHash('sha256').update(userAgent, 'utf8').digest('hex');
}

/**
 * The display form of a stored IP: IPv4 as its `/24` (`203.0.113.0/24`), IPv6 as its `/48`.
 * `null` for a missing or unparseable address.
 */
export function truncateIpForDisplay(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split('.');
    return `${a ?? ''}.${b ?? ''}.${c ?? ''}.0/24`;
  }
  if (isIPv6(ip)) {
    const [head = '', tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    if (right.at(-1)?.includes('.')) right.splice(-1, 1, '0', '0');
    const groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
    const prefix = groups.slice(0, 3).map((g) => (Number.parseInt(g || '0', 16) || 0).toString(16));
    return `${prefix.join(':')}::/48`;
  }
  return null;
}
