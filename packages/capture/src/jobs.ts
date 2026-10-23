// Capture job names and payloads (#43). Payloads carry ids only (the job registry rejects fields
// that could hold matter content). `capture.process` is consumed by the document pipeline (#45).
export const CAPTURE_JOB_NAMES = {
  scan: 'capture.scan',
  process: 'capture.process',
  retention: 'capture.retention',
  /** Structures a WhatsApp chat import (#526); queued by `capture.process` for `whatsapp_export`. */
  whatsappImport: 'whatsapp.import',
  /** Runs one forwarded email through the parser registry (#530); queued by the inbound webhook. */
  emailIntake: 'email.intake',
  /** Deletes the raw MIME of one received email once its 30 days are up (#530). */
  emailRawExpire: 'email.raw-expire',
  /** The daily global tick (02:00 IST) that queues `capture.retention` per workspace. */
  retentionTick: 'system.capture.retention',
} as const;

export interface CaptureScanPayload {
  workspaceId: string;
  captureId: string;
  /** The raw bytes' sha256, so a re-run for changed bytes is a different job. */
  sha256: string;
}

export interface CaptureProcessPayload {
  workspaceId: string;
  captureId: string;
  pipelineVersion: string;
}

export interface WhatsAppImportPayload {
  workspaceId: string;
  captureId: string;
}

export interface EmailIntakePayload {
  workspaceId: string;
  /** The member whose intake address received the message. */
  userId: string;
  intakeMessageId: string;
}

export interface CaptureRetentionPayload {
  workspaceId: string;
}

/**
 * Retries after the first attempt: 4, so five attempts in all with exponential backoff, then the
 * dead-letter queue and a `failed` capture.
 */
export const CAPTURE_JOB_RETRIES = 4;
export const CAPTURE_JOB_RETRY_DELAY_SEC = 10;

/**
 * The pipeline version `capture.process` is queued with: the document pipeline's own version
 * (`PIPELINE_VERSION` in `@causedeck/intelligence`, #45), written out here because the capture
 * package imports no domain package. packages/core/src/capture/__tests__/pipeline.test.ts keeps
 * the two in step. Bump both to re-process captures on demand.
 */
export const CAPTURE_PIPELINE_VERSION = 'di-1';

/** The user-safe reasons a capture ends `failed` (`source_meta.failureReason`). */
export const CAPTURE_FAILURE_REASONS = [
  'too_large',
  'upload_missing',
  'hash_mismatch',
  'unsupported_type',
  'scan_unavailable',
  'scan_required',
  'processing_failed',
] as const;
export type CaptureFailureReason = (typeof CAPTURE_FAILURE_REASONS)[number];
