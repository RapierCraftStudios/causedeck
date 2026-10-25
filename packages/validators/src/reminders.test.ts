import { describe, expect, it } from 'vitest';

import { ReminderPayload, ReminderPrefs } from './reminders';

const channels = { in_app: true, push: true, email: false };
const prefs = {
  evening: { enabled: true, time: '20:00', channels },
  morning: { enabled: true, time: '07:00', channels },
  outcome_missing: { enabled: false, delayMinutes: 90, channels },
};

describe('reminder schemas', () => {
  it('accepts the defaults', () => {
    expect(ReminderPrefs.parse(prefs)).toEqual(prefs);
  });

  it('keeps the evening time inside 18:00-23:00 on the half hour', () => {
    const at = (time: string) =>
      ReminderPrefs.safeParse({ ...prefs, evening: { ...prefs.evening, time } }).success;
    expect(at('18:00')).toBe(true);
    expect(at('22:30')).toBe(true);
    expect(at('23:00')).toBe(true);
    expect(at('17:30')).toBe(false);
    expect(at('23:30')).toBe(false);
    expect(at('20:15')).toBe(false);
  });

  it('fixes the morning time and bounds the outcome delay', () => {
    expect(
      ReminderPrefs.safeParse({ ...prefs, morning: { ...prefs.morning, time: '08:00' } }).success,
    ).toBe(false);
    const delay = (delayMinutes: number) =>
      ReminderPrefs.safeParse({
        ...prefs,
        outcome_missing: { ...prefs.outcome_missing, delayMinutes },
      }).success;
    expect(delay(15)).toBe(true);
    expect(delay(5)).toBe(false);
    expect(delay(361)).toBe(false);
    expect(delay(90.5)).toBe(false);
  });

  it('rejects unknown keys, so a preference can never name a user', () => {
    expect(ReminderPrefs.safeParse({ ...prefs, userId: 'x' }).success).toBe(false);
    expect(
      ReminderPrefs.safeParse({ ...prefs, evening: { ...prefs.evening, extra: 1 } }).success,
    ).toBe(false);
  });

  it('validates the job payload', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(ReminderPayload.parse({ workspaceId: id, memberId: id, date: '2026-10-26' }));
    expect(ReminderPayload.safeParse({ workspaceId: id, memberId: id, date: 'x' }).success).toBe(
      false,
    );
    expect(ReminderPayload.safeParse({ workspaceId: id, memberId: 'x', date: '2026-10-26' }).success).toBe(false);
  });
});
