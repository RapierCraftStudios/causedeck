// Shared personal-data patterns (#892): the moved patterns still re-export from detect.ts, and the
// corpus cues match only with their cue.
import { describe, expect, it } from 'vitest';

import * as shared from './pii-patterns.ts';

const hits = (re: RegExp, s: string): string[] => [...s.matchAll(re)].map((m) => m[0]);

describe('pii-patterns', () => {
  it('takes a bank account only after a cue word', () => {
    expect(hits(shared.BANK_ACCOUNT_RE, 'A/c No. 123456789012 was frozen')).toHaveLength(1);
    expect(hits(shared.BANK_ACCOUNT_RE, 'Crl.A. 123456789012 of 2020')).toHaveLength(0);
  });

  it('finds vehicle numbers and address cues', () => {
    expect(hits(shared.VEHICLE_NUMBER_RE, 'lorry KA 05 MN 1234 and MH12AB1234')).toHaveLength(2);
    expect(hits(shared.ADDRESS_CUE_RE, 'resident of 12, Main Road, Chennai.')).toHaveLength(1);
  });
});
