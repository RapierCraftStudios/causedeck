import { describe, expect, it } from 'vitest';

import { AttentionQuery, Snooze, StaleDaysInput } from './attention.ts';

const matterId = '3f0c1c52-6a56-4b6e-9d7e-2f4f6c0a1b11';

describe('attention validators', () => {
  it('bounds the stale threshold to 7..180', () => {
    expect(StaleDaysInput.safeParse({ days: 6 }).success).toBe(false);
    expect(StaleDaysInput.safeParse({ days: 181 }).success).toBe(false);
    expect(StaleDaysInput.safeParse({ days: 30 }).success).toBe(true);
  });
  it('requires a reason and date to snooze, and rejects unknown keys', () => {
    expect(
      Snooze.safeParse({ kind: 'snooze', matterId, rule: null, until: '2099-01-01', reason: 'x' })
        .success,
    ).toBe(true);
    expect(
      Snooze.safeParse({ kind: 'snooze', matterId, rule: null, until: '2099-01-01' }).success,
    ).toBe(false);
    expect(Snooze.safeParse({ kind: 'dismiss', matterId, rule: null }).success).toBe(true);
    expect(AttentionQuery.safeParse({ extra: 1 }).success).toBe(false);
  });
});
