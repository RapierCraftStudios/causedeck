import { describe, expect, it } from 'vitest';

import { foldText, HearingStructuredSchema, spanInside, ValidatedHearingSchema } from './schema.ts';

const span = { start: 0, end: 5 };

describe('HearingStructuredSchema', () => {
  it('accepts a spanned reading and defaults directions and tasks to none', () => {
    const parsed = HearingStructuredSchema.parse({ outcome: { text: 'adjourned', span } });
    expect(parsed.directions).toEqual([]);
    expect(parsed.tasks).toEqual([]);
  });

  it('refuses a field without a span, an empty span and unknown keys', () => {
    expect(HearingStructuredSchema.safeParse({ outcome: { text: 'adjourned' } }).success).toBe(
      false,
    );
    const empty = { outcome: { text: 'x', span: { start: 3, end: 3 } } };
    expect(HearingStructuredSchema.safeParse(empty).success).toBe(false);
    const extra = { outcome: { text: 'x', span }, action: 'delete' };
    expect(HearingStructuredSchema.safeParse(extra).success).toBe(false);
  });

  it('lets the validated form lack an outcome', () => {
    expect(ValidatedHearingSchema.safeParse({}).success).toBe(true);
  });
});

describe('spanInside', () => {
  it('needs a non-empty integer range inside the transcript', () => {
    expect(spanInside({ start: 0, end: 10 }, 10)).toBe(true);
    expect(spanInside({ start: 0, end: 11 }, 10)).toBe(false);
    expect(spanInside({ start: -1, end: 4 }, 10)).toBe(false);
    expect(spanInside({ start: 4, end: 4 }, 10)).toBe(false);
    expect(spanInside({ start: 0.5, end: 4 }, 10)).toBe(false);
  });

  it('folds whitespace and case when comparing quotes', () => {
    expect(foldText('  Fourteenth   of\nNovember ')).toBe('fourteenth of november');
  });
});
