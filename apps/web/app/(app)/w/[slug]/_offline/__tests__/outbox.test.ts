import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  getCanonicalNextDate: vi.fn(),
  proposeCourtDayNextDate: vi.fn(),
  setBriefNote: vi.fn(),
  markPrepared: vi.fn(),
  unmarkPrepared: vi.fn(),
  setCarryItem: vi.fn(),
}));
vi.mock('@causedeck/core/matter-graph', () => ({
  getCanonicalNextDate: core.getCanonicalNextDate,
  confirmNextDate: vi.fn(() => {
    throw new Error('a push must never confirm a date');
  }),
}));
vi.mock('@causedeck/core/court-day', () => ({
  proposeCourtDayNextDate: core.proposeCourtDayNextDate,
}));
vi.mock('@causedeck/core/briefs', () => ({
  setBriefNote: core.setBriefNote,
  markPrepared: core.markPrepared,
  unmarkPrepared: core.unmarkPrepared,
  setCarryItem: core.setCarryItem,
}));

import { applyOutbox } from '../outbox.ts';

const P = '00000000-0000-4000-8000-0000000000b1';
const L = '00000000-0000-4000-8000-000000000001';
const tx = { transaction: (fn: (sp: unknown) => unknown) => fn({}) };
const ctx = { tx, workspaceId: 'w', userId: 'u' } as unknown as Parameters<typeof applyOutbox>[1];
const nextDate = (key: string, expected: string | null) => ({
  key,
  kind: 'next_date',
  proceedingId: P,
  date: '2030-03-01',
  expectedCanonicalDate: expected,
});

beforeEach(() => {
  vi.clearAllMocks();
  core.getCanonicalNextDate.mockResolvedValue({ listDate: '2030-02-01' });
  core.proposeCourtDayNextDate.mockResolvedValue({ kind: 'conflict' });
});

describe('applyOutbox', () => {
  it('proposes a next date when the server value is the one the client saw', async () => {
    const [r] = await applyOutbox([nextDate('k1', '2030-02-01')], ctx);
    expect(r).toEqual({ key: 'k1', status: 'applied', outcome: 'conflict_card' });
    expect(core.proposeCourtDayNextDate).toHaveBeenCalledTimes(1);
  });

  it('returns a conflict with the server value when the canonical date changed', async () => {
    const [r] = await applyOutbox([nextDate('k1', '2030-01-15')], ctx);
    expect(r).toEqual({ key: 'k1', status: 'conflict', serverDate: '2030-02-01' });
    expect(core.proposeCourtDayNextDate).not.toHaveBeenCalled();
  });

  it('applies a repeated key once and answers duplicate (idempotent replay)', async () => {
    const item = { key: 'n1', kind: 'brief_note', listingId: L, note: 'x' };
    const results = await applyOutbox([item, item], ctx);
    expect(results.map((r) => r.status)).toEqual(['applied', 'duplicate']);
    expect(core.setBriefNote).toHaveBeenCalledTimes(1);
  });

  it('isolates a refused or malformed item from the rest', async () => {
    core.setBriefNote.mockRejectedValueOnce(
      Object.assign(new Error('no'), { name: 'BriefError', code: 'FORBIDDEN' }),
    );
    const results = await applyOutbox(
      [
        { key: 'a', kind: 'brief_note', listingId: L, note: 'x' },
        { key: 'b', kind: 'nope' },
        { key: 'c', kind: 'brief_prepared', listingId: L, prepared: false },
      ],
      ctx,
    );
    expect(results).toEqual([
      { key: 'a', status: 'rejected', code: 'FORBIDDEN' },
      { key: 'b', status: 'rejected', code: 'VALIDATION' },
      { key: 'c', status: 'applied' },
    ]);
    expect(core.unmarkPrepared).toHaveBeenCalledTimes(1);
  });
});
