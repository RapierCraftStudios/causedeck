// Capture types (#43). The channel, status and scan-status lists belong to the `capture` table of
// `@causedeck/db`; they are re-exported here so callers import one package.
import type { CaptureChannel, CaptureScanStatus, CaptureStatus } from '@causedeck/db/schema';

export { CAPTURE_CHANNELS, CAPTURE_SCAN_STATUSES, CAPTURE_STATUSES } from '@causedeck/db/schema';
export type { CaptureChannel, CaptureScanStatus, CaptureStatus };

/** An allow-listed MIME type (canonical, as stored); see `allow-list.ts`. */
export type AllowedMime = string;

/** Channels that start enabled; every other channel needs the lawyer's opt-in (CA-9). */
export const DEFAULT_ENABLED_CHANNELS: readonly CaptureChannel[] = ['manual', 'upload'];

/** What a channel hands to `createCapture`. Raw input only: nothing here is interpreted. */
export interface CaptureInput {
  channel: CaptureChannel;
  filename: string;
  /** The MIME the client declared; never trusted on its own. */
  mime: string;
  sizeBytes: number;
  /** Hex sha256 the client computed; verified server-side when the upload completes. */
  sha256: string;
  matterHintId?: string | undefined;
  /** Channel details (sender, share title, ...); ids and labels, never file content. */
  sourceMeta?: Record<string, unknown> | undefined;
}

/** A transition recorded in `source_meta.history`. */
export interface CaptureHistoryEntry {
  from: CaptureStatus;
  to: CaptureStatus;
  at: string;
  reason?: string;
}
