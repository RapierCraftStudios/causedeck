// The redaction pipeline (#892, D-053, ADR 0051 §Anonymised text). Persons are replaced by role
// placeholders that are consistent within a judgment ("the Appellant", "Accused 1", "the
// Complainant's wife"); judges, advocates, courts, institutions, statutes, dates and amounts stay.
// Personal data is removed by shape. In a sensitive category victim and minor details are removed
// outright and the title is masked. The placeholder mapping lives only in memory for one call: it is
// never returned and never stored.
import {
  ADDRESS_CUE_RE,
  AADHAAR_RE,
  BANK_ACCOUNT_RE,
  EMAIL_RE,
  PAN_RE,
  PHONE_RE,
  VEHICLE_NUMBER_RE,
} from '@causedeck/adapters/workbench';

import { escapeRe, isSafeToken, isInstitution } from './names.ts';
import { collectEntities, type Entity } from './roles.ts';
import { detectSensitiveCategory, type SensitiveCategory } from './sensitive.ts';
import { REDACTION_VERSION } from './version.ts';

export interface RedactInput {
  pages: readonly { pageNo: number; text: string }[];
  /** Judges named by the header; they are kept. */
  bench?: readonly string[];
  /** Names to remove whatever the rules found (a mask request, #892). */
  extraNames?: readonly string[];
  /** Mask the title and treat the judgment as sensitive, with this reason (a mask request). */
  forceMask?: { reason: string } | undefined;
  /** Persons a resolver decided on, merged as other persons (see `redactWithResolver`). */
  resolved?: readonly string[];
}

export interface RedactionResult {
  pages: { pageNo: number; text: string }[];
  /** The title as published, or its masked form when `titleMasked`; null when none is printed. */
  caseTitle: string | null;
  titleMasked: boolean;
  sensitiveCategory: SensitiveCategory | null;
  maskReason: string | null;
  redactionVersion: number;
}

const RTO = new Set(
  'AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB'.split(
    ' ',
  ),
);
// A mobile number written in two groups: 98450 12345.
const SPACED_PHONE_RE = /(?<![\d])[6-9]\d{4}[\s-]\d{5}(?!\d)/g;
const SENTINEL = (i: number): string => `${i}`;
const SENTINEL_RE = /(\d+)/g;

