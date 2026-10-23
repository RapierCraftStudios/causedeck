// Karnataka HC header synonyms (#405): every printed spelling of a column resolves through one
// normal form (upper case, dots and whitespace removed); a non-header cell resolves to null.
import { describe, expect, it } from 'vitest';

import { karnatakaHcColumnOf } from './config/column-synonyms.ts';

describe('karnatakaHcColumnOf (#405)', () => {
  it.each([
    ['Sl. No.', 'itemNo'],
    ['Sl.No', 'itemNo'],
    ['S.No', 'itemNo'],
    ['SL NO', 'itemNo'],
    ['Case No.', 'caseNo'],
    ['Case No', 'caseNo'],
    ['Case Number', 'caseNo'],
    ['Petitioner / Respondent', 'parties'],
    ['Petitioner/Respondent', 'parties'],
    ['Parties', 'parties'],
    ['Advocate for Petitioner', 'petitionerAdvocate'],
    ['Petitioner Advocate', 'petitionerAdvocate'],
    ['Advocate  for  Respondent', 'respondentAdvocate'],
    ['Office Objections', 'remarks'],
  ])('%s -> %s', (header, column) => {
    expect(karnatakaHcColumnOf(header)).toBe(column);
  });

  it('returns null for a cell that names no column', () => {
    expect(karnatakaHcColumnOf('WP No. 12345/2026')).toBeNull();
    expect(karnatakaHcColumnOf('')).toBeNull();
    expect(karnatakaHcColumnOf(' . ')).toBeNull();
  });
});
