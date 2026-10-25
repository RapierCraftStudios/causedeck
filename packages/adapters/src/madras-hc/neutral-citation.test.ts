// Madras HC neutral citations (#398): colon and slash separators with any spacing, canonical
// `YYYY:MHC:n`, the printed form kept in `raw`.
import { describe, expect, it } from 'vitest';

import { findNeutralCitation, MADRAS_NEUTRAL_CITATION } from './neutral-citation.ts';

describe('findNeutralCitation', () => {
  it.each([
    ['2026:MHC:1234', '2026:MHC:1234', ':'],
    ['2026/MHC/1234', '2026:MHC:1234', '/'],
    ['Citation: 2026 : MHC : 0045', '2026:MHC:45', ':'],
    ['2023 / mhc / 1234567', '2023:MHC:1234567', '/'],
  ])('%s -> %s', (text, normalised, separator) => {
    const found = findNeutralCitation(text);
    expect(found).toMatchObject({ normalised, separator });
    expect(text).toContain(found?.raw);
  });

  it('keeps the printed separator and spacing in raw', () => {
    expect(findNeutralCitation('2026 / MHC / 0789')?.raw).toBe('2026 / MHC / 0789');
  });

  it('returns null without a Madras citation', () => {
    expect(findNeutralCitation('2026:KHC:12')).toBeNull();
    expect(findNeutralCitation('2026 INSC 123')).toBeNull();
    expect(findNeutralCitation('2026:MHC:12345678')).toBeNull();
    expect(findNeutralCitation('')).toBeNull();
  });

  it('is the issue pattern', () => {
    expect(MADRAS_NEUTRAL_CITATION.source).toBe(
      String.raw`\b(\d{4})\s*([:/])\s*MHC\s*[:/]\s*(\d{1,7})\b`,
    );
  });
});
