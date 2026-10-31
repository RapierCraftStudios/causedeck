// Accuracy of the enrichment on labelled sets (#894): citation precision and recall, and subject-tag
// macro-F1 over the vocabulary, each reported. The subject resolver here is a stand-in for the AI
// gateway: it scores the validation, vocabulary filter and ranking, not a model; the gateway-backed
// score is measured when the resolver is wired.
import { describe, expect, it } from 'vitest';

import {
  SUBJECT_AREAS,
  extractCitations,
  tagSubjects,
  type SubjectArea,
  type SubjectResolver,
} from './index.ts';

const LABELLED_CITATIONS: { text: string; expected: string[] }[] = [
  {
    text: 'Relied on Bhajan Lal (1992) Supp (1) SCC 335 and (2005) 6 SCC 1.',
    expected: ['(2005) 6 SCC 1'],
  },
  { text: 'As held in AIR 2010 SC 1234, the test is settled.', expected: ['AIR 2010 SC 1234'] },
  { text: 'See 2024 INSC 123 and 2024 insc 0123.', expected: ['2024 INSC 123'] },
  {
    text: 'Followed in 2026:MHC:1234 and 2025:KHC-D:567.',
    expected: ['2026:MHC:1234', '2025:KHC-D:567'],
  },
  { text: 'The decision reported at 2005 (3) MLJ 45 was cited.', expected: ['(2005) 3 MLJ 45'] },
  { text: '(1996) 4 SCR 1; 2012 (2) KLJ 100', expected: ['(1996) 4 SCR 1', '(2012) 2 KLJ 100'] },
  { text: 'Reported as 2020 SCC OnLine SC 123.', expected: ['2020 SCC OnLine SC 123'] },
  { text: 'AIR 1997 Mad 301 was distinguished.', expected: ['AIR 1997 MAD 301'] },
  { text: 'The appeal was filed on 12:30:45 under Section 3 of the Act in 2019.', expected: [] },
  { text: 'Crl.A. No. 1234 of 2019 decided in (2019) 5 SCC 22.', expected: ['(2019) 5 SCC 22'] },
  { text: 'No authority was cited on this point.', expected: [] },
  { text: 'AIR 2001 SC 12 and AIR 2001 SC 12 again.', expected: ['AIR 2001 SC 12'] },
];

describe('citation extraction', () => {
  it('meets precision 0.95 and recall 0.9 on the labelled set', () => {
    let truePositive = 0;
    let found = 0;
    let expected = 0;
    for (const { text, expected: want } of LABELLED_CITATIONS) {
      const got = extractCitations([{ pageNo: 1, text }]).map((c) => c.normalised);
      found += got.length;
      expected += want.length;
      truePositive += got.filter((c) => want.includes(c)).length;
    }
    const precision = truePositive / found;
    const recall = truePositive / expected;
    console.info(
      `citations: precision ${precision.toFixed(3)}, recall ${recall.toFixed(3)} over ${String(expected)} labelled`,
    );
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the page of the first citation and the raw string only', () => {
    const refs = extractCitations([
      { pageNo: 2, text: 'also AIR 2010 SC 99' },
      { pageNo: 1, text: 'first AIR 2010 SC 99 and 2024 INSC 7' },
    ]);
    expect(refs).toEqual([
      { raw: '2024 INSC 7', normalised: '2024 INSC 7', kind: 'neutral', page: 1 },
      { raw: 'AIR 2010 SC 99', normalised: 'AIR 2010 SC 99', kind: 'reporter', page: 1 },
    ]);
  });
});

const KEYWORDS: Record<SubjectArea, RegExp> = Object.fromEntries(
  SUBJECT_AREAS.map((a) => [a, new RegExp(a.replace(/_/g, '[ _-]'), 'i')]),
) as Record<SubjectArea, RegExp>;

const standIn: SubjectResolver = {
  version: 'stand-in-1',
  classify: ({ text, areas }) =>
    Promise.resolve({
      tags: areas.filter((a) => KEYWORDS[a].test(text)).map((area) => ({ area, confidence: 0.9 })),
    }),
};

const LABELLED_SUBJECTS: { text: string; areas: SubjectArea[] }[] = SUBJECT_AREAS.flatMap(
  (area, i) => {
    const next = SUBJECT_AREAS[(i + 1) % SUBJECT_AREAS.length] as SubjectArea;
    return [
      { text: `A matter of ${area.replace(/_/g, ' ')}.`, areas: [area] },
      {
        text: `Concerns ${area.replace(/_/g, ' ')} and ${next.replace(/_/g, ' ')}.`,
        areas: [area, next],
      },
    ];
  },
);

describe('subject tags', () => {
  it('reports macro-F1 of at least 0.8 over the vocabulary', async () => {
    const tp = new Map<string, number>();
    const fp = new Map<string, number>();
    const fn = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const { text, areas } of LABELLED_SUBJECTS) {
      const got =
        (
          await tagSubjects(text, { ...standIn, classify: async (i) => standIn.classify({ ...i }) })
        )?.map((t) => t.area) ?? [];
      for (const a of got) bump(areas.includes(a) ? tp : fp, a);
      for (const a of areas) if (!got.includes(a)) bump(fn, a);
    }
    const f1s = SUBJECT_AREAS.map((a) => {
      const p = (tp.get(a) ?? 0) / Math.max(1, (tp.get(a) ?? 0) + (fp.get(a) ?? 0));
      const r = (tp.get(a) ?? 0) / Math.max(1, (tp.get(a) ?? 0) + (fn.get(a) ?? 0));
      return p + r === 0 ? 0 : (2 * p * r) / (p + r);
    });
    const macro = f1s.reduce((a, b) => a + b, 0) / f1s.length;
    console.info(
      `subjects: macro-F1 ${macro.toFixed(3)} over ${String(SUBJECT_AREAS.length)} areas (stand-in resolver)`,
    );
    expect(macro).toBeGreaterThanOrEqual(0.8);
  });

  it('drops tags outside the vocabulary or below the confidence floor, and keeps the top three', async () => {
    const resolver: SubjectResolver = {
      version: 'v',
      classify: () =>
        Promise.resolve({
          tags: [
            { area: 'bail', confidence: 0.9 },
            { area: 'bail', confidence: 0.95 },
            { area: 'invented_area', confidence: 0.99 },
            { area: 'consumer', confidence: 0.3 },
            { area: 'tax', confidence: 0.8 },
            { area: 'service', confidence: 0.7 },
            { area: 'ibc', confidence: 0.6 },
          ],
        }),
    };
    expect(await tagSubjects('x', resolver)).toEqual([
      { area: 'bail', confidence: 0.95 },
      { area: 'tax', confidence: 0.8 },
      { area: 'service', confidence: 0.7 },
    ]);
  });

  it('returns null for an invalid reply instead of guessing', async () => {
    const bad: SubjectResolver = {
      version: 'v',
      classify: () => Promise.resolve({ tags: 'bail' }),
    };
    expect(await tagSubjects('x', bad)).toBeNull();
  });
});
