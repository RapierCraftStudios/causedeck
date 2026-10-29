import { describe, expect, it } from 'vitest';

import { addMonths, computeExpiry } from '../engine.ts';

describe('limitation engine', () => {
  it('counts days, months and years from the start date', () => {
    expect(computeExpiry('2026-01-10', 30, 'days')).toBe('2026-02-09');
    expect(computeExpiry('2026-01-10', 6, 'months')).toBe('2026-07-10');
    expect(computeExpiry('2023-03-05', 3, 'years')).toBe('2026-03-05');
  });

  it('clamps a month end and handles leap years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(computeExpiry('2024-02-29', 1, 'years')).toBe('2025-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('extends the period by the excluded days', () => {
    expect(computeExpiry('2026-01-10', 30, 'days', 5)).toBe('2026-02-14');
  });
});
