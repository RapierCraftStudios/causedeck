// A test double for the scanner: reports `infected` when the stream holds the EICAR antivirus test
// string and `clean` otherwise. The string is built here rather than kept in a fixture file so a
// developer's own antivirus does not quarantine the repository.
import type { ScanProvider, ScanResult } from './provider.ts';

/** The standard EICAR test string (68 bytes), harmless by design. */
export const EICAR_TEST_STRING =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const EICAR_SIGNATURE = 'Eicar-Test-Signature';

export class MockEicarScanner implements ScanProvider {
  readonly name = 'mock-eicar';

  async scan(stream: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    const needle = Buffer.from(EICAR_TEST_STRING, 'latin1');
    let tail = Buffer.alloc(0);
    for await (const chunk of stream) {
      const window = Buffer.concat([tail, chunk]);
      if (window.includes(needle)) return { outcome: 'infected', signature: EICAR_SIGNATURE };
      tail = window.subarray(Math.max(0, window.length - (needle.length - 1)));
    }
    return { outcome: 'clean' };
  }
}
