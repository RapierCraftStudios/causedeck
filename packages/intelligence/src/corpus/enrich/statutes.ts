// Statute references of a judgment (#894, ADR 0051 §Enrichment): every `section N <Act>` the redacted
// pages cite, with the first page it is cited on. The section parser is the #497 matcher's
// (`SECTION_REF`) and the keys are `normaliseStatute` / `normaliseSection`, so a facet and a matter's
// issue tag compare equal. Pure and deterministic.
import { normaliseSection, normaliseStatute } from '../../issues/index.ts';
import { SECTION_REF } from '../match.ts';

import { BNS, BNSS, BSA, CRPC, IEA, IPC, facetKeys, sectionWithin } from './code-map.ts';
import type { StatuteSection } from './code-map.ts';

export interface StatutePage {
  pageNo: number;
  text: string;
}

export interface StatuteRef extends StatuteSection {
  page: number;
}

/** Characters after a section number searched for the statute name. */
const STATUTE_WINDOW = 120;

/** Normalised statute name and the words it is written as in a judgment (lower case, punctuation as spaces). */
const KNOWN_STATUTES: readonly (readonly [string, readonly string[]])[] = [
  [IPC, ['indian penal code', 'ipc', 'i p c']],
  [BNS, ['bharatiya nyaya sanhita', 'bns']],
  [CRPC, ['code of criminal procedure', 'crpc', 'cr p c', 'cr pc']],
  [BNSS, ['bharatiya nagarik suraksha sanhita', 'bnss']],
  [IEA, ['indian evidence act', 'evidence act', 'iea']],
  [BSA, ['bharatiya sakshya adhiniyam', 'bsa']],
  ['code of civil procedure', ['code of civil procedure', 'cpc', 'c p c']],
  ['negotiable instruments act', ['negotiable instruments act', 'ni act', 'n i act', 'nia']],
  [
    'narcotic drugs and psychotropic substances act',
    ['narcotic drugs and psychotropic substances act', 'ndps act', 'ndps'],
  ],
  [
    'arbitration and conciliation act',
    ['arbitration and conciliation act', 'arbitration act', 'a and c act'],
  ],
  ['insolvency and bankruptcy code', ['insolvency and bankruptcy code', 'ibc']],
  ['motor vehicles act', ['motor vehicles act', 'mv act']],
  ['consumer protection act', ['consumer protection act']],
];

function words(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:of )?(?:the )?/, '');
}

/** Spellings longest first, so `evidence act` never shadows `indian evidence act`. */
const SPELLINGS = KNOWN_STATUTES.flatMap(([statute, spellings]) =>
  spellings.map((spelling) => ({ statute, spelling })),
).sort((a, b) => b.spelling.length - a.spelling.length);

/** The statute a judgment's words name at the start of `window`, or null. */
function statuteAtStart(window: string): string | null {
  const text = words(window);
  for (const { statute, spelling } of SPELLINGS) {
    if (!text.startsWith(spelling)) continue;
    const next = text.charAt(spelling.length);
    if (next === '' || next === ' ') return statute;
  }
  return null;
}

/** One key for a statute as a user writes it: `NDPS Act` and `ipc` both resolve to their full name. */
export function canonicalStatute(raw: string): string {
  const text = words(raw).replace(/\s(?:19|20)\d{2}$/, '');
  for (const { statute, spelling } of SPELLINGS) if (text === spelling) return statute;
  return normaliseStatute(raw);
}

/** The statute sections `pages` cite, once each, on the first page that cites them. */
export function extractStatuteRefs(pages: readonly StatutePage[]): StatuteRef[] {
  const found = new Map<string, StatuteRef>();
  for (const page of [...pages].sort((a, b) => a.pageNo - b.pageNo)) {
    for (const line of page.text.split('\n')) {
      for (const ref of line.matchAll(SECTION_REF)) {
        const section = normaliseSection(ref[1] ?? '');
        const start = ref.index + ref[0].length;
        const statute = statuteAtStart(line.slice(start, start + STATUTE_WINDOW));
        if (section === '' || statute === null) continue;
        const key = `${statute}|${section}`;
        if (!found.has(key)) found.set(key, { statute, section, page: page.pageNo });
      }
    }
  }
  return [...found.values()];
}

/** True when `refs` answer a facet search for `query`, directly or through the IPC/BNS, CrPC/BNSS, IEA/BSA mapping. */
export function matchesStatuteFacet(
  refs: readonly StatuteSection[],
  query: StatuteSection,
): boolean {
  const keys = facetKeys({ statute: canonicalStatute(query.statute), section: query.section });
  return refs.some((r) =>
    keys.some((k) => r.statute === k.statute && sectionWithin(r.section, k.section)),
  );
}
