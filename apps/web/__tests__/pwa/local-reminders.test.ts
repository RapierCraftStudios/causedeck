import { describe, expect, it, vi } from 'vitest';

import {
  MAX_LOCAL_REMINDERS,
  parseReminders,
  scheduleLocalReminders,
  supportsTriggers,
} from '../../sw/local-reminders.ts';

class FakeTrigger {
  constructor(readonly timestamp: number) {}
}
const supported = {
  TimestampTrigger: FakeTrigger,
  Notification: { prototype: { showTrigger: null } },
};
const NOW = 1_000;

function registration(pending: { close: () => void }[] = []) {
  return {
    showNotification: vi.fn(() => Promise.resolve()),
    getNotifications: vi.fn((filter?: { tag?: string }) =>
      Promise.resolve(filter?.tag === 't1' ? pending : []),
    ),
  };
}

describe('supportsTriggers', () => {
  it('needs both TimestampTrigger and Notification.prototype.showTrigger', () => {
    expect(supportsTriggers(supported)).toBe(true);
    expect(supportsTriggers({})).toBe(false);
    expect(supportsTriggers({ TimestampTrigger: FakeTrigger })).toBe(false);
    expect(supportsTriggers({ ...supported, Notification: { prototype: {} } })).toBe(false);
  });
});

describe('parseReminders', () => {
  const ok = { tag: 'reminder-evening', title: 'Tomorrow', href: '/w/x/tomorrow', fireAt: 5_000 };

  it('keeps valid reminders and drops malformed or off-origin ones', () => {
    const parsed = parseReminders([
      ok,
      { ...ok, body: '3 listings' },
      { ...ok, href: 'https://evil.test/' },
      { ...ok, href: '//evil.test/' },
      { ...ok, tag: '' },
      { ...ok, title: 1 },
      { ...ok, fireAt: Number.NaN },
      null,
      'x',
    ]);
    expect(parsed).toEqual([ok, { ...ok, body: '3 listings' }]);
  });

  it('returns nothing for a non-array and caps the batch', () => {
    expect(parseReminders({})).toEqual([]);
    expect(parseReminders(Array.from({ length: 50 }, () => ok))).toHaveLength(MAX_LOCAL_REMINDERS);
  });
});

describe('scheduleLocalReminders', () => {
  const reminder = {
    tag: 't1',
    title: 'Tomorrow',
    body: 'b',
    href: '/w/x/tomorrow',
    fireAt: 5_000,
  };

  it('schedules a future reminder with a timestamp trigger and the push tag', async () => {
    const reg = registration();
    expect(await scheduleLocalReminders(reg, [reminder], NOW, supported)).toBe(1);
    const [title, options] = reg.showNotification.mock.calls[0] as unknown as [
      string,
      { tag: string; body: string; data: { href: string }; showTrigger: FakeTrigger },
    ];
    expect(title).toBe('Tomorrow');
    expect(options.tag).toBe('t1');
    expect(options.data).toEqual({ href: '/w/x/tomorrow' });
    expect(options.showTrigger.timestamp).toBe(5_000);
  });

  it('closes a pending notification of the same tag and skips past times', async () => {
    const close = vi.fn();
    const reg = registration([{ close }]);
    const n = await scheduleLocalReminders(
      reg,
      [reminder, { ...reminder, tag: 't2', fireAt: NOW - 1 }],
      NOW,
      supported,
    );
    expect(n).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(reg.getNotifications).toHaveBeenCalledWith({ tag: 't1', includeTriggered: true });
  });

  it('is a no-op when triggers are unsupported (push stays the path)', async () => {
    const reg = registration();
    expect(await scheduleLocalReminders(reg, [reminder], NOW, {})).toBe(0);
    expect(reg.showNotification).not.toHaveBeenCalled();
  });
});
