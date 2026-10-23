// Plan edits (#551): regrouping the stored proceedings into matters recomputes everything derived,
// refuses a proceeding that is dropped, duplicated or unknown, and keeps history on its proceeding.
import { describe, expect, it } from 'vitest';

import { regroupPlan } from '../plan-edit.ts';
import type { ImportPlan, PlanProceeding } from '../plan-types.ts';

const src = (id: string) => ({ proposalId: id, captureId: null, kind: 'next_date', anchorIds: [] });

function proceeding(key: string, over: Partial<PlanProceeding> = {}): PlanProceeding {
  return {
    key,
    label: key,
    caseType: null,
    caseNumber: null,
    caseYear: null,
    forumCode: null,
    cnr: null,
    parentKey: null,
    parties: null,
    stage: null,
    nextDate: null,
    nextDateCandidates: [],
    sources: [src(`p-${key}`)],
    ...over,
  };
}

const plan: ImportPlan = {
  version: 1,
  today: '2026-10-01',
  matters: [
    {
      tempId: 'm_a',
      title: 'A v B',
      proceedings: [
        proceeding('k1', { nextDate: { date: '2026-11-05', sources: [src('d1')] } }),
        proceeding('k2', {
          nextDateCandidates: [
            { date: '2026-11-01', sources: [src('d2')] },
            { date: '2026-11-09', sources: [src('d3')] },
          ],
        }),
      ],
      nextDate: { date: '2026-11-05', sources: [src('d1')] },
      issues: [{ code: 'conflicting_dates', blocking: true, proceedingKey: 'k2', dates: [] }],
      confidence: 0.9,
      reason: 'main petition with child proceedings',
      sources: [],
    },
    {
      tempId: 'm_b',
      title: 'C v D',
      proceedings: [proceeding('k3')],
      nextDate: null,
      issues: [{ code: 'low_confidence', blocking: false }],
      confidence: 0.5,
      reason: 'single proceeding',
      sources: [],
    },
  ],
  history: [{ matterTempId: 'm_a', proceedingKey: 'k2', date: '2026-01-01', sources: [] }],
  obligations: [],
  counts: { matchedRows: 3, unmatchedRowsCount: 0 },
};

const group = (tempId: string, title: string, proceedingKeys: string[]) => ({
  tempId,
  title,
  proceedingKeys,
});

describe('regroupPlan', () => {
  it('renames without changing anything derived', () => {
    const out = regroupPlan(plan, [
      group('m_a', ' Renamed ', ['k1', 'k2']),
      group('m_b', 'C v D', ['k3']),
    ]);
    expect(out.matters[0]?.title).toBe('Renamed');
    expect(out.matters[0]?.nextDate?.date).toBe('2026-11-05');
    expect(out.matters[0]?.issues.map((i) => i.code)).toEqual(['conflicting_dates']);
    expect(out.matters[0]?.reason).toBe('main petition with child proceedings');
  });

  it('splits a proceeding out: new identity, history follows, conflict stays with k2', () => {
    const out = regroupPlan(plan, [
      group('m_a', 'A v B', ['k1']),
      group('new', 'Split', ['k2']),
      group('m_b', 'C v D', ['k3']),
    ]);
    const split = out.matters[1];
    expect(split?.tempId).toMatch(/^m_[0-9a-f]{12}$/);
    expect(split?.issues.some((i) => i.blocking)).toBe(true);
    expect(out.matters[0]?.issues).toEqual([]);
    expect(out.history[0]?.matterTempId).toBe(split?.tempId);
  });

  it('merges two matters: weakest confidence, low-confidence flag and earliest date win', () => {
    const out = regroupPlan(plan, [group('m_a', 'Both', ['k1', 'k2', 'k3'])]);
    expect(out.matters).toHaveLength(1);
    expect(out.matters[0]?.confidence).toBe(0.5);
    expect(out.matters[0]?.issues.map((i) => i.code)).toEqual([
      'conflicting_dates',
      'low_confidence',
    ]);
    expect(out.matters[0]?.reason).toBe('grouped by you');
  });

  it('refuses a dropped, duplicated or unknown proceeding and an empty title', () => {
    expect(() => regroupPlan(plan, [group('m_a', 'A', ['k1', 'k2'])])).toThrow();
    expect(() =>
      regroupPlan(plan, [group('m_a', 'A', ['k1', 'k2', 'k3']), group('x', 'B', ['k3'])]),
    ).toThrow();
    expect(() => regroupPlan(plan, [group('m_a', 'A', ['k1', 'k2', 'k3', 'zz'])])).toThrow();
    expect(() =>
      regroupPlan(plan, [group('m_a', '  ', ['k1', 'k2']), group('m_b', 'C', ['k3'])]),
    ).toThrow();
  });
});
