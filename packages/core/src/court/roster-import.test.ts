// Roster-PDF preview (#385): candidates and the effective date from synthetic Madras-style and
// Karnataka-style rosters, a roster without a date asking the lawyer for one, judge-name
// normalisation collapsing three spellings into one `bench.judges` entry, and a preview that
// persists nothing (the module reaches no database, storage or notification code).
import { readFileSync } from 'node:fs';

import { RosterCandidateSchema } from '@causedeck/validators/roster';
import { describe, expect, it } from 'vitest';

import {
  KARNATAKA_EXPECTED,
  MADRAS_EXPECTED,
  karnatakaRosterPdf,
  madrasRosterPdf,
  rosterPdf,
  type ExpectedCandidate,
} from './__fixtures__/rosters.ts';
import { normaliseJudgeName, previewRosterImport, type RosterPreview } from './roster-import.ts';

function expectCandidates(preview: RosterPreview, expected: ExpectedCandidate[]): void {
  expect(
    preview.candidates.map((c) => ({
      hallNo: c.hallNo,
      judges: c.judges,
      portfolioText: c.portfolioText,
      pageNo: c.anchor.pageNo,
    })),
  ).toEqual(expected);
  for (const candidate of preview.candidates) {
    expect(RosterCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(candidate.confidence).toBeGreaterThan(0);
    expect(candidate.confidence).toBeLessThanOrEqual(1);
    expect(candidate.anchor.quote).not.toBe('');
    expect(candidate.anchor.bbox).toBeDefined();
  }
}

describe('previewRosterImport', () => {
  it('reads a Madras-style "Sitting Arrangements wef" roster', async () => {
    const preview = await previewRosterImport(await madrasRosterPdf(), 'MHC');
    expect(preview.forumCode).toBe('MHC');
    expect(preview.effectiveFromRequired).toBe(false);
    expect(preview.effectiveFrom?.date).toBe('2026-10-05');
    expect(preview.effectiveFrom?.anchor.pageNo).toBe(1);
    expect(preview.effectiveFrom?.anchor.quote).toBe('SITTING ARRANGEMENTS wef 05.10.2026');
    expectCandidates(preview, MADRAS_EXPECTED);
    expect(preview.candidates[0]?.anchor.quote).toMatch(/^COURT HALL No\. 1 /);
    expect(preview.candidates.every((c) => c.confidence === 1)).toBe(true);
  });

  it('reads a Karnataka-style sitting list "with effect from", across pages', async () => {
    const preview = await previewRosterImport(await karnatakaRosterPdf(), 'KHC');
    expect(preview.effectiveFrom?.date).toBe('2026-10-12');
    expect(preview.effectiveFrom?.anchor.quote).toContain('with effect from 12.10.2026');
    expect(preview.effectiveFromRequired).toBe(false);
    expectCandidates(preview, KARNATAKA_EXPECTED);
  });

  it('reads a `w.e.f.` date', async () => {
    const pdf = await rosterPdf([
      [
        [{ x: 40, text: 'REVISED ROSTER W.E.F. 19-10-2026' }],
        [
          { x: 40, text: 'Court No. 5' },
          { x: 150, text: 'Hon. Justice A. Venpa (fictional)' },
        ],
      ],
    ]);
    const preview = await previewRosterImport(pdf, 'MHC');
    expect(preview.effectiveFrom?.date).toBe('2026-10-19');
    expect(preview.candidates).toEqual([
      expect.objectContaining({
        hallNo: '5',
        judges: ['Justice A. Venpa (fictional)'],
        portfolioText: '',
        confidence: 0.8,
      }),
    ]);
  });

  it('asks the lawyer for the date when the roster prints none', async () => {
    const pdf = await rosterPdf([
      [
        [{ x: 40, text: 'SITTING ARRANGEMENTS (DATE TO FOLLOW)' }],
        [
          { x: 40, text: 'COURT HALL No. 3' },
          { x: 150, text: "HON'BLE MS.JUSTICE P. KABINI (fictional)" },
          { x: 400, text: 'Bail Applications' },
        ],
      ],
    ]);
    const preview = await previewRosterImport(pdf, 'MHC');
    expect(preview.effectiveFrom).toBeNull();
    expect(preview.effectiveFromRequired).toBe(true);
    expect(preview.candidates.map((c) => c.hallNo)).toEqual(['3']);
  });

  it('rejects a blank forum code', async () => {
    await expect(previewRosterImport(await madrasRosterPdf(), '  ')).rejects.toThrow(TypeError);
  });

  it('persists nothing: the module reaches no database, storage, notification or AI code', () => {
    const source = readFileSync(new URL('./roster-import.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      '@causedeck/adapters',
      '@causedeck/validators/matter-graph',
      '@causedeck/validators/roster',
    ]);
    // A preview takes bytes and a forum code only: no workspace, transaction or db handle.
    expect(previewRosterImport.length).toBe(2);
  });
});

describe('normaliseJudgeName', () => {
  it('collapses three printed spellings into one bench.judges entry, keeping each raw', () => {
    const spellings = [
      "Hon'ble Mr. Justice A.B. Venpa",
      "HON'BLE MR.JUSTICE A. B.  Venpa",
      'Hon. Justice A. B. Venpa',
    ];
    const normalised = spellings.map(normaliseJudgeName);
    expect(new Set(normalised.map((n) => n.name))).toEqual(new Set(['Justice A.B. Venpa']));
    expect(normalised.map((n) => n.raw)).toEqual(spellings);
  });

  it('strips Ms., Mrs., Dr. and curly-apostrophe honorifics and canonicalises Justice', () => {
    expect(normaliseJudgeName('Hon’ble Ms. Justice P. Kabini').name).toBe('Justice P. Kabini');
    expect(normaliseJudgeName('Hon’ble Dr.JUSTICE  H.Nethravathi').name).toBe(
      'Justice H. Nethravathi',
    );
    expect(normaliseJudgeName('The Hon’ble Mrs. justice M. Sharavathi').name).toBe(
      'Justice M. Sharavathi',
    );
  });

  it('keeps Chief Justice as printed and drops a trailing ", J."', () => {
    expect(normaliseJudgeName("The Hon'ble The Chief Justice K. Marudham").name).toBe(
      'Chief Justice K. Marudham',
    );
    expect(normaliseJudgeName('Hon. Acting Chief Justice T. Neithal').name).toBe(
      'Acting Chief Justice T. Neithal',
    );
    expect(normaliseJudgeName('A. Venpa, J.').name).toBe('A. Venpa');
  });
});
