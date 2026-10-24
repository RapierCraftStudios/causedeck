import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  CATEGORY_KEYS,
  CHANNELS,
  isCategoryKey,
  isLockedChannel,
} from '../categories.ts';

describe('category registry', () => {
  it('has exactly the specified categories', () => {
    expect([...CATEGORY_KEYS].sort()).toEqual(
      [
        'billing.notice',
        'court.board',
        'digest.daily',
        'digest.end_of_day',
        'digest.news',
        'judgment.alert',
        'member.joined',
        'notices',
        'proposal.new',
        'reminder.hearing',
        'security.alert',
        'status.next_date',
        'status.order',
        'status.stage',
        'system.notice',
        'workspace.invite',
      ].sort(),
    );
  });

  it('makes security.alert mandatory with in-app and email locked', () => {
    expect(CATEGORIES['security.alert'].mandatory).toBe(true);
    expect(isLockedChannel('security.alert', 'in_app')).toBe(true);
    expect(isLockedChannel('security.alert', 'email')).toBe(true);
    expect(isLockedChannel('security.alert', 'push')).toBe(false);
    for (const key of CATEGORY_KEYS.filter((k) => k !== 'security.alert')) {
      expect(CATEGORIES[key].mandatory, key).toBe(false);
      expect(CATEGORIES[key].lockedChannels, key).toEqual([]);
    }
  });

  it('uses known channels; locked channels are on by default', () => {
    for (const key of CATEGORY_KEYS) {
      const def = CATEGORIES[key];
      expect(def.defaultChannels.length, key).toBeGreaterThan(0);
      for (const c of [...def.defaultChannels, ...def.lockedChannels])
        expect(CHANNELS).toContain(c);
      for (const c of def.lockedChannels)
        expect(def.defaultChannels as readonly string[]).toContain(c);
    }
  });

  it('recognises category keys only', () => {
    expect(isCategoryKey('security.alert')).toBe(true);
    expect(isCategoryKey('toString')).toBe(false);
    expect(isCategoryKey('client.update')).toBe(false);
    expect(isCategoryKey(1)).toBe(false);
  });

  it('stays client-safe: no imports at all', () => {
    const source = readFileSync(new URL('../categories.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import /m);
  });
});
