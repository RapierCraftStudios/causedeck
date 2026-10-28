// Citation patterns for Indian authorities: neutral citations (Supreme Court `2023 INSC 123`, Madras
// `2024:MHC:1234`, Karnataka `2024:KHC:5678`), reporters (SCC, SCC OnLine, AIR, MLJ, ILR) and the
// `Party v. Party` form. Each pattern knows how to write its match in one canonical form. Pure text
// matching: nothing here reads a network or a database.
import type { CitationKind } from '@causedeck/validators/citation';

export interface CitationPattern {
  id: string;
  kind: CitationKind;
  /** Global regex; every match is a candidate citation. */
  regex: RegExp;
  /** The canonical form of a match. */
  normalize(match: RegExpExecArray): string;
}

const g = (groups: RegExpExecArray['groups'], name: string): string => groups?.[name] ?? '';
const court = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export const STRUCTURED_PATTERNS: readonly CitationPattern[] = [
  {
    id: 'insc',
    kind: 'neutral',
    regex: /\b(?<year>(?:19|20)\d{2})\s+INSC\s+(?<no>\d{1,5})\b/g,
    normalize: (m) => `${g(m.groups, 'year')} INSC ${g(m.groups, 'no')}`,
  },
  {
    id: 'hc-neutral',
    kind: 'neutral',
    regex:
      /\b(?<year>(?:19|20)\d{2})\s*:\s*(?<court>MHC|KHC)(?:-(?<bench>[A-Z]))?\s*:\s*(?<no>\d{1,6})\b/g,
    normalize: (m) => {
      const bench = g(m.groups, 'bench');
      const code = g(m.groups, 'court') + (bench === '' ? '' : `-${bench}`);
      return `${g(m.groups, 'year')}:${code}:${g(m.groups, 'no')}`;
    },
  },
  {
    id: 'scc-online',
    kind: 'reporter',
    regex:
      /\b(?<year>(?:19|20)\d{2})\s+SCC\s+OnLine\s+(?<court>[A-Z][A-Za-z]{1,6})\s+(?<no>\d{1,6})\b/g,
    normalize: (m) =>
      `${g(m.groups, 'year')} SCC OnLine ${court(g(m.groups, 'court'))} ${g(m.groups, 'no')}`,
  },
  {
    id: 'scc',
    kind: 'reporter',
    regex: /\((?<year>(?:19|20)\d{2})\)\s*(?<vol>\d{1,3})\s+SCC\s+(?<page>\d{1,5})\b/g,
    normalize: (m) => `(${g(m.groups, 'year')}) ${g(m.groups, 'vol')} SCC ${g(m.groups, 'page')}`,
  },
  {
    id: 'air',
    kind: 'reporter',
    regex:
      /\bAIR\s+(?<year>(?:19|20)\d{2})\s+(?<court>SC|[A-Z][A-Za-z]{1,5})\s+(?<page>\d{1,5})\b/g,
    normalize: (m) => {
      const c = g(m.groups, 'court');
      return `AIR ${g(m.groups, 'year')} ${c === 'SC' ? c : court(c)} ${g(m.groups, 'page')}`;
    },
  },
  {
    id: 'mlj',
    kind: 'reporter',
    regex: /\((?<year>(?:19|20)\d{2})\)\s*(?<vol>\d{1,2})\s+MLJ\s+(?<page>\d{1,5})\b/g,
    normalize: (m) => `(${g(m.groups, 'year')}) ${g(m.groups, 'vol')} MLJ ${g(m.groups, 'page')}`,
  },
  {
    id: 'ilr',
    kind: 'reporter',
    regex:
      /\bILR\s+\(?(?<year>(?:19|20)\d{2})\)?\s+(?:(?<vol>\d{1,3})\s+)?(?<court>[A-Z][A-Za-z]{1,10})\.?\s+(?<page>\d{1,5})\b/g,
    normalize: (m) => {
      const vol = g(m.groups, 'vol');
      return `ILR ${g(m.groups, 'year')} ${vol === '' ? '' : `${vol} `}${court(g(m.groups, 'court'))} ${g(m.groups, 'page')}`;
    },
  },
];

const NAME_WORD = String.raw`[A-Z][\w.&'’-]*`;
const NAME_TAIL = String.raw`(?:\s+(?:of|and|the|&|[A-Z][\w.&'’-]*)){0,6}`;

/** `Party v. Party`; the match carries both sides. */
export const CASE_NAME_PATTERN: CitationPattern = {
  id: 'case-name',
  kind: 'case_name',
  regex: new RegExp(
    String.raw`(?<left>${NAME_WORD}${NAME_TAIL})\s+(?:v\.?|vs\.?)\s+(?<right>${NAME_WORD}${NAME_TAIL})`,
    'g',
  ),
  normalize: (m) => `${g(m.groups, 'left')} v. ${g(m.groups, 'right')}`.replace(/\s+/g, ' '),
};

/** Words that start a sentence before a case name and are not part of it. */
export const CASE_NAME_LEAD = /^(?:In|See|Vide|Per|Also|Cf\.?|Following|Reliance on|Held in)\s+/;
