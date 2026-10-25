import { ClamAvScanner } from './clamav.ts';
import { NoopScanner } from './noop.ts';
import type { ScanProvider } from './provider.ts';

export { ClamAvScanner, parseClamdReply, type ClamAvOptions } from './clamav.ts';
export { EICAR_SIGNATURE, EICAR_TEST_STRING, MockEicarScanner } from './mock-eicar.ts';
export { NoopScanner } from './noop.ts';
export type { ScanOutcome, ScanProvider, ScanResult } from './provider.ts';

export interface ScanConfig {
  /** `CAPTURE_SCAN_REQUIRED=true` (Stage B): a skipped scan is a failure. */
  required: boolean;
  clamav: { host: string; port: number; timeoutMs: number; maxBytes: number } | null;
}

/** ClamAV when a host is configured, else the no-op scanner (Stage A). */
export function createScanProvider(config: ScanConfig): ScanProvider {
  return config.clamav === null ? new NoopScanner() : new ClamAvScanner(config.clamav);
}
