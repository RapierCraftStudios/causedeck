// Leak detector for workbench fixtures (#516): finds real party names and personal data in text.
// Names are matched whole-word and case-insensitively, whatever the spacing between their parts.
// Personal data is found by shape (email, Indian mobile number, Aadhaar, PAN). The placeholders
// the redactor writes are skipped, so redacted output scans clean.

export type LeakKind = 'name' | 'email' | 'phone' | 'aadhaar' | 'pan';

export interface Leak {
  kind: LeakKind;
  value: string;
}

export const EMAIL_PLACEHOLDER = 'redacted@example.invalid';
export const PHONE_PLACEHOLDER = '9000000000';
export const AADHAAR_PLACEHOLDER = '0000 0000 0000';
export const PAN_PLACEHOLDER = 'AAAAA0000A';

export const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
export const PHONE_RE = /(?<!\d)(?:\+91[\s-]?|0)?[6-9]\d{9}(?!\d)/g;
// Real Aadhaar numbers never start with 0 or 1, which keeps the placeholder out of the match.
export const AADHAAR_RE = /(?<!\d)[2-9]\d{3}\s?\d{4}\s?\d{4}(?!\d)/g;
export const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}])';

/** A case-insensitive whole-word pattern for `name`, tolerant of spacing between its parts. */
export function namePattern(name: string): RegExp {
  const body = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`${WORD_EDGE_BEFORE}${body}${WORD_EDGE_AFTER}`, 'giu');
}

const digits = (value: string) => value.replace(/\D/g, '');

/** Personal-data matches in `text`, placeholders excluded. */
export function findPii(text: string): Leak[] {
  const leaks: Leak[] = [];
  for (const [value] of text.matchAll(EMAIL_RE)) {
    if (value !== EMAIL_PLACEHOLDER) leaks.push({ kind: 'email', value });
  }
  for (const [value] of text.matchAll(PHONE_RE)) {
    if (digits(value).slice(-10) !== PHONE_PLACEHOLDER) leaks.push({ kind: 'phone', value });
  }
  for (const [value] of text.matchAll(AADHAAR_RE)) leaks.push({ kind: 'aadhaar', value });
  for (const [value] of text.matchAll(PAN_RE)) {
    if (value !== PAN_PLACEHOLDER) leaks.push({ kind: 'pan', value });
  }
  return leaks;
}

/** Every known party name and every piece of personal data left in `text`. */
export function findLeaks(text: string, names: readonly string[]): Leak[] {
  const leaks: Leak[] = [];
  for (const name of names) {
    if (name.trim() === '') continue;
    for (const [value] of text.matchAll(namePattern(name))) leaks.push({ kind: 'name', value });
  }
  return [...leaks, ...findPii(text)];
}
