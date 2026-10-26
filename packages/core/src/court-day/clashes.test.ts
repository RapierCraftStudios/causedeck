import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { detectClashes, type ClashCandidate } from './clashes.ts';

const member = randomUUID();
const other = randomUUID();
const complexA = randomUUID();
const complexB = randomUUID();
const hall1 = randomUUID();
const hall2 = randomUUID();

const item = (over: Partial<ClashCandidate> = {}): ClashCandidate => ({
  listingId: randomUUID(),
  proceedingId: randomUUID(),
  forumId: complexA,
  hallId: hall1,
  itemNo: '1',
  listDate: '2026-11-02',
  memberIds: [member],
  ...over,
});

describe('detectClashes (R4)', () => {
  it('flags the same member on the same date in different halls, with both items', () => {
    const a = item({ itemNo: '4' });
    const b = item({ hallId: hall2, itemNo: '9' });
    const clashes = detectClashes([a, b]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]?.kind).toBe('hall');
    expect(clashes[0]?.memberId).toBe(member);
    expect(clashes[0]?.items.map((i) => i.listingId).sort()).toEqual(
      [a.listingId, b.listingId].sort(),
    );
  });

  it('flags different complexes as a complex clash', () => {
    const clashes = detectClashes([item(), item({ forumId: complexB, hallId: randomUUID() })]);
    expect(clashes.map((c) => c.kind)).toEqual(['complex']);
  });

  it('never flags several items in the same hall', () => {
    expect(detectClashes([item(), item({ itemNo: '2' }), item({ itemNo: '3' })])).toEqual([]);
  });

  it('ignores other dates, other members and a single listing', () => {
    expect(detectClashes([item(), item({ hallId: hall2, listDate: '2026-11-03' })])).toEqual([]);
    expect(detectClashes([item(), item({ hallId: hall2, memberIds: [other] })])).toEqual([]);
    expect(detectClashes([item()])).toEqual([]);
  });

  it('reports one clash per member who appears in both', () => {
    const clashes = detectClashes([
      item({ memberIds: [member, other] }),
      item({ hallId: hall2, memberIds: [other, member] }),
    ]);
    expect(clashes.map((c) => c.memberId).sort()).toEqual([member, other].sort());
  });
});

describe('detectClashes never predicts a time overlap (R5)', () => {
  it('carries only the factual statement: same date, different hall', () => {
    const [clash] = detectClashes([item(), item({ hallId: hall2 })]);
    expect(clash?.statement).toBe('Listed on the same date in different halls.');
    expect(Object.keys(clash ?? {}).sort()).toEqual([
      'date',
      'items',
      'kind',
      'memberId',
      'statement',
    ]);
    const text = JSON.stringify(clash).toLowerCase();
    for (const word of ['overlap', 'predict', 'estimate', 'minute', 'time']) {
      expect(text).not.toContain(word);
    }
  });
});
