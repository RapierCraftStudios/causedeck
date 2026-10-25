// The capture settings read from the process environment (#43): `CAPTURE_SCAN_REQUIRED`,
// `CAPTURE_CLAMAV_*` and `CAPTURE_MAX_BYTES_<TYPE>` (see `captureConfigFromEnv` in
// `@causedeck/capture`). They are optional deployment toggles with safe defaults, read when a
// capture is created or a job runs, so they are not part of the typed `serverEnv()` schema.
import { captureConfigFromEnv, type CaptureConfig } from '@causedeck/capture';

export function captureConfigFromProcess(): CaptureConfig {
  // eslint-disable-next-line no-process-env -- optional CAPTURE_* toggles with defaults, outside the typed env schema.
  return captureConfigFromEnv(process.env);
}
