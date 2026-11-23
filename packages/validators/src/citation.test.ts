// Citation kinds, reasons and the pre-staged pinpoint / quote-check slots (#1133, part 1 of #1117).
import { describe, expect, it } from 'vitest';

import {
  CITATION_KINDS,
  CITATION_QUOTE_CHECKS,
  CITATION_REASONS,
  CitationPinpointSchema,
  CitationSchema,
} from './citation';

const base = {
  id: 'c1',
  blockId: 'b1',
  span: [0, 13] as [number, number],
  raw: '2023 INSC 123',
  normalized: '2023 INSC 123',
  kind: 'neutral',
  status: 'unknown',
};

describe('citation enums (#1133)', () => {
  it('adds case_number and section after the existing kinds', () => {
    expect(CITATION_KINDS).toEqual(['neutral', 'reporter', 'case_name', 'case_number', 'section']);
  });

  it('adds the quote, pinpoint and section reasons after the existing reasons', () => {
    expect(CITATION_REASONS).toEqual([
      'resolver_unavailable',
      'throttled',
      'ambiguous',
      'title_mismatch',
      'title_missing',
      'unsupported',
      'quote_not_found',
      'pinpoint_not_found',
      'section_not_found',
    ]);
    expect(CITATION_QUOTE_CHECKS).toEqual(['verified', 'not_found']);
  });
});

describe('CitationSchema (#1133)', () => {
  it('accepts the new kinds and reasons', () => {
    for (const kind of ['case_number', 'section'])
      expect(CitationSchema.safeParse({ ...base, kind }).success).toBe(true);
    for (const reason of ['quote_not_found', 'pinpoint_not_found', 'section_not_found'])
      expect(CitationSchema.safeParse({ ...base, reason }).success).toBe(true);
  });

  it('carries an optional pinpoint and quote check status', () => {
    expect(CitationSchema.safeParse(base).success).toBe(true);
    for (const pinpoint of [{ para: 12 }, { para: 12, paraEnd: 14 }, { page: 7 }])
      for (const quoteChecked of ['verified', 'not_found'])
        expect(CitationSchema.safeParse({ ...base, pinpoint, quoteChecked }).success).toBe(true);
  });

  it('rejects an unknown kind, reason or quote status and any quote text', () => {
    expect(CitationSchema.safeParse({ ...base, kind: 'statute' }).success).toBe(false);
    expect(CitationSchema.safeParse({ ...base, reason: 'para_wrong' }).success).toBe(false);
    expect(CitationSchema.safeParse({ ...base, quoteChecked: 'altered' }).success).toBe(false);
    expect(CitationSchema.safeParse({ ...base, quote: 'the passage' }).success).toBe(false);
  });

  it('rejects an empty, non-positive, fractional, reversed or extended pinpoint', () => {
    for (const pinpoint of [
      {},
      { para: 0 },
      { page: -1 },
      { para: 1.5 },
      { para: 14, paraEnd: 12 },
      { para: 12, line: 3 },
    ]) {
      expect(CitationPinpointSchema.safeParse(pinpoint).success).toBe(false);
      expect(CitationSchema.safeParse({ ...base, pinpoint }).success).toBe(false);
    }
  });
});
