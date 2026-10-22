import { describe, expect, it } from 'vitest';

import { captureConfigFromEnv, DEFAULT_SIZE_CAPS_BYTES, PRESIGN_TTL_SECONDS } from '../index.ts';

describe('captureConfigFromEnv', () => {
  it('defaults to the issue caps, no scanner, scanning optional and 10 minute URLs', () => {
    const config = captureConfigFromEnv({});
    expect(config.sizeCapsBytes).toEqual(DEFAULT_SIZE_CAPS_BYTES);
    expect(config.scan).toEqual({ required: false, clamav: null });
    expect(config.presignTtlSeconds).toBe(PRESIGN_TTL_SECONDS);
    expect(PRESIGN_TTL_SECONDS).toBe(600);
  });

  it('reads size cap overrides per allow-list name and ignores invalid ones', () => {
    const config = captureConfigFromEnv({
      CAPTURE_MAX_BYTES_PDF: '1000',
      CAPTURE_MAX_BYTES_ICS: 'lots',
      CAPTURE_MAX_BYTES_ZIP: '0',
    });
    expect(config.sizeCapsBytes['pdf']).toBe(1000);
    expect(config.sizeCapsBytes['ics']).toBe(DEFAULT_SIZE_CAPS_BYTES['ics']);
    expect(config.sizeCapsBytes['zip']).toBe(DEFAULT_SIZE_CAPS_BYTES['zip']);
  });

  it('turns ClamAV on with a host and CAPTURE_SCAN_REQUIRED on with "true"', () => {
    const config = captureConfigFromEnv({
      CAPTURE_CLAMAV_HOST: 'clamav',
      CAPTURE_CLAMAV_PORT: '3311',
      CAPTURE_CLAMAV_TIMEOUT_MS: '5000',
      CAPTURE_SCAN_REQUIRED: 'true',
    });
    expect(config.scan).toEqual({
      required: true,
      clamav: { host: 'clamav', port: 3311, timeoutMs: 5000, maxBytes: 25 * 1024 * 1024 },
    });
    expect(captureConfigFromEnv({ CAPTURE_SCAN_REQUIRED: 'yes' }).scan.required).toBe(false);
    expect(captureConfigFromEnv({ CAPTURE_CLAMAV_HOST: '  ' }).scan.clamav).toBeNull();
    expect(captureConfigFromEnv({ CAPTURE_CLAMAV_HOST: 'c' }).scan.clamav?.port).toBe(3310);
  });
});
