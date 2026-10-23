import { ProposalDraftSchema } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import { must } from './fixtures.ts';

import type { DiaryEntry } from './schema.ts';
import {
  diaryToProposalDrafts,
  matchCaseRef,
  normaliseCaseRef,
  NOTE_CONFIDENCE_CAP,
  type DiaryDraftContext,
} from './to-proposals.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const anchor = {
  page: 1,
  bbox: [0.1, 0.1, 0.9, 0.2] as [number, number, number, number],
  quote: 'q',
};

const ctx: DiaryDraftContext = {
  captureId: UUID_C,
  aiCallId: null,
  proceedings: [{ proceedingId: UUID_A, matterId: UUID_B, number: '123', year: 2026 }],
};

const entry = (over: Partial<DiaryEntry>): DiaryEntry => ({
  text: 'Arguments heard, next date 12 Oct 2026',
  kind: 'hearing_note',
  anchor,
  confidence: 0.95,
  ...over,
});

describe('normaliseCaseRef', () => {
  it('drops leading zeros, expands two-digit years and reads Indic digits', () => {
    expect(normaliseCaseRef('WP No. 0123 of 26')).toEqual({ number: '123', year: 2026 });
    expect(normaliseCaseRef('WP ௧௨௩/2026')).toEqual({ number: '123', year: 2026 });
    expect(normaliseCaseRef('no number here')).toBeNull();
  });
});

describe('matchCaseRef', () => {
  it('matches one proceeding, flags two, and reports none or unmatched', () => {
    expect(matchCaseRef('WP 123/2026', ctx.proceedings).kind).toBe('matched');
    expect(matchCaseRef('WP 999/2026', ctx.proceedings).kind).toBe('unmatched');
    expect(matchCaseRef(undefined, ctx.proceedings).kind).toBe('none');
    const twin = [...ctx.proceedings, { ...must(ctx.proceedings[0]), proceedingId: UUID_C }];
    expect(matchCaseRef('123/2026', twin).kind).toBe('ambiguous');
  });
});

describe('diaryToProposalDrafts', () => {
  it('proposes a next date and a capped note when the case number matches', () => {
    const drafts = diaryToProposalDrafts(
      {
        entries: [
          entry({
            caseRef: 'WP 123/2026',
            nextDate: { date: '2026-10-12', phrase: '12 Oct 2026', anchor },
          }),
        ],
      },
      ctx,
    );
    const nextDate = drafts.find((d) => d.kind === 'next_date');
    expect(nextDate?.payload).toEqual({ proceedingId: UUID_A, date: '2026-10-12' });
    expect(nextDate?.match).toEqual({ score: 1, exact: 'case_number' });
    const note = drafts.find((d) => d.kind === 'task');
    expect(note?.confidence).toBeLessThanOrEqual(NOTE_CONFIDENCE_CAP);
    expect(note?.matterId).toBe(UUID_B);
    for (const draft of drafts) expect(ProposalDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('never attaches to a matter without an identifier match', () => {
    const drafts = diaryToProposalDrafts(
      {
        entries: [
          entry({ caseRef: 'WP 999/2026', text: 'WP 999/2026 client wants a stay, file reply' }),
          entry({ kind: 'task', text: 'Call the clerk', confidence: 0.9 }),
          entry({ kind: 'hearing_note', text: 'No case number on this note' }),
        ],
      },
      ctx,
    );
    expect(drafts.map((d) => d.kind)).toEqual(['new_matter', 'task']);
    for (const draft of drafts) {
      expect(draft.matterId).toBeUndefined();
      expect(draft.proceedingId).toBeUndefined();
      expect(draft.payload['matterId']).toBeUndefined();
      expect(draft.payload['proceedingId']).toBeUndefined();
    }
    expect(drafts[1]?.payload['dueDate']).toBeUndefined();
    expect(drafts[1]?.confidence).toBe(0.9);
  });

  it('does not create a matter from a bare case reference', () => {
    expect(
      diaryToProposalDrafts(
        { entries: [entry({ caseRef: 'WP 999/2026', text: 'WP 999/2026' })] },
        ctx,
      ),
    ).toEqual([]);
  });

  it('makes an ambiguous reference a card attached to neither proceeding', () => {
    const twin = [...ctx.proceedings, { ...must(ctx.proceedings[0]), proceedingId: UUID_C }];
    const [draft] = diaryToProposalDrafts(
      { entries: [entry({ caseRef: '123/2026' })] },
      { ...ctx, proceedings: twin },
    );
    expect(draft?.ambiguous).toBe(true);
    expect(draft?.proceedingId).toBeUndefined();
  });

  it('carries stored anchor ids', () => {
    const [draft] = diaryToProposalDrafts(
      { entries: [entry({ kind: 'task' })] },
      { ...ctx, anchorIds: new Map([['1:0.1,0.1,0.9,0.2', UUID_A]]) },
    );
    expect(draft?.anchors).toEqual([UUID_A]);
  });
});
