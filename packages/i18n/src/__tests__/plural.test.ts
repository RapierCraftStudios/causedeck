import { describe, expect, it } from 'vitest';

import { pluralCategory, selectPlural } from '../index';

describe('ICU plural rules', () => {
  it.each(['en', 'ta', 'kn'] as const)('%s has one and other', (locale) => {
    expect(pluralCategory(1, locale)).toBe('one');
    for (const n of [2, 5, 21, 100]) expect(pluralCategory(n, locale)).toBe('other');
  });

  it('follows CLDR for zero: other in en/ta, one in kn (i = 0 or n = 1)', () => {
    expect(pluralCategory(0, 'en')).toBe('other');
    expect(pluralCategory(0, 'ta')).toBe('other');
    expect(pluralCategory(0, 'kn')).toBe('one');
  });

  it('selects the form for ta and kn', () => {
    const ta = { one: '# வழக்கு', other: '# வழக்குகள்' };
    expect(selectPlural(1, ta, 'ta')).toBe('# வழக்கு');
    expect(selectPlural(3, ta, 'ta')).toBe('# வழக்குகள்');
    const kn = { one: '# ಪ್ರಕರಣ', other: '# ಪ್ರಕರಣಗಳು' };
    expect(selectPlural(1, kn, 'kn')).toBe('# ಪ್ರಕರಣ');
    expect(selectPlural(4, kn, 'kn')).toBe('# ಪ್ರಕರಣಗಳು');
  });

  it('falls back to other', () => {
    expect(selectPlural(1, { other: 'items' }, 'ta')).toBe('items');
  });
});
