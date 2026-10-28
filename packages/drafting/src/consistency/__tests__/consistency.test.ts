import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Block } from '@causedeck/validators/drafting';
import { FindingSchema } from '@causedeck/validators/consistency';
import { describe, expect, it } from 'vitest';

import { checkDraft, EMPTY_FACTS, type ConsistencyFacts } from '../index';
import { canonicalCaseType, findCaseNumbers } from '../match-case-numbers';
import { findDates } from '../match-dates';
import { namesMatch } from '../match-names';

const prov = (fact: string) => ({ fact, sourceType: 'manual', sourceRef: null, anchorId: 'a1' });
const para = (text: string, id?: string): Block => ({
  type: 'paragraph',
  text,
  ...(id ? { id } : {}),
});

const facts: ConsistencyFacts = {
  parties: [
    {
      role: 'petitioner',
      name: 'Ramesh Kumar',
      aliases: ['ரமேஷ் குமார்'],
      provenance: prov('party.petitioner'),
    },
    {
      role: 'respondent',
      name: 'State of Karnataka',
      aliases: [],
      provenance: prov('party.respondent'),
    },
    {
      role: 'petitioner',
      name: 'ಸುರೇಶ್ ಗೌಡ',
      aliases: ['Suresh Gowda'],
      provenance: prov('party.petitioner'),
    },
  ],
  proceedings: [
    {
      caseTypeCode: 'WP',
      caseTypeRaw: 'W.P.',
      number: '1234',
      year: 2025,
      provenance: prov('proceeding'),
    },
  ],
  listingDates: [{ iso: '2025-03-12', provenance: prov('listing') }],
  orderDates: [{ iso: '2025-02-01', provenance: prov('order') }],
  annexures: [
    { n: 1, provenance: prov('document') },
    { n: 2, provenance: prov('document') },
  ],
};

const run = (...texts: string[]) =>
  checkDraft({ blocks: texts.map((t) => para(t)), facts: { ...facts, annexures: [] } }).findings;

describe('names', () => {
  it('flags a name that differs beyond aliases', () => {
    const f = run('Shri Ramesh Kumaar, the Petitioner, states');
    expect(f.map((x) => x.rule)).toEqual(['name.mismatch']);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.expected).toBe('Ramesh Kumar');
  });
  it('accepts honorific, initial and alias variants silently', () => {
    expect(run('Mr. Ramesh Kumar', 'Thiru R. Kumar', 'Smt Ramesh Kumar')).toEqual([]);
    expect(run('Shri Suresh Gowda the Petitioner')).toEqual([]);
  });
  it('compares Tamil and Kannada after NFC and ignores script differences via alias', () => {
    const nfd = 'ரமேஷ் குமார்'.normalize('NFD');
    expect(namesMatch(nfd, 'ரமேஷ் குமார்')).toBe(true);
    expect(run('திரு ரமேஷ் குமார் the Petitioner')).toEqual([]);
    expect(run('ಶ್ರೀ ಸುರೇಶ್ ಗೌಡ'.normalize('NFD'))).toEqual([]);
  });
  it('leaves unrelated people alone', () => {
    expect(run('Shri Anand Verma appeared for the bank')).toEqual([]);
  });
});

describe('case numbers', () => {
  const madras = [
    'W.P.No.1234 of 2025',
    'WP 1234/2025',
    'W.P.(MD) No. 1234 of 2025',
    'W.P. No. 1234/2025',
    'Writ Petition No. 1234 of 2025',
    'WP.No.1234 of 2025',
    'W.P.(MD)No.1234/2025',
    'WP No 1234 of 2025',
    'W.P.Nos.1234 of 2025',
    'Writ Petition (Civil) No.1234 of 2025',
    'W.P. 01234 of 2025',
  ];
  const karnataka = [
    'WP 1234/2025',
    'W.P. No. 1234/2025',
    'WP/1234/2025',
    'Crl.P.No.55/2025',
    'CRL.P. 55 of 2025',
    'Crl.O.P.No.55/2025',
    'Writ Appeal No.12/2025',
    'WA 12/2025',
    'R.F.A. No. 7 of 2025',
    'RFA 7/2025',
    'Criminal Petition No. 55 of 2025',
    'W.P.(C) 1234/2025',
  ];
  it.each(madras)('reads Madras form %s', (s) => {
    const [h] = findCaseNumbers(`In ${s} the court`);
    expect(h).toMatchObject({ caseType: 'WP', number: '1234', year: 2025 });
  });
  it.each(karnataka)('reads Karnataka form %s', (s) => {
    const [h] = findCaseNumbers(`See ${s}.`);
    expect(h).toBeDefined();
    expect(h?.year).toBe(2025);
  });
  it('accepts a matching number and flags a mismatch with the expected value', () => {
    expect(run('in W.P.No.1234 of 2025')).toEqual([]);
    const f = run('in W.P.No.1243 of 2025');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      rule: 'case_number.mismatch',
      severity: 'error',
      expected: 'W.P. No.1234 of 2025',
    });
    expect(f[0]?.fix?.replacement).toBe('W.P. No.1234 of 2025');
  });
  it('ignores an unrelated case type and non-case text', () => {
    expect(run('in Crl.P.No.55 of 2024')).toEqual([]);
    expect(canonicalCaseType('Hello')).toBeUndefined();
  });
});

