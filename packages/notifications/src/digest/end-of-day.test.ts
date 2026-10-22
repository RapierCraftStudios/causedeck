// The end-of-day digest (#49): the payload builder (counts only unless names are on, links only open
// the app, nothing for an empty day), the schedule maths in `Asia/Kolkata`, and the email preview in
// en, ta and kn, light and dark, with no action link and no document content.
import { describe, expect, it } from 'vitest';

import { renderEmail } from '../email/render.ts';
import { buildEndOfDayDigest } from './end-of-day.ts';
import {
  DEFAULT_END_OF_DAY_TIME,
  endOfDaySlot,
  isEndOfDayTime,
  localDateOf,
  localDayBounds,
} from './schedule.ts';

const USER = '00000000-0000-4000-8000-0000000000a1';
const base = { localDate: '2026-10-20', userId: USER, workspaceSlug: 'chennai-solo' } as const;

describe('buildEndOfDayDigest', () => {
  it('sends nothing for a day with no activity and nothing pending', () => {
    expect(
      buildEndOfDayDigest({ ...base, l3Count: 0, pendingL2Count: 0, includeNames: false }),
    ).toBeNull();
  });

  it('carries counts and app links only, with no names by default', () => {
    const digest = buildEndOfDayDigest({
      ...base,
      l3Count: 4,
      pendingL2Count: 1,
      includeNames: false,
      matterTitles: ['Ilango v. State'],
    });
    expect(digest).toEqual({
      localDate: '2026-10-20',
      userId: USER,
      l3Count: 4,
      pendingL2Count: 1,
      links: {
        activity: '/w/chennai-solo/activity?day=2026-10-20',
        inbox: '/w/chennai-solo/inbox',
      },
    });
  });

  it('adds matter titles only when the member opted in, at most five', () => {
    const titles = ['a', 'b', 'c', 'd', 'e', 'f'];
    const digest = buildEndOfDayDigest({
      ...base,
      l3Count: 6,
      pendingL2Count: 0,
      includeNames: true,
      matterTitles: titles,
    });
    expect(digest?.matterTitles).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('still sends when only proposals are waiting', () => {
    const digest = buildEndOfDayDigest({
      ...base,
      l3Count: 0,
      pendingL2Count: 3,
      includeNames: false,
    });
    expect(digest).toMatchObject({ l3Count: 0, pendingL2Count: 3 });
  });

  it('links only to app paths, never to an action that changes something', () => {
    const digest = buildEndOfDayDigest({
      ...base,
      l3Count: 1,
      pendingL2Count: 1,
      includeNames: false,
    });
    for (const link of Object.values(digest?.links ?? {})) {
      expect(link).toMatch(/^\/w\/[^/]+\/(activity\?day=\d{4}-\d{2}-\d{2}|inbox)$/);
      expect(link).not.toMatch(/undo|accept|dismiss|confirm|send/i);
    }
  });
});

describe('end-of-day schedule', () => {
  it('defaults to 20:30 and accepts only :00 or :30 between 18:00 and 23:00', () => {
    expect(DEFAULT_END_OF_DAY_TIME).toBe('20:30');
    for (const ok of ['18:00', '18:30', '20:30', '23:00'])
      expect(isEndOfDayTime(ok), ok).toBe(true);
    for (const bad of ['17:30', '23:30', '20:15', '8:30', '20:30:00', '24:00', ''])
      expect(isEndOfDayTime(bad), bad).toBe(false);
  });

  it('finds the slot and the local day in Asia/Kolkata', () => {
    // 15:00 UTC is 20:30 IST on the same day; 18:40 UTC is 00:10 IST the next day (no slot).
    expect(endOfDaySlot(new Date('2026-10-20T15:00:00Z'))).toEqual({
      localDate: '2026-10-20',
      slot: '20:30',
    });
    expect(endOfDaySlot(new Date('2026-10-20T15:10:00Z'))?.slot).toBe('20:30');
    expect(endOfDaySlot(new Date('2026-10-20T12:30:00Z'))?.slot).toBe('18:00');
    expect(endOfDaySlot(new Date('2026-10-20T12:29:00Z'))).toBeNull();
    expect(endOfDaySlot(new Date('2026-10-20T17:30:00Z'))?.slot).toBe('23:00');
    expect(endOfDaySlot(new Date('2026-10-20T18:00:00Z'))).toBeNull();
    expect(localDateOf(new Date('2026-10-20T19:00:00Z'))).toBe('2026-10-21');
  });

  it('bounds a local day by IST midnight to midnight', () => {
    const { start, end } = localDayBounds('2026-10-20');
    expect(start.toISOString()).toBe('2026-10-19T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-20T18:30:00.000Z');
  });
});

describe('end-of-day digest email', () => {
  const props = {
    l3Count: 3,
    pendingL2Count: 2,
    activityUrl: 'https://app.causedeck.test/w/iyer/activity?day=2026-10-20',
    inboxUrl: 'https://app.causedeck.test/w/iyer/inbox',
    preferencesUrl: 'https://app.causedeck.test/settings/notifications',
  };

  it.each(['en', 'ta', 'kn'] as const)(
    'renders in %s with counts and the two app links',
    async (locale) => {
      const email = await renderEmail('end-of-day-digest', props, locale);
      expect(email.html).toMatch(new RegExp(`<html[^>]*\\blang="${locale}"`));
      expect(email.html).toContain(`href="${props.activityUrl}"`);
      expect(email.html).toContain(`href="${props.inboxUrl}"`);
      expect(email.text).toContain('3');
      expect(email.text).toContain('2');
      for (const part of [email.subject, email.html, email.text]) {
        expect(part).not.toContain('notifications.email');
        expect(part).not.toMatch(/\{(count|title)\b/);
      }
    },
  );

  it('is counts only: no names appear unless the member opted in', async () => {
    const plain = await renderEmail('end-of-day-digest', props, 'en');
    expect(plain.html).not.toContain('Ilango');
    const named = await renderEmail(
      'end-of-day-digest',
      { ...props, matterTitles: ['Ilango v. State (fictional)'] },
      'en',
    );
    expect(named.html).toContain('Ilango v. State (fictional)');
  });

  it('smoke: light inline colours, a dark-mode block, Noto fallbacks, no remote content, no change links', async () => {
    const { html, text, subject } = await renderEmail('end-of-day-digest', props, 'en');
    expect(subject).toBe('What CauseDeck did today');
    // Light: the inline surface colours of the shared layout.
    expect(html).toContain('background-color:#fbfaf7');
    // Dark: a media-query block for the clients that honour it.
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('color-scheme');
    // Tamil and Kannada fall back to the Noto families.
    expect(html).toContain('Noto Sans Tamil');
    expect(html).toContain('Noto Sans Kannada');
    expect(html).not.toMatch(/<img\b|\bsrc\s*=|url\(/i);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(hrefs.filter((h) => !h.includes('/settings/notifications')).sort()).toEqual([
      props.activityUrl,
      props.inboxUrl,
    ]);
    expect(`${html}${text}`).not.toMatch(/undo\?|accept\?|confirm\?|token=/i);
  });
});
