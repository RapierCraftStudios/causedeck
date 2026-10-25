// Karnataka HC neutral citation (#406): bench letter, division-bench suffix, canonical form through
// the shared normaliser, and other courts' citations ignored.
import { describe, expect, it } from 'vitest';

import { findKarnatakaNeutralCitation } from './neutral-citation.ts';

describe('findKarnatakaNeutralCitation', () => {
  it.each([
    ['Neutral Citation No. 2026:KHC:1234', '2026:KHC:1234', 'bengaluru', false],
    ['2026:KHC-D:567', '2026:KHC-D:567', 'dharwad', false],
    ['2026:KHC-K:12', '2026:KHC-K:12', 'kalaburagi', false],
    ['2026:KHC:89-DB', '2026:KHC:89-DB', 'bengaluru', true],
    ['2026:KHC-D:0450-DB', '2026:KHC-D:450-DB', 'dharwad', true],
    ['2026 : khc - d : 007', '2026:KHC-D:7', 'dharwad', false],
  ] as const)('%s -> %s (%s)', (text, normalised, bench, divisionBench) => {
    expect(findKarnatakaNeutralCitation(text)).toMatchObject({
      normalised,
      bench,
      divisionBench,
    });
  });

  it('keeps the citation as printed with its offset', () => {
    expect(findKarnatakaNeutralCitation('NC: 2026:KHC:89-DB.')).toEqual({
      normalised: '2026:KHC:89-DB',
      raw: '2026:KHC:89-DB',
      bench: 'bengaluru',
      divisionBench: true,
      index: 4,
    });
  });

  it.each(['2026:MHC:1234', '2026 INSC 123', 'no citation here', ''])('ignores %j', (text) => {
    expect(findKarnatakaNeutralCitation(text)).toBeNull();
  });
});
