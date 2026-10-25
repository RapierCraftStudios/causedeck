// `groupInbox` (#48): what lands in Needs you, Processing and the counts. Pure: no database.
import { describe, expect, it } from 'vitest';

import { groupInbox, type InboxFacts } from './read-models.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const MATTER = '00000000-0000-4000-8000-000000000001';
const SECRET = '00000000-0000-4000-8000-000000000002';
const PROCEEDING = '00000000-0000-4000-8000-000000000003';
const ANCHOR = '00000000-0000-4000-8000-000000000004';
const CAPTURE = '00000000-0000-4000-8000-000000000005';

function facts(partial: Partial<InboxFacts> = {}): InboxFacts {
  return {
    now: NOW,
    proposals: [],
    captures: [],
    matters: new Map([
      [MATTER, { title: 'Fictional v. Example', sensitive: false }],
      [SECRET, { title: 'Sealed matter', sensitive: true }],
    ]),
    caseNumbers: new Map([[PROCEEDING, 'W.P. 12345 of 2026']]),
    anchors: new Map([
      [
        ANCHOR,
        { id: ANCHOR, documentId: 'd', page: 2, quote: 'List on 12.11.2026', highlight: null },
      ],
    ]),
    currentDates: new Map([['cur', '2026-10-30']]),
    undoUntil: new Map(),
    withOpenProposal: new Set(),
    canWrite: true,
    canStrategy: true,
    ...partial,
  };
}

function proposal(id: string, extra: Partial<InboxFacts['proposals'][number]> = {}) {
  return {
    id,
    kind: 'next_date',
    captureId: null,
    matterId: MATTER,
    proceedingId: PROCEEDING,
    payload: { date: '2026-11-12' },
    anchors: [ANCHOR],
    confidence: '0.930',
    needsYouReason: null,
    entityRefs: {},
    createdAt: new Date('2026-11-01T09:00:00Z'),
    ...extra,
  };
}

describe('groupInbox', () => {
  it('puts open proposals in Needs you with matter, case number and source', () => {
    const inbox = groupInbox(facts({ proposals: [proposal('p1')] }));
    expect(inbox.counts).toEqual({ needsYou: 1, ready: 0, processing: 0 });
    const [item] = inbox.needsYou;
    expect(item).toMatchObject({
      type: 'proposal',
      matterTitle: 'Fictional v. Example',
      caseNumber: 'W.P. 12345 of 2026',
      confidence: 0.93,
    });
    expect(item?.anchors[0]?.page).toBe(2);
  });

  it('turns a next-date proposal that disagrees with the confirmed date into a conflict', () => {
    const inbox = groupInbox(
      facts({
        proposals: [proposal('p1', { entityRefs: { conflict: true, currentListingId: 'cur' } })],
      }),
    );
    expect(inbox.needsYou[0]).toMatchObject({ type: 'conflict', currentDate: '2026-10-30' });
  });

  it('splits captures: in flight is Processing, a captured-but-unread one needs you', () => {
    const base = { channel: 'upload', matterHintId: null, createdAt: NOW };
    const inbox = groupInbox(
      facts({
        captures: [
          { id: 'c1', status: 'queued', ...base },
          { id: 'c2', status: 'processing', ...base },
          { id: 'c3', status: 'needs_you', ...base },
          { id: 'c4', status: 'failed', ...base },
        ],
      }),
    );
    expect(inbox.processing.map((row) => row.captureId)).toEqual(['c1', 'c2']);
    expect(inbox.needsYou.map((row) => [row.captureId, row.canKeep])).toEqual(
      expect.arrayContaining([
        ['c3', true],
        ['c4', false],
      ]),
    );
    expect(inbox.needsYou.every((row) => row.type === 'unreadable')).toBe(true);
  });

  it('does not list a capture as unreadable while a proposal from it waits', () => {
    const inbox = groupInbox(
      facts({
        proposals: [proposal('p1', { captureId: CAPTURE })],
        captures: [
          {
            id: CAPTURE,
            status: 'needs_you',
            channel: 'share',
            matterHintId: null,
            createdAt: NOW,
          },
        ],
        withOpenProposal: new Set([CAPTURE]),
      }),
    );
    expect(inbox.needsYou.map((row) => row.type)).toEqual(['proposal']);
  });

  it('withholds the content of a sensitive matter and hides unreadable matters', () => {
    const hidden = '00000000-0000-4000-8000-0000000000ff';
    const inbox = groupInbox(
      facts({
        proposals: [proposal('p1', { matterId: SECRET }), proposal('p2', { matterId: hidden })],
      }),
    );
    expect(inbox.needsYou).toHaveLength(1);
    expect(inbox.needsYou[0]).toMatchObject({ sensitive: true, payload: null, anchors: [] });
  });

  it('hides memory proposals from members without strategy.read', () => {
    const rows = [proposal('p1', { kind: 'memory_item' }), proposal('p2')];
    expect(groupInbox(facts({ proposals: rows, canStrategy: false })).needsYou).toHaveLength(1);
    expect(groupInbox(facts({ proposals: rows })).needsYou).toHaveLength(2);
  });

  it('offers wrong-match recovery only while the 7-day window is open', () => {
    const open = proposal('p1', { captureId: CAPTURE });
    const until = new Date(NOW.getTime() + 3600_000);
    expect(
      groupInbox(facts({ proposals: [open], undoUntil: new Map([[CAPTURE, until]]) })).needsYou[0]
        ?.reassignUntil,
    ).toEqual(until);
    const late = new Date(NOW.getTime() - 1000);
    expect(
      groupInbox(facts({ proposals: [open], undoUntil: new Map([[CAPTURE, late]]) })).needsYou[0]
        ?.reassignUntil,
    ).toBeNull();
  });

  it('marks a viewer read-only', () => {
    expect(groupInbox(facts({ canWrite: false })).canAct).toBe(false);
  });
});
