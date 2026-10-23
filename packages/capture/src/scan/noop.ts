import type { ScanProvider, ScanResult } from './provider.ts';

/** Stage A: no scanner is deployed, so every capture is marked `scan_status = skipped`. */
export class NoopScanner implements ScanProvider {
  readonly name = 'noop';

  scan(): Promise<ScanResult> {
    return Promise.resolve({ outcome: 'skipped' });
  }
}
