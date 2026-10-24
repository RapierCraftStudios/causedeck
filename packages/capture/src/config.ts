// Capture configuration (#43), read from the environment by the caller and passed in:
//   CAPTURE_SCAN_REQUIRED      "true" makes a skipped scan a failure (Stage B); default false
//   CAPTURE_CLAMAV_HOST/PORT   clamd address; without a host the no-op scanner runs (Stage A)
//   CAPTURE_CLAMAV_TIMEOUT_MS  default 30000;  CAPTURE_CLAMAV_MAX_BYTES  default 25 MB
//   CAPTURE_MAX_BYTES_<NAME>   size cap override per allow-list name (PDF, DOCX, ICS, TXT, PNG,
//                              JPEG, WEBP, HEIC, M4A, MP3, WAV, OGG, WEBM, ZIP)
import { DEFAULT_SIZE_CAPS_BYTES } from './allow-list.ts';
import type { ScanConfig } from './scan/index.ts';

/** Presigned upload URLs live 10 minutes. */
export const PRESIGN_TTL_SECONDS = 600;

export interface CaptureConfig {
  sizeCapsBytes: Readonly<Record<string, number>>;
  scan: ScanConfig;
  presignTtlSeconds: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function captureConfigFromEnv(env: Env): CaptureConfig {
  const sizeCapsBytes: Record<string, number> = { ...DEFAULT_SIZE_CAPS_BYTES };
  for (const name of Object.keys(DEFAULT_SIZE_CAPS_BYTES)) {
    const override = positiveInt(env[`CAPTURE_MAX_BYTES_${name.toUpperCase()}`]);
    if (override !== null) sizeCapsBytes[name] = override;
  }
  const host = env['CAPTURE_CLAMAV_HOST']?.trim();
  return {
    sizeCapsBytes,
    presignTtlSeconds: PRESIGN_TTL_SECONDS,
    scan: {
      required: env['CAPTURE_SCAN_REQUIRED']?.trim().toLowerCase() === 'true',
      clamav:
        host === undefined || host === ''
          ? null
          : {
              host,
              port: positiveInt(env['CAPTURE_CLAMAV_PORT']) ?? 3310,
              timeoutMs: positiveInt(env['CAPTURE_CLAMAV_TIMEOUT_MS']) ?? 30_000,
              maxBytes: positiveInt(env['CAPTURE_CLAMAV_MAX_BYTES']) ?? 25 * 1024 * 1024,
            },
    },
  };
}

/** What a scan outcome means for a capture: its `scan_status`, or a failure reason. */
export type ScanDecision =
  | { ok: true; scanStatus: 'clean' | 'skipped' }
  | { ok: false; quarantine: true; scanStatus: 'infected' }
  | { ok: false; quarantine: false; reason: 'scan_unavailable' | 'scan_required' };

export function decideScan(
  outcome: 'clean' | 'infected' | 'error' | 'skipped',
  required: boolean,
): ScanDecision {
  switch (outcome) {
    case 'clean':
      return { ok: true, scanStatus: 'clean' };
    case 'infected':
      return { ok: false, quarantine: true, scanStatus: 'infected' };
    case 'skipped':
      return required
        ? { ok: false, quarantine: false, reason: 'scan_required' }
        : { ok: true, scanStatus: 'skipped' };
    case 'error':
      return { ok: false, quarantine: false, reason: 'scan_unavailable' };
  }
}
