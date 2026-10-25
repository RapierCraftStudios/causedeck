// Notification copy (#198): every bell and panel string is a key in `en` with ta/kn stubs, the
// designed copy is in place, and the tone stays calm (no exclamation marks).
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';

function keys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    keys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('notifications messages', () => {
  it('has the same keys in en, ta and kn', () => {
    const en = keys(catalogs.en.notifications).sort();
    expect(en.length).toBeGreaterThan(10);
    expect(keys(catalogs.ta.notifications).sort()).toEqual(en);
    expect(keys(catalogs.kn.notifications).sort()).toEqual(en);
  });

  it('carries the designed copy', () => {
    const t = createTranslator({ locale: 'en', messages: catalogs.en, namespace: 'notifications' });
    expect(t('bell.labelUnread', { count: 3 })).toBe('Notifications, 3 unread');
    expect(t('empty')).toBe('You are all caught up.');
    expect(t('error')).toBe('Could not load notifications.');
    expect(t('retry')).toBe('Try again');
    expect(t('offline')).toBe('Showing saved notifications');
    expect(t('markAllRead')).toBe('Mark all read');
    expect(t('groups.today')).toBe('Today');
    expect(t('groups.earlier')).toBe('Earlier');
    expect(t('announce', { count: 1 })).toBe('1 new notification');
    expect(t('announce', { count: 2 })).toBe('2 new notifications');
  });

  it('keeps the copy calm: no exclamation marks in any locale', () => {
    for (const locale of ['en', 'ta', 'kn'] as const) {
      expect(JSON.stringify(catalogs[locale].notifications)).not.toContain('!');
    }
  });
});
