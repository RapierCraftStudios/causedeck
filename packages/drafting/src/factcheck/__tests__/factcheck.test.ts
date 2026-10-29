import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createMockResolver } from '../../citations/resolvers/mock';
import {
  createClaimIndex,
  extractClaims,
  extractWithPort,
  NO_MATTER_FACTS,
  normalizeDigits,
  verify,
  type Claim,
  type ClaimKind,
  type ClaimPort,
  type MatterFacts,
  type SourceAnchor,
} from '../index';

interface Gold {
  court: 'madras-md' | 'karnataka';
  text: string;
  expect: readonly [ClaimKind, string][];
}

// Every claim a draft states in each text is listed; anything else extracted counts against precision.
const GOLD: readonly Gold[] = [
  // dates
  {
    court: 'madras-md',
    text: 'The order dated 12/03/2025 was passed by this Court.',
    expect: [['date', '2025-03-12']],
  },
  {
    court: 'madras-md',
    text: 'Listed on 1st January 2026 before the Madurai Bench.',
    expect: [['date', '2026-01-01']],
  },
  {
    court: 'karnataka',
    text: 'The impugned order dated 5th August 2024 is challenged.',
    expect: [['date', '2024-08-05']],
  },
  { court: 'karnataka', text: 'It was listed on 03.11.2025.', expect: [['date', '2025-11-03']] },
  {
    court: 'karnataka',
    text: 'ಆದೇಶ ದಿನಾಂಕ ೧೨/೦೩/೨೦೨೫ ರಂದು ಹೊರಡಿಸಲಾಗಿದೆ.',
    expect: [['date', '2025-03-12']],
  },
  {
    court: 'madras-md',
    text: 'தீர்ப்பு நாள் ௧௨/௦௩/௨௦௨௫ அன்று வழங்கப்பட்டது.',
    expect: [['date', '2025-03-12']],
  },
  // case numbers
  {
    court: 'madras-md',
    text: 'W.P.(MD)No.1234 of 2024 is pending.',
    expect: [['case_number', 'WP(MD)/1234/2024']],
  },
  {
    court: 'madras-md',
    text: 'Crl.O.P.(MD) No. 567 of 2023 seeks quashing.',
    expect: [['case_number', 'CRLOP(MD)/567/2023']],
  },
  {
    court: 'madras-md',
    text: 'The appeal W.A.(MD)No.88 of 2022 was dismissed.',
    expect: [['case_number', 'WA(MD)/88/2022']],
  },
  {
    court: 'karnataka',
    text: 'W.P. No. 4521 of 2024 (GM-RES) is listed.',
    expect: [['case_number', 'WP/4521/2024']],
  },
  {
    court: 'karnataka',
    text: 'Crl.P. No. 100 of 2025 was filed.',
    expect: [['case_number', 'CRLP/100/2025']],
  },
  {
    court: 'karnataka',
    text: 'R.F.A. No. 12 of 2021 arises from the suit.',
    expect: [['case_number', 'RFA/12/2021']],
  },
  // party roles
  {
    court: 'madras-md',
    text: 'Mr. Ramesh Kumar, the Petitioner herein, states as follows.',
    expect: [['party_role', 'Ramesh Kumar']],
  },
  {
    court: 'karnataka',
    text: 'Smt. Anitha Rao, the Respondent herein, denies this.',
    expect: [['party_role', 'Anitha Rao']],
  },
  // amounts
  {
    court: 'madras-md',
    text: 'The petitioner paid Rs. 1,50,000 as advance.',
    expect: [['amount', '15000000']],
  },
  { court: 'karnataka', text: 'A sum of ₹2,500.50 is due.', expect: [['amount', '250050']] },
  {
    court: 'karnataka',
    text: 'Compensation of Rs.1.5 lakh was awarded.',
    expect: [['amount', '15000000']],
  },
  {
    court: 'madras-md',
    text: 'The project cost INR 2 crore in total.',
    expect: [['amount', '2000000000']],
  },
  // neutral citations
  {
    court: 'madras-md',
    text: 'Reliance is placed on 2024:MHC:1234 in support.',
    expect: [['citation', '2024:MHC:1234']],
  },
  {
    court: 'karnataka',
    text: 'See 2024:KHC:5678 on this point.',
    expect: [['citation', '2024:KHC:5678']],
  },
  {
    court: 'karnataka',
    text: 'The Supreme Court held in 2023 INSC 123 that notice is required.',
    expect: [['citation', '2023 INSC 123']],
  },
  // CNR
  {
    court: 'madras-md',
    text: 'CNR: HCMD01-012345-2024 is the record number.',
    expect: [['cnr', 'HCMD010123452024']],
  },
  {
    court: 'karnataka',
    text: 'The case CNR is KAHC010045672025.',
    expect: [['cnr', 'KAHC010045672025']],
  },
  // court / hall / item
  {
    court: 'madras-md',
    text: 'The matter is in Court Hall No. 5 at Item No. 14.',
    expect: [
      ['court_ref', '5'],
      ['court_ref', '14'],
    ],
  },
  {
    court: 'karnataka',
    text: 'Listed before Court No. 12, Item 3 of the cause list.',
    expect: [
      ['court_ref', '12'],
      ['court_ref', '3'],
    ],
  },
  // nothing to claim
  {
    court: 'karnataka',
    text: 'The petitioner prays for such other relief as this Court deems fit.',
    expect: [],
  },
  { court: 'madras-md', text: 'The facts are set out in the paragraphs below.', expect: [] },
];

