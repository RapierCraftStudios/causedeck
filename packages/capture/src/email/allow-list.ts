// Sender allow-list for email intake (#528). A message is parsed only when its envelope sender or
// the forwarding user matches a pattern, and (for a sender that is not the lawyer themselves) SPF,
// DKIM and DMARC did not FAIL. Anything else gets a quarantine verdict: no parsing, no AI.
import { SENDER_KINDS, type ParsedEmail, type SenderKind } from './types.ts';

export interface SenderPattern {
  /** An exact address (`registry@court.gov.in`) or a domain (`@court.gov.in`, `*@court.gov.in`). */
  pattern: string;
  kind: SenderKind;
}

export type SenderMatchedAs = 'envelope' | 'forwarding_user';
export type QuarantineReason = 'sender_not_allowed' | 'auth_failed';

export type SenderVerdict =
  | { verdict: 'allowed'; kind: SenderKind; matchedAs: SenderMatchedAs; pattern: string }
  | { verdict: 'quarantine'; reason: QuarantineReason; failed: string[] };

export function isSenderKind(value: string): value is SenderKind {
  return (SENDER_KINDS as readonly string[]).includes(value);
}

/** Whether `address` matches `pattern`: exact address, or the domain and its subdomains. */
export function matchesPattern(address: string, pattern: string): boolean {
  const addr = address.trim().toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (addr === '' || pat === '') return false;
  if (pat.startsWith('@') || pat.startsWith('*@')) {
    const domain = pat.slice(pat.indexOf('@') + 1);
    const host = addr.slice(addr.lastIndexOf('@') + 1);
    return domain !== '' && (host === domain || host.endsWith(`.${domain}`));
  }
  return addr === pat;
}

/** The envelope sender (`Return-Path`), falling back to `From`. */
export function envelopeSender(email: ParsedEmail): string {
  const path = /<([^<>\s]*)>/.exec(email.headers['return-path'] ?? '')?.[1]?.toLowerCase() ?? '';
  return path === '' ? email.from.address : path;
}

export function evaluateSender(email: ParsedEmail, list: readonly SenderPattern[]): SenderVerdict {
  const candidates: { address: string; matchedAs: SenderMatchedAs }[] = [
    { address: envelopeSender(email), matchedAs: 'envelope' },
    { address: email.from.address, matchedAs: 'forwarding_user' },
  ];
  for (const { address, matchedAs } of candidates) {
    const hit = list.find((entry) => matchesPattern(address, entry.pattern));
    if (hit === undefined) continue;
    if (hit.kind !== 'self') {
      const failed = (['spf', 'dkim', 'dmarc'] as const).filter((key) => email.auth[key] === 'fail');
      if (failed.length > 0) return { verdict: 'quarantine', reason: 'auth_failed', failed };
    }
    return { verdict: 'allowed', kind: hit.kind, matchedAs, pattern: hit.pattern };
  }
  return { verdict: 'quarantine', reason: 'sender_not_allowed', failed: [] };
}
