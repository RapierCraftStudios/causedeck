// Leak detector for workbench fixtures (#516): finds real party names and personal data in text.
// Names are matched whole-word and case-insensitively, whatever the spacing between their parts.
// Personal data is found by shape (email, Indian mobile number, Aadhaar, PAN). The placeholders
// the redactor writes are skipped, so redacted output scans clean.

// Shared by the leak detector and the corpus redaction pipeline (#892).
import {
  AADHAAR_RE,
  EMAIL_PLACEHOLDER,
  EMAIL_RE,
  PAN_PLACEHOLDER,
  PAN_RE,
  PHONE_PLACEHOLDER,
  PHONE_RE,
} from './pii-patterns.ts';

export type LeakKind = 'name' | 'email' | 'phone' | 'aadhaar' | 'pan';

export interface Leak {
  kind: LeakKind;
  value: string;
}

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