describe('extractClaims gold set', () => {
  const stats = new Map<ClaimKind, { tp: number; fp: number; fn: number }>();
  const bump = (k: ClaimKind, f: 'tp' | 'fp' | 'fn'): void => {
    const s = stats.get(k) ?? { tp: 0, fp: 0, fn: 0 };
    s[f] += 1;
    stats.set(k, s);
  };
  for (const g of GOLD) {
    const got = extractClaims(g.text).map((c) => `${c.kind}|${c.value}`);
    const want = g.expect.map(([k, v]) => `${k}|${v}`);
    for (const w of want) bump(w.split('|')[0] as ClaimKind, got.includes(w) ? 'tp' : 'fn');
    for (const x of got) if (!want.includes(x)) bump(x.split('|')[0] as ClaimKind, 'fp');
  }

  it.each(['date', 'case_number', 'party_role', 'amount', 'citation', 'cnr', 'court_ref'] as const)(
    '%s: precision >= 98% and recall >= 90% for both courts',
    (kind) => {
      const s = stats.get(kind) ?? { tp: 0, fp: 0, fn: 0 };
      expect(s.tp + s.fn, 'gold examples').toBeGreaterThan(0);
      expect(s.tp / Math.max(1, s.tp + s.fp)).toBeGreaterThanOrEqual(0.98);
      expect(s.tp / (s.tp + s.fn)).toBeGreaterThanOrEqual(0.9);
    },
  );

  it('covers both launch courts for each fact type', () => {
    for (const court of ['madras-md', 'karnataka'] as const) {
      const kinds = new Set(
        GOLD.filter((g) => g.court === court).flatMap((g) => g.expect.map(([k]) => k)),
      );
      expect(kinds.size, court).toBeGreaterThanOrEqual(5);
    }
  });

  it('maps Tamil and Kannada digits without moving spans', () => {
    const text = 'ಆದೇಶ ದಿನಾಂಕ ೧೨/೦೩/೨೦೨೫ ರಂದು';
    expect(normalizeDigits(text)).toHaveLength(text.length);
    const [claim] = extractClaims(text);
    expect(claim && text.slice(claim.start, claim.end)).toBe('೧೨/೦೩/೨೦೨೫');
  });
});

const anchor = (document: string, page: number, quote: string): SourceAnchor => ({
  document,
  page,
  quote,
});