const wordEdge = (body: string): string => `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
const surfacePattern = (s: string): string =>
  s.trim().split(/\s+/).map(escapeRe).join('\\s+');

/** Remove personal data by shape. */
function stripPii(text: string, sensitive: boolean): string {
  let out = text
    .replace(EMAIL_RE, '[email removed]')
    .replace(AADHAAR_RE, '[Aadhaar removed]')
    .replace(PAN_RE, '[PAN removed]')
    .replace(PHONE_RE, '[phone removed]')
    .replace(SPACED_PHONE_RE, '[phone removed]')
    .replace(BANK_ACCOUNT_RE, (m, digits: string) => m.replace(digits, '[account removed]'))
    .replace(VEHICLE_NUMBER_RE, (m) =>
      RTO.has(m.slice(0, 2)) ? '[vehicle number removed]' : m,
    )
    .replace(ADDRESS_CUE_RE, '[address removed]');
  if (sensitive) {
    out = out
      .replace(/\b(?:aged|age\s+of)\s+(?:about\s+)?\d{1,2}(?:\s*(?:years|yrs\.?|year))?/gi, 'aged [removed]')
      .replace(/\b\d{1,2}[\s-]*(?:years?|yrs?\.?)[\s-]*old\b/gi, '[age removed]')
      .replace(/\b(?:born\s+on|date\s+of\s+birth(?:\s+is)?)\s*:?\s*[\d./\-A-Za-z, ]{6,24}/gi, '[date of birth removed]')
      .replace(/\b(?:[A-Z][a-z]+\s+){1,3}(?:School|College|Anganwadi)\b/g, '[school removed]');
  }
  return out;
}

function surfacesOf(entities: readonly Entity[], keptTokens: ReadonlySet<string>) {
  const out = new Map<string, string>();
  for (const e of entities) {
    for (const n of e.names) out.set(n.toLowerCase().replace(/\s+/g, ' '), e.label);
  }
  for (const e of entities) {
    for (const t of e.tokens) {
      if (!isSafeToken(t) || keptTokens.has(t) || out.has(t)) continue;
      out.set(t, e.label);
    }
  }
  return out;
}

const tokenSet = (names: readonly string[]): Set<string> =>
  new Set(names.flatMap((n) => n.toLowerCase().replace(/[.,'’]/g, ' ').split(/\s+/)).filter((t) => t !== ''));

/** Replace persons in `text`; judges and advocates are shielded behind sentinels first. */
function applyEntities(
  text: string,
  keptRe: RegExp | null,
  keptList: string[],
  surfaces: ReadonlyMap<string, string>,
  surfaceRe: RegExp | null,
): string {
  let out = text;
  if (keptRe !== null) {
    out = out.replace(keptRe, (m) => {
      const i = keptList.push(m) - 1;
      return SENTINEL(i);
    });
  }
  if (surfaceRe !== null) {
    out = out.replace(surfaceRe, (m) => surfaces.get(m.toLowerCase().replace(/\s+/g, ' ')) ?? m);
  }
  return out.replace(SENTINEL_RE, (_, i: string) => keptList[Number(i)] ?? '');
}

/** The title of a judgment as printed on its first page: `X v. Y`, or null. */
export function extractCaseTitle(firstPage: string): string | null {
  const lines = firstPage
    .split('\n')
    .map((l) => l.trim())
    .slice(0, 60);
  const clean = (s: string): string =>
    s
      .replace(/^\s*(?:\d+[.)]\s*)?(?:between|and)\s*:?\s*/i, '')
      .replace(/\s*(?:\.{2,}|…|,)?\s*\(?(?:the\s+)?(?:petitioner|appellant|respondent|accused|complainant|plaintiff|defendant|applicant)s?(?:\s+No\.?\s*\d+)?\)?[\s.]*$/i, '')
      .replace(/,?\s*(?:aged|R\/o|resident of)\b.*$/i, '')
      .replace(/\s+(?:S\/o|D\/o|W\/o|H\/o)\b.*$/i, '')
      .replace(/\s+by\s+the\s+.*$/i, '')
      .replace(/[\s.…,]+$/, '')
      .trim();
  const sep = /^(?:v\.?|vs\.?|versus|and)\s*:?$/i;
  // The party line before a separator, skipping "(By Sri. X, Advocate)" lines.
  const before = (i: number): string => {
    for (let k = i - 1; k >= 0; k -= 1) {
      const l = lines[k] ?? '';
      if (l !== '' && !l.startsWith('(')) return clean(l);
    }
    return '';
  };
  const after = (i: number): string => clean(lines.slice(i + 1).find((l) => l !== '') ?? '');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (sep.test(line)) {
      const a = before(i);
      const b = after(i);
      if (a !== '' && b !== '' && !/^between\b/i.test(a)) return `${a} v. ${b}`;
    }
    const inline = /^(.{3,100}?)\s+(?:v\.?|vs\.?|versus)\s+(.{3,100})$/i.exec(line);
    if (inline !== null && !/[a-z]{4,}\s+[a-z]{4,}\s+[a-z]{4,}/.test(line)) {
      return `${clean(inline[1] ?? '')} v. ${clean(inline[2] ?? '')}`;
    }
  }
  return null;
}

/** Mask a title side by side: persons become placeholders; a side nothing matched is withheld. */
function maskTitle(title: string, apply: (t: string) => string): string {
  return title
    .split(/\s+v\.\s+/)
    .map((side) => {
      const redacted = apply(side);
      return redacted === side && !isInstitution(side) ? '[name withheld]' : redacted;
    })
    .join(' v. ');
}

/**
 * Redact one judgment. Pure and synchronous; `redactWithResolver` adds the gateway for
 * low-confidence spans.
 */
export function redactJudgment(input: RedactInput): RedactionResult {
  const texts = input.pages.map((p) => p.text);
  const rawTitle = extractCaseTitle(texts[0] ?? '');
  const detected = detectSensitiveCategory(rawTitle, texts);
  const forced = input.forceMask !== undefined;
  const sensitive = detected !== null || forced;
  const { entities, kept } = collectEntities(texts, {
    bench: input.bench ?? [],
    sensitive,
    extraNames: [...(input.extraNames ?? []), ...(input.resolved ?? [])],
  });
  const surfaces = surfacesOf(entities, tokenSet(kept));
  const keys = [...surfaces.keys()].sort((a, b) => b.length - a.length);
  const surfaceRe =
    keys.length === 0
      ? null
      : new RegExp(wordEdge(`(?:${keys.map(surfacePattern).join('|')})`), 'giu');
  const keptSorted = [...new Set(kept)].sort((a, b) => b.length - a.length);
  const keptRe =
    keptSorted.length === 0
      ? null
      : new RegExp(wordEdge(`(?:${keptSorted.map(surfacePattern).join('|')})`), 'giu');

  // Personal data first, so a name inside an email address is removed with the address.
  const apply = (t: string): string =>
    applyEntities(stripPii(t, sensitive), keptRe, [], surfaces, surfaceRe);

  const pages = input.pages.map((p) => ({ pageNo: p.pageNo, text: apply(p.text) }));
  const titleMasked = sensitive;
  let caseTitle = rawTitle;
  if (titleMasked) caseTitle = rawTitle === null ? null : maskTitle(rawTitle, apply);
  return {
    pages,
    caseTitle,
    titleMasked,
    sensitiveCategory: detected,
    maskReason: forced ? (input.forceMask?.reason ?? null) : detected === null ? null : `auto:${detected}`,
    redactionVersion: REDACTION_VERSION,
  };
}

