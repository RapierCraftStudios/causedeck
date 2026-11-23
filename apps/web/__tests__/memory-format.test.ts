import { describe, expect, it } from 'vitest';

import {
  barHeightPercent,
  formatRate,
  stripTrailingPunctuation,
} from '../lib/memory/memory-format.ts';

describe('formatRate', () => {
  it('renders a decimal rate as a percentage', () => {
    expect(formatRate(0.053, 'en')).toBe('5.3%');
    expect(formatRate(1, 'en')).toBe('100%');
    expect(formatRate(0, 'en')).toBe('0%');
  });
  it('uses an en dash for no data', () => {
    expect(formatRate(null, 'en')).toBe('–');
  });
  it('follows the locale digits and symbols', () => {
    expect(formatRate(0.5, 'ta')).toMatch(/50\s?%/);
  });
});

describe('stripTrailingPunctuation', () => {
  it('drops closing sentence punctuation so the template adds its own', () => {
    expect(stripTrailingPunctuation('Put the date first.')).toBe('Put the date first');
    expect(stripTrailingPunctuation('Why?! ')).toBe('Why');
    expect(stripTrailingPunctuation('Vakalat, Memo')).toBe('Vakalat, Memo');
    expect(stripTrailingPunctuation('Rule 4.2')).toBe('Rule 4.2');
  });
});

describe('barHeightPercent', () => {
  it('scales to the largest rate with a 10% floor', () => {
    expect(barHeightPercent(0.053, 0.053)).toBe(53);
    expect(barHeightPercent(0.5, 0.5)).toBe(100);
    expect(barHeightPercent(0.05, 0)).toBe(50);
  });
  it('is flat for no data', () => {
    expect(barHeightPercent(null, 0.5)).toBe(0);
    expect(barHeightPercent(0, 0.5)).toBe(0);
  });
});