const FACTS: MatterFacts = {
  ...NO_MATTER_FACTS,
  proceedings: [
    {
      caseType: 'WP(MD)',
      number: '1234',
      year: 2024,
      anchor: anchor('petition.pdf', 1, 'W.P.(MD)No.1234 of 2024'),
    },
  ],
  dates: [
    { iso: '2025-03-12', context: 'order', anchor: anchor('order.pdf', 2, 'Dated: 12.03.2025') },
    { iso: '2026-01-01', context: 'listing', anchor: anchor('cause-list.pdf', 1, '01.01.2026') },
  ],
  parties: [
    {
      role: 'petitioner',
      name: 'Ramesh Kumar',
      anchor: anchor('petition.pdf', 1, 'Ramesh Kumar ... Petitioner'),
    },
    {
      role: 'respondent',
      name: 'State of Tamil Nadu',
      anchor: anchor('petition.pdf', 1, 'State of Tamil Nadu ... Respondent'),
    },
  ],
  amounts: [{ rupees: 150000, anchor: anchor('receipt.pdf', 1, 'Rs.1,50,000') }],
  cnrs: [
    { cnr: 'HCMD01-012345-2024', anchor: anchor('petition.pdf', 1, 'CNR HCMD01-012345-2024') },
  ],
  courtRefs: [{ ref: 'hall', value: '5', anchor: anchor('cause-list.pdf', 1, 'Court Hall 5') }],
};

const statusOf = async (
  text: string,
  facts = FACTS,
  resolver = createMockResolver(),
): Promise<string[]> =>
  (await verify(extractClaims(text), facts, { resolver })).map((v) => v.status);

describe('verify', () => {
  it('returns match with the record anchor', async () => {
    const [v] = await verify(extractClaims('The order dated 12/03/2025 stands.'), FACTS);
    expect(v?.status).toBe('match');
    expect(v?.anchor).toEqual(anchor('order.pdf', 2, 'Dated: 12.03.2025'));
  });

  it('flags a wrong order date, case number, CNR, hall and amount-less party role', async () => {
    expect(await statusOf('The order dated 13/03/2025 stands.')).toEqual(['mismatch']);
    expect(await statusOf('W.P.(MD)No.9999 of 2024 is pending.')).toEqual(['mismatch']);
    expect(await statusOf('W.P.No.1234 of 2024 is pending.')).toEqual(['mismatch']);
    expect(await statusOf('CNR HCMD01-099999-2024 here.')).toEqual(['mismatch']);
    expect(await statusOf('Listed in Court Hall No. 6.')).toEqual(['mismatch']);
    expect(await statusOf('Mr. Ramesh Kumar, the Respondent herein, says so.')).toEqual([
      'mismatch',
    ]);
  });

  it('is unsupported where the record is silent and keeps the draft quote as anchor', async () => {
    const [v] = await verify(extractClaims('A sum of Rs. 99,999 is due.'), FACTS, {
      draftDocument: 'draft-v3',
    });
    expect(v?.status).toBe('unsupported');
    expect(v?.anchor).toEqual({ document: 'draft-v3', page: null, quote: 'Rs. 99,999' });
    expect(await statusOf('The matter of 12/03/2025 is old.')).toEqual(['match']);
    expect(await statusOf('The matter of 14/03/2025 is old.')).toEqual(['unsupported']);
  });

  it('is ambiguous when the record holds several disagreeing candidates', async () => {
    const facts: MatterFacts = {
      ...FACTS,
      dates: [
        { iso: '2025-03-12', context: 'order', anchor: anchor('a.pdf', 1, 'a') },
        { iso: '2025-04-01', context: 'order', anchor: anchor('b.pdf', 1, 'b') },
      ],
    };
    expect(await statusOf('The order dated 13/03/2025 stands.', facts)).toEqual(['ambiguous']);
    const both: MatterFacts = {
      ...FACTS,
      parties: [
        { role: 'petitioner', name: 'Ramesh Kumar', anchor: anchor('a.pdf', 1, 'a') },
        { role: 'respondent', name: 'Ramesh Kumar', anchor: anchor('b.pdf', 1, 'b') },
      ],
    };
    expect(await statusOf('Mr. Ramesh Kumar, the Petitioner, says so.', both)).toEqual(['match']);
  });

  it('resolves citations with the #77 resolver and never offers another authority', async () => {
    const good = await verify(
      extractClaims('Ramesh Kumar v. State of Kerala, 2023 INSC 123.'),
      FACTS,
      { resolver: createMockResolver() },
    );
    const cite = good.find((v) => v.claim.kind === 'citation');
    expect(cite?.status).toBe('match');
    const bad = await verify(extractClaims('See 2022 INSC 999.'), FACTS, {
      resolver: createMockResolver(),
    });
    expect(bad.map((v) => v.status)).toEqual(['unverified-citation']);
    const down = await verify(extractClaims('See 2023 INSC 123.'), FACTS, {
      resolver: createMockResolver(undefined, { unavailable: true }),
    });
    expect(down[0]?.status).toBe('unverified-citation');
    expect(down[0]?.reason).toBe('resolver_unavailable');
    const none = await verify(extractClaims('See 2023 INSC 123.'), FACTS);
    expect(none[0]?.status).toBe('unverified-citation');
    // No verdict carries an authority other than the one the author wrote.
    for (const v of [...bad, ...down, ...none]) {
      expect(JSON.stringify(v)).not.toMatch(/Kerala|Lakshmi|Anitha Rao v\./);
    }
  });
});

