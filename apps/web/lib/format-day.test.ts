import { describe, expect, it } from 'vitest';

import { formatDay } from './format-day.ts';

describe('formatDay', () => {
  it('formats an ISO date as weekday, day and month', () => {
    expect(formatDay('2026-11-16')).toBe('Mon, 16 Nov');
  });

  it('follows the locale', () => {
    expect(formatDay('2026-11-16', 'en-US')).toBe('Mon, Nov 16');
  });

  it('does not shift with the host time zone', () => {
    expect(formatDay('2026-11-22', 'en-IN')).toContain('22');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatDay('not-a-date')).toBe('not-a-date');
  });
});
