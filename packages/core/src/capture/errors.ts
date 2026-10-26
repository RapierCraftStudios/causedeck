// Capture errors (#43). `ChannelDisabledError` and `SensitiveMatterExcludedError` are plain errors
// with a `code`, mapped to 403 by the routes; not-found and permission failures use the shared
// `WorkspaceError`. `UnsupportedTypeError` and `CaptureTooLargeError` come from `@causedeck/capture`.
import type { CaptureChannel } from '@causedeck/capture';

export class ChannelDisabledError extends Error {
  override name = 'ChannelDisabledError';
  readonly code = 'CHANNEL_DISABLED' as const;

  constructor(readonly channel: CaptureChannel) {
    super(`the ${channel} capture channel is not enabled for this workspace`);
  }
}

/** Bulk import never takes a capture that hints at a sensitive matter (CA-10). */
export class SensitiveMatterExcludedError extends Error {
  override name = 'SensitiveMatterExcludedError';
  readonly code = 'SENSITIVE_MATTER_EXCLUDED' as const;

  constructor() {
    super('bulk import excludes sensitive matters');
  }
}

export function isCaptureDomainError(
  error: unknown,
): error is ChannelDisabledError | SensitiveMatterExcludedError {
  return error instanceof ChannelDisabledError || error instanceof SensitiveMatterExcludedError;
}
