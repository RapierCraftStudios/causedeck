import { describe, expect, it } from 'vitest';

import {
  AssignInput,
  BulkReassignInput,
  DelegationView,
  Suggestion,
  UnassignInput,
} from './delegation';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

describe('delegation schemas', () => {
  it('needs a known capacity and rejects unknown keys', () => {
    expect(AssignInput.parse({ listingId: a, memberId: b, capacity: 'arguing' }).capacity).toBe(
      'arguing',
    );
    expect(AssignInput.safeParse({ listingId: a, memberId: b, capacity: 'boss' }).success).toBe(
      false,
    );
    expect(
      AssignInput.safeParse({ listingId: a, memberId: b, capacity: 'proxy', extra: 1 }).success,
    ).toBe(false);
  });

  it('trims the note and caps it at 500 characters', () => {
    const base = { listingId: a, memberId: b, capacity: 'aor' } as const;
    expect(AssignInput.parse({ ...base, note: '  bring the vakalat  ' }).note).toBe(
      'bring the vakalat',
    );
    expect(AssignInput.safeParse({ ...base, note: 'x'.repeat(501) }).success).toBe(false);
  });

  it('takes ids as uuids and dates as ISO days', () => {
    expect(UnassignInput.safeParse({ appearanceId: 'nope' }).success).toBe(false);
    expect(BulkReassignInput.safeParse({ fromMemberId: a, toMemberId: b }).success).toBe(true);
    expect(
      BulkReassignInput.safeParse({ fromMemberId: a, toMemberId: b, fromDate: '02/11/2026' })
        .success,
    ).toBe(false);
  });

  it('keeps a suggestion to one short line with a known kind', () => {
    const ok = { listingId: a, memberId: b, capacity: 'arguing', kind: 'hall_clash', reason: 'r' };
    expect(Suggestion.safeParse(ok).success).toBe(true);
    expect(Suggestion.safeParse({ ...ok, kind: 'random' }).success).toBe(false);
    expect(Suggestion.safeParse({ ...ok, reason: '' }).success).toBe(false);
  });

  it('parses an empty view', () => {
    expect(DelegationView.parse({ date: '2026-11-02', appearances: [] }).appearances).toEqual([]);
  });
});
