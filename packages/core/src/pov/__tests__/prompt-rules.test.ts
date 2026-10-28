// The prompt rules (#86): once per appearance, 3 a day, a 14-day pause after 3 skips, opt-out.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { decidePrompt, recordSkip, setPovPrefs, shouldPrompt, type PromptFacts } from '../index.ts';

import { NOW, povWorld } from './helpers.ts';

const day = 24 * 60 * 60 * 1000;
const facts = (over: Partial<PromptFacts> = {}): PromptFacts => ({
  enabled: true,
  alreadyShown: false,
  shownToday: 0,
  recent: [],
  now: NOW,
  ...over,
});

describe('decidePrompt', () => {
  it('prompts by default and stops for opt-out, a shown appearance and the daily cap', () => {
    expect(decidePrompt(facts())).toBe(true);
    expect(decidePrompt(facts({ enabled: false }))).toBe(false);
    expect(decidePrompt(facts({ alreadyShown: true }))).toBe(false);
    expect(decidePrompt(facts({ shownToday: 2 }))).toBe(true);
    expect(decidePrompt(facts({ shownToday: 3 }))).toBe(false);
  });

  it('pauses 14 days after three consecutive skips, then resumes', () => {
    const skip = (daysAgo: number) => ({ skippedAt: new Date(NOW.getTime() - daysAgo * day) });
    expect(decidePrompt(facts({ recent: [skip(1), skip(2), skip(3)] }))).toBe(false);
    expect(decidePrompt(facts({ recent: [skip(13), skip(14), skip(15)] }))).toBe(false);
    expect(decidePrompt(facts({ recent: [skip(15), skip(16), skip(17)] }))).toBe(true);
    expect(decidePrompt(facts({ recent: [skip(1), { skippedAt: null }, skip(3)] }))).toBe(true);
    expect(decidePrompt(facts({ recent: [skip(1), skip(2)] }))).toBe(true);
  });
});

describe('shouldPrompt', () => {
  it('prompts once per appearance, never a viewer, and opt-out stops it at once', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx, 4);
      const deps = { db: tx, now: () => NOW };
      const [h1, h2, h3, h4] = w.hearings as [string, string, string, string];
      expect(await shouldPrompt(deps, w.owner, { hearingId: h1 })).toBe(true);
      expect(await shouldPrompt(deps, w.owner, { hearingId: h1 })).toBe(false);
      expect(await shouldPrompt(deps, w.viewer, { hearingId: h1 })).toBe(false);
      expect(await shouldPrompt(deps, w.owner, { hearingId: h2 })).toBe(true);
      expect(await shouldPrompt(deps, w.owner, { hearingId: h3 })).toBe(true);
      expect(await shouldPrompt(deps, w.owner, { hearingId: h4 })).toBe(false);
      await setPovPrefs(deps, w.advocate, { promptsEnabled: false });
      expect(await shouldPrompt(deps, w.advocate, { hearingId: h1 })).toBe(false);
    });
  });

  it('stops after three skips in a row', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx, 4);
      const deps = { db: tx, now: () => NOW };
      for (const hearingId of w.hearings.slice(0, 3))
        await recordSkip(deps, w.owner, { hearingId });
      const later = { db: tx, now: () => new Date(NOW.getTime() + 86400000) };
      expect(await shouldPrompt(later, w.owner, { hearingId: w.hearings[3] as string })).toBe(
        false,
      );
    });
  });
});
