// Corpus enrichment (#894): statute refs with their page, the IPC/BNS facet, offence-date-aware
// equivalents, and outcomes that are anchored or `unknown`.
import { describe, expect, it } from 'vitest';

import {
  BNS,
  BNSS,
  CRPC,
  IPC,
  baseSection,
  canonicalStatute,
  codeInForce,
  equivalents,
  extractOutcome,
  extractStatuteRefs,
  facetKeys,
  matchesStatuteFacet,
  rulesetVersion,
} from './index.ts';

const PAGES = [
  { pageNo: 1, text: 'The appellant was charged under Section 34 of the Indian Penal Code.' },
  {
    pageNo: 3,
    text: 'The death was alleged to result from a rash act, an offence under Section 304A IPC.\nThe High Court relied on s. 482 Cr.P.C. and Section 65B of the Evidence Act.',
  },
  { pageNo: 4, text: 'Section 304A of the Indian Penal Code was applied again; section 11 (6) of the Arbitration Act.' },
];

describe('statute refs', () => {
  const refs = extractStatuteRefs(PAGES);

  it('finds each section with the first page that cites it', () => {
    expect(refs).toContainEqual({ statute: IPC, section: '34', page: 1 });
    expect(refs).toContainEqual({ statute: IPC, section: '304a', page: 3 });
    expect(refs).toContainEqual({ statute: CRPC, section: '482', page: 3 });
    expect(refs).toContainEqual({ statute: 'indian evidence act', section: '65b', page: 3 });
    expect(refs).toContainEqual({ statute: 'arbitration and conciliation act', section: '11(6)', page: 4 });
    expect(refs.filter((r) => r.section === '304a')).toHaveLength(1);
  });

  it('ignores a section with no statute named', () => {
    expect(extractStatuteRefs([{ pageNo: 1, text: 'See section 12 of the lease deed.' }])).toEqual([]);
  });

  it('canonicalises a statute as written', () => {
    expect(canonicalStatute('NDPS Act, 1985')).toBe('narcotic drugs and psychotropic substances act');
    expect(canonicalStatute('BNS')).toBe(BNS);
    expect(canonicalStatute('The Hindu Marriage Act, 1955')).toBe('hindu marriage act');
  });
});

describe('IPC and BNS correspondence', () => {
  const refs = extractStatuteRefs(PAGES);

  it('retrieves an IPC 304A judgment by the BNS 106 facet, and the reverse', () => {
    expect(matchesStatuteFacet(refs, { statute: 'BNS', section: '106' })).toBe(true);
    expect(matchesStatuteFacet(refs, { statute: 'bns', section: '106(1)' })).toBe(true);
    expect(matchesStatuteFacet(refs, { statute: 'BNS', section: '103' })).toBe(false);
    const bnsRefs = [{ statute: BNS, section: '106(1)' }];
    expect(matchesStatuteFacet(bnsRefs, { statute: 'IPC', section: '304A' })).toBe(true);
  });

  it('maps the procedure code too', () => {
    expect(facetKeys({ statute: BNSS, section: '528' })).toContainEqual({ statute: CRPC, section: '482' });
    expect(matchesStatuteFacet(refs, { statute: 'BNSS', section: '528' })).toBe(true);
  });

  it('marks which code governs an offence by its date', () => {
    expect(codeInForce('2024-06-30')).toBe('old');
    expect(codeInForce('2024-07-01')).toBe('new');
    const ref = { statute: IPC, section: '304A' };
    expect(equivalents(ref, '2022-05-01')).toEqual([{ statute: BNS, section: '106', inForce: false }]);
    expect(equivalents(ref, '2025-01-01')).toEqual([{ statute: BNS, section: '106', inForce: true }]);
    expect(equivalents(ref)).toEqual([{ statute: BNS, section: '106', inForce: null }]);
    expect(baseSection('Section 106(1)')).toBe('106');
  });

  it('versions its output', () => {
    expect(rulesetVersion(2)).toBe('enrich-2');
  });
});

describe('outcome', () => {
  const pages = [
    { pageNo: 8, text: 'Reasoning.\n\n14. For these reasons the appeal is allowed in part and the award is reduced.' },
    { pageNo: 9, text: '15. The pending applications stand disposed of.\nNo order as to costs.' },
  ];
  const decision = (text: string, from = 8, to = 9) => [{ role: 'decision', pageFrom: from, pageTo: to, text }];

  it('reads the operative sentence with its page, preferring it over boilerplate', () => {
    const result = extractOutcome(
      decision(
        '14. For these reasons the appeal is allowed in part and the award is reduced.\n15. The pending applications stand disposed of.',
      ),
      pages,
    );
    expect(result.outcome).toBe('partly_allowed');
    expect(result.anchor).toEqual({
      page: 8,
      quote: '14. For these reasons the appeal is allowed in part and the award is reduced.',
    });
  });

  it('reads a dismissal', () => {
    const p = [{ pageNo: 5, text: 'In the result, the appeal is dismissed.' }];
    expect(extractOutcome(decision('In the result, the appeal is dismissed.', 5, 5), p)).toEqual({
      outcome: 'dismissed',
      anchor: { page: 5, quote: 'In the result, the appeal is dismissed.' },
    });
  });

  it('is unknown without a decision sentence', () => {
    const p = [{ pageNo: 5, text: 'We have heard counsel at length.' }];
    expect(extractOutcome(decision('We have heard counsel at length.', 5, 5), p)).toEqual({
      outcome: 'unknown',
      anchor: null,
    });
  });

  it('is unknown when the sentence is outside a decision segment', () => {
    const p = [{ pageNo: 5, text: 'The appeal is dismissed.' }];
    const reasoning = [{ role: 'reasoning', pageFrom: 5, pageTo: 5, text: 'The appeal is dismissed.' }];
    expect(extractOutcome(reasoning, p).outcome).toBe('unknown');
  });

  it('is unknown when the sentence cannot be placed on a page', () => {
    expect(extractOutcome(decision('The appeal is dismissed.', 5, 5), [{ pageNo: 5, text: 'Other text.' }])).toEqual({
      outcome: 'unknown',
      anchor: null,
    });
  });
});
