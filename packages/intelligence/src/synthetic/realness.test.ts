import { describe, expect, it } from 'vitest';

import { allFixtureText, ENROLMENT_NUMBER, KNOWN_REAL_NAMES } from './make-docs.ts';

describe('synthetic fixtures are fictional', () => {
  it('holds no real-looking bar enrolment number', () => {
    const hits = allFixtureText().filter((line) => ENROLMENT_NUMBER.test(line));
    expect(hits).toEqual([]);
  });

  it('names no known real party', () => {
    const text = allFixtureText().join('\n').toLowerCase();
    const hits = KNOWN_REAL_NAMES.filter((name) => text.includes(name.toLowerCase()));
    expect(hits).toEqual([]);
  });

  it('the scan itself catches an enrolment number', () => {
    expect(ENROLMENT_NUMBER.test('Advocate KAR/1234/2015')).toBe(true);
    expect(ENROLMENT_NUMBER.test('W.P. No. 4821/2024')).toBe(false);
  });
});
