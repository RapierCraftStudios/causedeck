// The scan hook (#43): `ScanProvider.scan(stream)` reports `clean`, `infected` or `error`; the
// no-op scanner (Stage A) reports `skipped`. Providers read the stream once and never keep it.
export type ScanOutcome = 'clean' | 'infected' | 'error' | 'skipped';

export interface ScanResult {
  outcome: ScanOutcome;
  /** The signature name for `infected` (e.g. `Eicar-Test-Signature`). */
  signature?: string;
  /** A short, content-free reason for `error`. */
  reason?: string;
}

export interface ScanProvider {
  readonly name: string;
  scan(stream: AsyncIterable<Uint8Array>): Promise<ScanResult>;
}
