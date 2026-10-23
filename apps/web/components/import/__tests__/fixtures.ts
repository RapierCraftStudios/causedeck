// A plan with a conflicting-dates matter, a low-confidence matter and a quiet one (#551).
import type { ImportPlan, PlanProceeding } from '@causedeck/core/import';

const src = (id: string) => ({ proposalId: id, captureId: null, kind: 'next_date', anchorIds: [] });

export function proceeding(key: string, over: Partial<PlanProceeding> = {}): PlanProceeding {
  return {
    key,
    label: `W.P. ${key}/2026`,
    caseType: 'WP',
    caseNumber: key,
    caseYear: 2026,
    forumCode: 'in.tn.madras-hc',
    cnr: null,
    parentKey: null,
    parties: null,
    stage: 'Admission',
    nextDate: null,
    nextDateCandidates: [],
    sources: [src(`p-${key}`)],
    ...over,
  };
}

export const PLAN: ImportPlan = {
  version: 1,
  today: '2026-10-01',
  matters: [
    {
      tempId: 'm_late',
      title: 'Late v State',
      proceedings: [proceeding('1', { nextDate: { date: '2026-12-01', sources: [src('d1')] } })],
      nextDate: { date: '2026-12-01', sources: [src('d1')] },
      issues: [],
      confidence: 0.9,
      reason: 'single proceeding',
      sources: [src('p-1')],
    },
    {
      tempId: 'm_conflict',
      title: 'Clash v State',
      proceedings: [
        proceeding('2', {
          nextDateCandidates: [
            { date: '2026-11-03', sources: [src('d2')] },
            { date: '2026-11-17', sources: [src('d3')] },
          ],
        }),
        proceeding('3', { caseNumber: null, label: null, stage: 'SR' }),
      ],
      nextDate: null,
      issues: [
        {
          code: 'conflicting_dates',
          blocking: true,
          proceedingKey: '2',
          dates: ['2026-11-03', '2026-11-17'],
        },
      ],
      confidence: 0.8,
      reason: 'main petition with child proceedings',
      sources: [src('p-2'), src('p-3')],
    },
    {
      tempId: 'm_early',
      title: 'Early v State',
      proceedings: [proceeding('4', { nextDate: { date: '2026-10-20', sources: [src('d4')] } })],
      nextDate: { date: '2026-10-20', sources: [src('d4')] },
      issues: [{ code: 'low_confidence', blocking: false }],
      confidence: 0.5,
      reason: 'single proceeding',
      sources: [src('p-4')],
    },
  ],
  history: [],
  obligations: [],
  counts: { matchedRows: 4, unmatchedRowsCount: 0 },
};