describe('dates', () => {
  it.each([
    ['12/03/2025', '2025-03-12'],
    ['12.03.2025', '2025-03-12'],
    ['12-03-2025', '2025-03-12'],
    ['1st January 2025', '2025-01-01'],
    ['2nd Feb, 2025', '2025-02-02'],
    ['the 23rd day of March 2025', '2025-03-23'],
    ['first of April 2025', '2025-04-01'],
    ['twenty-first December 2025', '2025-12-21'],
  ])('parses %s', (s, iso) => {
    expect(findDates(`on ${s} it`)[0]?.iso).toBe(iso);
  });
  it('rejects impossible dates', () => {
    expect(findDates('on 31/02/2025')).toEqual([]);
  });
  it('flags an order date and a listing date that contradict the graph, with both values', () => {
    const f = run(
      'The order dated 05/02/2025 was passed.',
      'The matter is listed on 15th March 2025.',
    );
    expect(f.map((x) => x.rule)).toEqual(['date.order_mismatch', 'date.listing_mismatch']);
    expect(f[0]).toMatchObject({ expected: '01/02/2025', found: '05/02/2025' });
    expect(f[1]).toMatchObject({ expected: '12/03/2025', found: '15th March 2025' });
  });
  it('accepts matching dates', () => {
    expect(run('The order dated 1st February 2025', 'listed on 12.03.2025')).toEqual([]);
  });
});

describe('annexures', () => {
  it('yields a distinct rule for each condition', () => {
    const f = checkDraft({
      blocks: [
        para('Annexure P-1 - Copy of the order'),
        para('Annexure P-1 - Copy of the order again'),
        para('as per Annexure P-5'),
        para('and Annexure P-3'),
      ],
      facts: {
        ...facts,
        annexures: [...(facts.annexures ?? []), { n: 6, provenance: prov('document') }],
      },
    }).findings;
    const rules = new Set(f.map((x) => x.rule));
    expect(rules).toEqual(
      new Set(['annexure.duplicate', 'annexure.missing', 'annexure.gap', 'annexure.unreferenced']),
    );
  });
  it('is quiet when references match attachments', () => {
    expect(checkDraft({ blocks: [para('Annexure P-1 and Annexure P-2')], facts }).findings).toEqual(
      [],
    );
  });
});

describe('findings', () => {
  it('carry span, graph fact and provenance, and are valid findings', () => {
    const f = run(
      'Shri Ramesh Kumaar the Petitioner in W.P.No.1243 of 2025, order dated 05/02/2025, Annexure P-9',
    );
    expect(f.length).toBeGreaterThanOrEqual(4);
    for (const x of f) {
      expect(FindingSchema.safeParse(x).success).toBe(true);
      expect(x.provenance.fact).not.toBe('');
      expect(x.span.blockKey).not.toBe('');
    }
  });
  it('is deterministic and counts severities', () => {
    const blocks = [para('Shri Ramesh Kumaar the Petitioner'), para('in W.P.No.1243 of 2025')];
    const a = checkDraft({ blocks, facts });
    expect(checkDraft({ blocks, facts })).toEqual(a);
    expect(a.counts.error).toBe(2);
    expect(checkDraft({ blocks, facts: EMPTY_FACTS }).findings).toEqual([]);
  });
});

describe('static and perf', () => {
  it('imports nothing from the ai package under consistency/', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(
        /from '@causedeck\/ai|from '[^']*packages\/ai/,
      );
    }
  });
  it('checks a 30-page draft in under 2 s', () => {
    const blocks: Block[] = [];
    for (let i = 0; i < 30 * 12; i++) {
      blocks.push(
        para(
          `Shri Ramesh Kumar, the Petitioner, filed W.P.No.1234 of 2025 on ${String((i % 28) + 1)}/03/2025; see Annexure P-${String((i % 2) + 1)} and the order dated 1st February 2025, which the learned counsel read at length before this Hon'ble Court.`,
        ),
      );
    }
    const t = performance.now();
    const { findings } = checkDraft({ blocks, facts });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(findings).toEqual([]);
  });
});
