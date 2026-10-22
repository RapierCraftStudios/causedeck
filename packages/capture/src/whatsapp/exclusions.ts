// Exclusion rules (#525): messages that look like identity numbers, bank details, credentials or
// sensitive matters are held back from the import. Rules over-match on purpose: a wrongly held
// message costs one tap (`confirmed`), a leaked Aadhaar number cannot be taken back. Aadhaar and
// credential matches are never releasable.
import type { ParsedMessage } from './types.ts';

export type ExclusionRule =
  | 'aadhaar'
  | 'pan'
  | 'bank_account'
  | 'ifsc'
  | 'credential_phrase'
  | 'sensitive_keyword'
  | 'sensitive_matter';

/** Rules a per-message confirmation can never release. */
export const NON_OVERRIDABLE_RULES: readonly ExclusionRule[] = ['aadhaar', 'credential_phrase'];

export const DEFAULT_SENSITIVE_KEYWORDS: readonly string[] = [
  'pocso',
  'rape',
  'sexual assault',
  'sexual harassment',
  'juvenile',
  'in camera',
  'hiv',
  'suicide',
  'domestic violence',
];

export interface ExclusionOptions {
  /** Replaces `DEFAULT_SENSITIVE_KEYWORDS` when given. */
  sensitiveKeywords?: readonly string[] | undefined;
  /** Case numbers of matters the lawyer marked sensitive, e.g. `CRL.A. 123/2026`. */
  sensitiveCaseNumbers?: readonly string[] | undefined;
}

const AADHAAR = /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/i;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/i;
const BANK_ACCOUNT =
  /\b(?:a\/c|acc(?:oun)?t)\.?\s*(?:no\.?|number|num|#)?\s*[:\-=]?\s*\d[\d -]{7,22}\d\b/i;
const CREDENTIAL =
  /\b(?:otp|one[- ]time (?:password|passcode|pin)|password|passcode|passwd|cvv|(?:upi|atm|login|net ?banking) pin)\b/i;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The rules a piece of text trips, in a stable order, each at most once. */
export function matchExclusions(text: string, options: ExclusionOptions = {}): ExclusionRule[] {
  const hits: ExclusionRule[] = [];
  if (AADHAAR.test(text)) hits.push('aadhaar');
  if (PAN.test(text)) hits.push('pan');
  if (BANK_ACCOUNT.test(text)) hits.push('bank_account');
  if (IFSC.test(text)) hits.push('ifsc');
  if (CREDENTIAL.test(text)) hits.push('credential_phrase');
  const keywords = options.sensitiveKeywords ?? DEFAULT_SENSITIVE_KEYWORDS;
  if (
    keywords.some(
      (k) =>
        k.trim() !== '' &&
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(k.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(
          text,
        ),
    )
  ) {
    hits.push('sensitive_keyword');
  }
  const squashed = squash(text);
  const cases = (options.sensitiveCaseNumbers ?? []).map(squash).filter((c) => c.length >= 4);
  if (cases.some((c) => squashed.includes(c))) hits.push('sensitive_matter');
  return hits;
}

export interface ExcludedMessage {
  index: number;
  rules: ExclusionRule[];
}

export interface ExclusionResult {
  kept: ParsedMessage[];
  excluded: ExcludedMessage[];
}

/**
 * Applies the rules to `messages`. A message holding only overridable matches is kept when its
 * index is in `confirmed`. Attachment names are checked too: a file called after a PAN is held.
 */
export function applyExclusions(
  messages: readonly ParsedMessage[],
  options: ExclusionOptions = {},
  confirmed: ReadonlySet<number> = new Set(),
): ExclusionResult {
  const kept: ParsedMessage[] = [];
  const excluded: ExcludedMessage[] = [];
  for (const message of messages) {
    const rules = matchExclusions(
      message.attachment?.name == null
        ? message.text
        : `${message.text}\n${message.attachment.name}`,
      options,
    );
    const released =
      rules.length > 0 &&
      confirmed.has(message.index) &&
      rules.every((r) => !NON_OVERRIDABLE_RULES.includes(r));
    if (rules.length === 0 || released) kept.push(message);
    else excluded.push({ index: message.index, rules });
  }
  return { kept, excluded };
}