describe('no merit judgement and no replacement authority (PX-6)', () => {
  const sources = ['types', 'extract', 'verify', 'index'].map((f) =>
    readFileSync(new URL(`../${f}.ts`, import.meta.url), 'utf8')
      .split('\n')
      .filter(
        (l) =>
          !l.trimStart().startsWith('//') &&
          !l.trimStart().startsWith('*') &&
          !l.trimStart().startsWith('/**'),
      )
      .join('\n'),
  );

  it('has no AI import, suggestion or merit vocabulary in executable code', () => {
    for (const src of sources) {
      expect(src).not.toMatch(
        /@causedeck\/ai|gateway|\bsuggest|\breplacement\b|\bmerit|\bcorrect(?:ion)?\b|\bpropos/i,
      );
    }
  });

  it('verdict statuses are the five labels and carry no authority text', async () => {
    const verdicts = await verify(
      extractClaims('See 2023 INSC 999 and 2024:MHC:1234. The order dated 13/03/2025.'),
      FACTS,
      { resolver: createMockResolver() },
    );
    for (const v of verdicts) {
      expect(['match', 'mismatch', 'unsupported', 'unverified-citation', 'ambiguous']).toContain(
        v.status,
      );
      expect(Object.keys(v).sort()).not.toContain('title');
      expect(Object.keys(v).sort()).not.toContain('suggestion');
    }
  });
});

describe('optional claim port', () => {
  it('adds non-overlapping valid claims, drops invalid ones and is told indiaOnly', async () => {
    const seen: boolean[] = [];
    const mock: ClaimPort = {
      findClaims: (req) => {
        seen.push(req.indiaOnly);
        return Promise.resolve([
          { kind: 'amount', start: 4, end: 11, value: '5' }, // overlaps nothing: kept
          { kind: 'date', start: 0, end: 99999, value: 'x' }, // out of range: dropped
          { kind: 'date', start: 36, end: 44, value: '2025-03-12' }, // overlaps rule claim: dropped
        ]);
      },
    };
    const text = 'Paid five rupees. The order dated 12/03/2025.';
    const claims: Claim[] = await extractWithPort(text, 'b', mock);
    expect(seen).toEqual([true]);
    expect(claims.filter((c) => c.origin === 'port').map((c) => c.kind)).toEqual(['amount']);
    expect(claims.filter((c) => c.kind === 'date')).toHaveLength(1);
    expect((await extractWithPort(text, 'b', undefined)).every((c) => c.origin === 'rule')).toBe(
      true,
    );
  });
});

describe('incremental speed', () => {
  const para = (i: number): string =>
    `Para ${String(i)}. The order dated 12/03/2025 in W.P.(MD)No.1234 of 2024 was passed. Mr. Ramesh Kumar, the Petitioner herein, paid Rs. 1,50,000. ` +
    'The matter is in Court Hall No. 5. See 2023 INSC 123. '.repeat(1) +
    'The petitioner relies on the facts set out above and prays for relief in the circumstances of the case. '.repeat(
      8,
    );

  it('p95 <= 150 ms to re-check one edited block of a 10-page draft', () => {
    const blocks = Array.from({ length: 60 }, (_, i) => ({ key: `b.${String(i)}`, text: para(i) }));
    expect(blocks.map((b) => b.text).join('').length).toBeGreaterThan(30_000);
    const index = createClaimIndex();
    index.update(blocks);
    const times: number[] = [];
    for (let n = 0; n < 40; n++) {
      const edited = blocks.map((b, i) =>
        i === n % 60 ? { ...b, text: `${b.text} edit ${String(n)}` } : b,
      );
      const t0 = performance.now();
      index.update(edited);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)] ?? Infinity).toBeLessThanOrEqual(150);
  });
});
