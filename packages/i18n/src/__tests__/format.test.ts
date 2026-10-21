import { describe, expect, it } from 'vitest';

import {
  CONTENT_LANGS,
  DEFAULT_LOCALE,
  formatCaseNumber,
  formatDate,
  formatIndianGrouping,
  formatInr,
  formatList,
  formatNumber,
  formatRelative,
  formatRelativeFrom,
  formatTime,
  isContentLang,
  isLocale,
  langAttribute,
  LOCALE_BCP47,
  LOCALE_LABELS,
  LOCALES,
  tagContent,
  type ContentLang,
} from '../index';
import * as localesEntry from '../locales';

describe('locales', () => {
  it('lists en/ta/kn with native labels and IN tags', () => {
    expect(LOCALES).toEqual(['en', 'ta', 'kn']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALE_LABELS).toEqual({ en: 'English', ta: 'தமிழ்', kn: 'ಕನ್ನಡ' });
    expect(LOCALE_BCP47).toEqual({ en: 'en-IN', ta: 'ta-IN', kn: 'kn-IN' });
    expect(isLocale('ta')).toBe(true);
    expect(isLocale('hi')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('is the same list on the dependency-free subpath', () => {
    expect(localesEntry.LOCALES).toBe(LOCALES);
  });
});

describe('ContentLang', () => {
  it('covers en|ta|kn|hi|other', () => {
    const lang: ContentLang = 'hi';
    expect(CONTENT_LANGS).toEqual(['en', 'ta', 'kn', 'hi', 'other']);
    expect(isContentLang(lang)).toBe(true);
    expect(isContentLang('fr')).toBe(false);
  });
});

describe('formatInr', () => {
  it('formats integer paise with Indian grouping', () => {
    expect(formatInr(123456789)).toBe('₹12,34,567.89');
    expect(formatInr(100)).toBe('₹1.00');
    expect(formatInr(5)).toBe('₹0.05');
    expect(formatInr(12345678900)).toBe('₹12,34,56,789.00');
  });

  it('renders the same grouping and ₹ for ta and kn', () => {
    for (const locale of LOCALES) {
      expect(formatInr(123456789, { locale })).toBe('₹12,34,567.89');
      expect(formatInr(1234567890, { locale, compact: true })).toBe('₹1.23 Cr');
    }
  });

  it('handles zero and negative amounts', () => {
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(-0)).toBe('₹0.00');
    expect(formatInr(-123456789)).toBe('-₹12,34,567.89');
    expect(formatInr(-1234567890, { compact: true })).toBe('-₹1.23 Cr');
  });

  it('has a lakh/crore compact form', () => {
    // 123456789 paise is ₹12.35 lakh; ₹1.23 Cr is ₹1,23,45,678.90.
    expect(formatInr(123456789, { compact: true })).toBe('₹12.35 L');
    expect(formatInr(1234567890, { compact: true })).toBe('₹1.23 Cr');
    expect(formatInr(9_999_999, { compact: true })).toBe('₹99,999.99');
    expect(formatInr(10_000_000, { compact: true })).toBe('₹1.00 L');
    expect(formatInr(999_949_999, { compact: true })).toBe('₹99.99 L');
    expect(formatInr(999_950_000, { compact: true })).toBe('₹1.00 Cr');
    expect(formatInr(123_456_789_000_000n, { compact: true })).toBe('₹1,23,456.79 Cr');
  });

  it('uses integer arithmetic only', () => {
    // Beyond Number.MAX_SAFE_INTEGER a float would lose the last paise.
    expect(formatInr(123456789012345678901n)).toBe('₹12,34,56,78,90,12,34,56,789.01');
    expect(() => formatInr(12.5)).toThrow(RangeError);
    expect(() => formatInr(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => formatInr(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatNumber', () => {
  it('formats with the locale tag and exposes Indian grouping', () => {
    expect(formatNumber(1234567.5)).toBe('12,34,567.5');
    expect(formatIndianGrouping('123')).toBe('123');
    expect(formatIndianGrouping('1234')).toBe('1,234');
    expect(formatIndianGrouping('123456789')).toBe('12,34,56,789');
    expect(() => formatIndianGrouping('1.5')).toThrow(RangeError);
  });
});

describe('formatDate', () => {
  const noonIst = '2026-03-12T06:30:00Z';

  it('renders dd MMM yyyy with locale month names', () => {
    expect(formatDate(noonIst)).toBe('12 Mar 2026');
    expect(formatDate(noonIst, { locale: 'ta' })).toBe('12 மார். 2026');
    expect(formatDate(noonIst, { locale: 'kn' })).toBe('12 ಮಾರ್ಚ್ 2026');
  });

  it('switches day at IST midnight, not UTC midnight', () => {
    expect(formatDate('2026-03-11T18:29:59Z')).toBe('11 Mar 2026');
    expect(formatDate('2026-03-11T18:30:00Z')).toBe('12 Mar 2026');
    // 23:59 UTC on the 11th is already the 12th in IST.
    expect(formatDate(new Date(Date.UTC(2026, 2, 11, 23, 59)))).toBe('12 Mar 2026');
    expect(formatDate(Date.UTC(2026, 2, 12, 0, 0))).toBe('12 Mar 2026');
  });

  it('has a court style with the weekday', () => {
    expect(formatDate(noonIst, { style: 'court' })).toBe('Thu, 12 Mar 2026');
    expect(formatDate(noonIst, { locale: 'ta', style: 'court' })).toBe('வியா., 12 மார். 2026');
    expect(formatDate(noonIst, { locale: 'kn', style: 'court' })).toBe('ಗುರು, 12 ಮಾರ್ಚ್ 2026');
  });

  it('rejects invalid dates', () => {
    expect(() => formatDate('not a date')).toThrow(RangeError);
  });
});

describe('formatTime', () => {
  it('renders IST clock time', () => {
    expect(formatTime('2026-03-12T05:00:00Z')).toBe('10:30 am');
    expect(formatTime('2026-03-12T05:00:00Z', { locale: 'ta' })).toBe('10:30 AM');
  });
});

describe('formatRelative', () => {
  it('uses Intl.RelativeTimeFormat for each locale', () => {
    expect(formatRelative(2, 'day')).toBe('in 2 days');
    expect(formatRelative(-2, 'day')).toBe('2 days ago');
    for (const locale of LOCALES) {
      const rtf = new Intl.RelativeTimeFormat(LOCALE_BCP47[locale], { numeric: 'always' });
      expect(formatRelative(2, 'day', { locale })).toBe(rtf.format(2, 'day'));
      expect(formatRelative(-2, 'day', { locale })).toBe(rtf.format(-2, 'day'));
    }
    expect(formatRelative(2, 'day', { locale: 'ta' })).toBe('2 நாட்களில்');
    expect(formatRelative(-2, 'day', { locale: 'kn' })).toBe('2 ದಿನಗಳ ಹಿಂದೆ');
  });

  it('picks the unit and counts IST calendar days', () => {
    const now = '2026-03-12T06:30:00Z'; // 12:00 IST
    expect(formatRelativeFrom('2026-03-14T06:30:00Z', now)).toBe('in 2 days');
    expect(formatRelativeFrom('2026-03-10T06:30:00Z', now)).toBe('2 days ago');
    expect(formatRelativeFrom('2026-03-12T08:30:00Z', now)).toBe('in 2 hours');
    expect(formatRelativeFrom('2026-03-12T06:25:00Z', now)).toBe('5 minutes ago');
    // 23:30 IST on the 11th to 00:30 IST on the 13th is 25h but two calendar days.
    expect(formatRelativeFrom('2026-03-12T19:00:00Z', '2026-03-11T18:00:00Z')).toBe('in 2 days');
    expect(formatRelativeFrom('2026-04-01T06:30:00Z', now)).toBe('in 2 weeks');
  });
});

describe('formatList', () => {
  it('uses Intl.ListFormat for each locale', () => {
    expect(formatList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(formatList(['a', 'b'], { type: 'disjunction' })).toBe('a or b');
    expect(formatList(['a', 'b', 'c'], { locale: 'ta' })).toBe('a, b மற்றும் c');
    expect(formatList(['a', 'b', 'c'], { locale: 'kn' })).toBe('a, b, ಮತ್ತು c');
  });
});

describe('user content is never translated', () => {
  it('returns case numbers unchanged with a lang tag', () => {
    expect(formatCaseNumber('W.P.(MD) No. 1234 of 2026')).toEqual({
      text: 'W.P.(MD) No. 1234 of 2026',
      lang: 'en',
    });
    expect(formatCaseNumber('  O.S. 12/2026 ')).toEqual({ text: 'O.S. 12/2026', lang: 'en' });
    expect(formatCaseNumber('ரி.ம. 45/2026', 'ta')).toEqual({ text: 'ரி.ம. 45/2026', lang: 'ta' });
    expect(formatCaseNumber('ಒ.ಎಸ್. ೧೨/೨೦೨೬', 'kn')).toEqual({
      text: 'ಒ.ಎಸ್. ೧೨/೨೦೨೬',
      lang: 'kn',
    });
  });

  it('tags party names, citations and documents for screen readers', () => {
    expect(tagContent('முருகன்', 'ta')).toEqual({ text: 'முருகன்', lang: 'ta' });
    expect(tagContent('(2026) 3 SCC 1', 'en')).toEqual({ text: '(2026) 3 SCC 1', lang: 'en' });
    expect(tagContent('रामलाल', 'hi')).toEqual({ text: 'रामलाल', lang: 'hi' });
    expect(tagContent('scan.pdf text', 'other')).toEqual({
      text: 'scan.pdf text',
      lang: undefined,
    });
    expect(langAttribute('kn')).toBe('kn');
    expect(langAttribute('other')).toBeUndefined();
  });
});
