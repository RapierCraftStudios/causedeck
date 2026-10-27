import { describe, expect, it } from 'vitest';

import { GUARD_CATEGORIES, GUARD_PHRASES, guardOutward } from '../guard.ts';

describe('guardOutward', () => {
  for (const language of ['en', 'ta', 'kn'] as const) {
    const phrases = GUARD_CATEGORIES.flatMap((c) =>
      GUARD_PHRASES[language][c].map((phrase) => ({ category: c, phrase })),
    );

    it(`has 30+ ${language} phrases covering every category`, () => {
      expect(phrases.length).toBeGreaterThanOrEqual(30);
      for (const c of GUARD_CATEGORIES) {
        expect(GUARD_PHRASES[language][c].length).toBeGreaterThan(0);
      }
    });

    it(`strips a sentence for each ${language} phrase and keeps the facts`, () => {
      for (const { category, phrase } of phrases) {
        const result = guardOutward(
          `Fact one is stated. ${phrase} ok. Fact two is stated.`,
          language,
        );
        expect(result.ok, phrase).toBe(false);
        expect(result.violations[0]?.category, phrase).toBe(category);
        expect(result.text, phrase).toContain('Fact one is stated.');
        expect(result.text, phrase).toContain('Fact two is stated.');
        expect(result.text.toLowerCase(), phrase).not.toContain(phrase);
      }
    });
  }

  it('passes plain facts through untouched', () => {
    const text = 'The next date is 12 December 2026 (to be confirmed).';
    expect(guardOutward(text, 'en')).toEqual({ ok: true, text, violations: [] });
  });

  it('flags citations and authorities in any language', () => {
    for (const language of ['en', 'ta', 'kn'] as const) {
      const result = guardOutward('As held in AIR 2019 SC 12 the point is settled.', language);
      expect(result.violations[0]?.category).toBe('citation');
      expect(result.text).toBe('');
    }
  });
});
