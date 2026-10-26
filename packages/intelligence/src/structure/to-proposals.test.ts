import { ProposalDraftSchema } from '@causedeck/validators/proposal-draft';
import { describe, expect, it } from 'vitest';

import type { MatchResult } from './match-matter.ts';
import type { ValidatedHearing } from './schema.ts';
import { hearingToProposalDrafts } from './to-proposals.ts';

const CAPTURE = '11111111-1111-4111-8111-111111111111';
const MATTER = '22222222-2222-4222-8222-222222222222';
const PROCEEDING = '33333333-3333-4333-8333-333333333333';

const structured: ValidatedHearing = {
  outcome: { text: 'adjourned', span: { start: 0, end: 10 } },
  nextDate: { date: '2026-11-14', phrase: 'fourteenth of November', span: { start: 20, end: 42 } },
  directions: [
    {
      text: 'file counter',
      dueDate: '2026-11-06',
      dueExpression: 'after two weeks',
      span: { start: 50, end: 90 },
    },
    { text: 'produce records', span: { start: 91, end: 120 } },
  ],
  tasks: [{ title: 'call the client', span: { start: 121, end: 140 } }],
};

const anchorFor = (span: { start: number }): string =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(span.start).padStart(12, '0')}`;

const matched: MatchResult = {
  matched: {
    matterId: MATTER,
    proceedingId: PROCEEDING,
    score: 0.95,
    exact: 'case_number',
    contextAgrees: true,
    partyScore: 0,
  },
  candidates: [],
};
const ctx = {
  captureId: CAPTURE,
  hearingDate: '2026-10-23',
  structured,
  confidence: 0.85,
  anchorFor,
};

describe('hearingToProposalDrafts', () => {
  it('makes outcome, next date, dated obligation and task drafts, all valid and anchored', () => {
    const drafts = hearingToProposalDrafts({ ...ctx, match: matched });
    expect(drafts.map((d) => d.kind)).toEqual([
      'hearing_outcome',
      'next_date',
      'obligation_from_direction',
      'task',
    ]);
    for (const draft of drafts) {
      expect(ProposalDraftSchema.safeParse(draft).success, draft.kind).toBe(true);
      expect(draft.anchors?.length, draft.kind).toBeGreaterThan(0);
      expect(draft.source).toMatchObject({ type: 'ai', input: 'voice' });
      expect(draft.matterId).toBe(MATTER);
    }
    const next = drafts.find((d) => d.kind === 'next_date');
    expect(next?.payload).toEqual({ date: '2026-11-14', proceedingId: PROCEEDING });
    expect(drafts.find((d) => d.kind === 'task')?.payload).toEqual({ title: 'call the client' });
  });

  it('leaves an undated direction out of the obligations', () => {
    const drafts = hearingToProposalDrafts({ ...ctx, match: matched });
    expect(drafts.filter((d) => d.kind === 'obligation_from_direction')).toHaveLength(1);
  });

  it('marks drafts ambiguous and carries candidates when no matter was matched', () => {
    const match: MatchResult = {
      matched: null,
      candidates: [
        { matterId: MATTER, score: 0.6, exact: null, contextAgrees: false, partyScore: 1 },
      ],
    };
    const drafts = hearingToProposalDrafts({ ...ctx, match });
    expect(drafts.every((d) => d.ambiguous === true && d.matterId === undefined)).toBe(true);
    expect(drafts[0]?.payload['candidates']).toEqual([MATTER]);
    expect(drafts.every((d) => d.match === undefined)).toBe(true);
  });

  it('proposes nothing for a reading with no outcome, date, dated direction or task', () => {
    const drafts = hearingToProposalDrafts({
      ...ctx,
      match: matched,
      structured: { directions: [], tasks: [] },
    });
    expect(drafts).toEqual([]);
  });
});
