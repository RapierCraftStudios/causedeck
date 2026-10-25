// Redaction for workbench fixtures (#516): party names become deterministic synthetic names and
// personal data becomes fixed placeholders. Redaction is plain text replacement applied to the
// input and to every string of the expected output alike, so layout, page breaks and anchor quotes
// stay verbatim-consistent. Institutions (a State, a bank, an officer's post) are not personal data
// and are kept, so a fixture keeps the shape of a real list.
import { createHash } from 'node:crypto';

import {
  AADHAAR_PLACEHOLDER,
  AADHAAR_RE,
  EMAIL_PLACEHOLDER,
  EMAIL_RE,
  namePattern,
  PAN_PLACEHOLDER,
  PAN_RE,
  PHONE_PLACEHOLDER,
  PHONE_RE,
} from './detect.ts';

const FIRST_NAMES = [
  'Arun',
  'Bala',
  'Chitra',
  'Devika',
  'Elan',
  'Farida',
  'Gokul',
  'Hema',
  'Indira',
  'Jayan',
  'Kavin',
  'Lakshmi',
  'Mohan',
  'Nila',
  'Oviya',
  'Prakash',
] as const;
const LAST_NAMES = [
  'Fictwell',
  'Kavithan',
  'Madhuram',
  'Nandhini',
  'Orwell',
  'Pillaiyar',
  'Quadir',
  'Ramalan',
  'Selvam',
  'Thirumal',
  'Umapathy',
  'Velan',
] as const;

const VERSUS = /\s+(?:vs?\.?|v\/s|versus)\s+/i;
const SEPARATOR = /\s*(?:;|,|&|\band\b)\s*/i;
const HONORIFIC = /^(?:m\/s\.?|mr\.?|mrs\.?|ms\.?|smt\.?|sri\.?|shri\.?|dr\.?|\d+[.)])\s+/i;
const INSTITUTION =
  /\b(?:state|union|government|govt|collector|commissioner|registrar|bank|limited|ltd|corporation|department|court|municipal|board|authority|company|pvt|police|secretary|ministry|tribunal|university|inspector|officer|director|others?|another|rep\.?|represented)\b/i;

/** The personal names in a `parties` string (`A vs B and C`), institutions left out. */
export function partyNames(parties: string | undefined): string[] {
  if (parties === undefined) return [];
  const names = parties
    .split(VERSUS)
    .flatMap((side) => side.split(SEPARATOR))
    .map((part) => part.replace(HONORIFIC, '').trim())
    .filter((part) => part.length >= 3 && !INSTITUTION.test(part));
  return [...new Set(names)];
}

const hash = (value: string) =>
  createHash('sha256').update(value.toLowerCase()).digest().readUInt32BE(0);

/** Upper-case or lower-case the replacement when the original was. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  return replacement;
}

export interface Redactor {
  /** The text with names and personal data replaced. */
  text(value: string): string;
  /** Every string value in `value` redacted; keys and non-strings untouched. */
  deep<T>(value: T): T;
  /** The real names the redactor replaces, for the leak check. */
  names: readonly string[];
  /** Names and personal-data matches replaced so far. */
  counts(): { names: number; pii: number };
}

/**
 * A redactor for `names`. `source` is the text being redacted: a synthetic name that already occurs
 * in it is never used, so a replacement can never be mistaken for a leftover real name.
 */
export function createRedactor(names: readonly string[], source: string): Redactor {
  const ordered = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ''))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  const lowerSource = source.toLowerCase();
  const used = new Set<string>();
  const synthetic = new Map<string, string>();
  for (const name of ordered) {
    const seed = hash(name);
    for (let step = 0; step < FIRST_NAMES.length * LAST_NAMES.length; step += 1) {
      const index = (seed + step) % (FIRST_NAMES.length * LAST_NAMES.length);
      const candidate = `${FIRST_NAMES[index % FIRST_NAMES.length] ?? ''} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length)] ?? ''}`;
      if (used.has(candidate) || lowerSource.includes(candidate.toLowerCase())) continue;
      used.add(candidate);
      synthetic.set(name, candidate);
      break;
    }
  }
  const patterns = ordered.flatMap((name) => {
    const replacement = synthetic.get(name);
    return replacement === undefined ? [] : [{ pattern: namePattern(name), replacement }];
  });
  let nameCount = 0;
  let piiCount = 0;
  const text = (value: string): string => {
    let out = value;
    for (const { pattern, replacement } of patterns) {
      out = out.replace(pattern, (match) => {
        nameCount += 1;
        return matchCase(match, replacement);
      });
    }
    const pii = (re: RegExp, placeholder: string) => {
      out = out.replace(re, (match) => {
        if (match.replace(/\D/g, '').slice(-10) === PHONE_PLACEHOLDER || match === placeholder) {
          return match;
        }
        piiCount += 1;
        return placeholder;
      });
    };
    pii(EMAIL_RE, EMAIL_PLACEHOLDER);
    pii(AADHAAR_RE, AADHAAR_PLACEHOLDER);
    pii(PHONE_RE, PHONE_PLACEHOLDER);
    pii(PAN_RE, PAN_PLACEHOLDER);
    return out;
  };
  const deep = <T>(value: T): T => {
    if (typeof value === 'string') return text(value) as T;
    if (Array.isArray(value)) return value.map((item) => deep(item as unknown)) as T;
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, deep(item as unknown)]),
      ) as T;
    }
    return value;
  };
  return { text, deep, names: ordered, counts: () => ({ names: nameCount, pii: piiCount }) };
}
