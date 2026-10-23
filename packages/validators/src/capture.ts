// Capture inbox request and response schemas (#43; docs/product/09 §3): `POST /api/captures/presign`
// and `POST /api/captures/:id/complete`. `@causedeck/db` depends on this package, so the channel
// and status lists are written by hand; packages/capture/src/__tests__/lists.test.ts keeps them in
// step with the `capture` table.
import { z } from 'zod';

import { DOCUMENT_KINDS, DOCUMENT_TEXT_STATUSES } from './matter-graph';

export const CAPTURE_CHANNELS = [
  'share',
  'upload',
  'voice',
  'camera',
  'email',
  'ics',
  'whatsapp_export',
  'bulk_import',
  'manual',
] as const;

export const CAPTURE_STATUSES = [
  'received',
  'scanning',
  'queued',
  'processing',
  'needs_you',
  'ready',
  'applied',
  'failed',
  'duplicate',
  'discarded',
  'quarantined',
] as const;

/** Channels a client may upload a file through; the others have no presign flow. */
export const CAPTURE_UPLOAD_CHANNELS = [
  'share',
  'upload',
  'voice',
  'camera',
  'whatsapp_export',
  'bulk_import',
] as const;

export const CaptureChannelSchema = z.enum(CAPTURE_CHANNELS);
export const CaptureStatusSchema = z.enum(CAPTURE_STATUSES);

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex characters');

export const CapturePresignRequestSchema = z.object({
  workspaceId: z.uuid(),
  channel: z.enum(CAPTURE_UPLOAD_CHANNELS),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  sha256: Sha256,
  matterHintId: z.uuid().optional(),
});
export type CapturePresignRequest = z.infer<typeof CapturePresignRequestSchema>;

export const CapturePresignResponseSchema = z.object({
  captureId: z.uuid(),
  uploadUrl: z.string().min(1),
  headers: z.object({ 'content-type': z.string(), 'content-length': z.string() }),
  expiresAt: z.string(),
});
export type CapturePresignResponse = z.infer<typeof CapturePresignResponseSchema>;

export const CaptureCompleteRequestSchema = z.object({
  workspaceId: z.uuid(),
  sha256: Sha256,
});
export type CaptureCompleteRequest = z.infer<typeof CaptureCompleteRequestSchema>;

export const CaptureCompleteResponseSchema = z.object({
  status: CaptureStatusSchema,
  duplicateOf: z.uuid().optional(),
});
export type CaptureCompleteResponse = z.infer<typeof CaptureCompleteResponseSchema>;

/**
 * Why the document pipeline (#45) moved a capture to "Needs you". `unreadable` covers an empty scan,
 * OCR under the confidence floor and a format with nothing to read.
 */
export const CAPTURE_NEEDS_YOU_REASONS = [
  'unreadable',
  'password_protected',
  'corrupt',
  // Anchored order extraction (#46): the capture is ready but a date or field needs a person.
  'extraction_unanchored',
  'extraction_ambiguous',
  'extraction_suspicious',
  'extraction_low_confidence',
  // Voice capture (#542): the recording could not be read, its matter is unknown, or its next date was dropped.
  'voice_unreadable',
  'voice_unmatched',
  'voice_next_date_dropped',
] as const;
export const CaptureNeedsYouReasonSchema = z.enum(CAPTURE_NEEDS_YOU_REASONS);
export type CaptureNeedsYouReason = z.infer<typeof CaptureNeedsYouReasonSchema>;

/**
 * Events the document pipeline emits (#45). Payloads carry ids and classification, never text.
 * `document.processed` feeds extraction (#46); `capture.classified` feeds cause-list ingestion
 * (#57); `document.near_duplicate` is for the automation engine to merge or chain at L3.
 */
export const DocumentProcessedEventSchema = z.object({
  type: z.literal('document.processed'),
  workspaceId: z.uuid(),
  captureId: z.uuid(),
  documentId: z.uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  language: z.string().nullable(),
  textStatus: z.enum(DOCUMENT_TEXT_STATUSES),
});
export type DocumentProcessedEvent = z.infer<typeof DocumentProcessedEventSchema>;

export const CaptureClassifiedEventSchema = z.object({
  type: z.literal('capture.classified'),
  workspaceId: z.uuid(),
  captureId: z.uuid(),
  documentId: z.uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  confidence: z.number().min(0).max(1),
  /** The capture is `ai_blocked`: subscribers must not send its text to a model (CA-10). */
  aiBlocked: z.boolean(),
});
export type CaptureClassifiedEvent = z.infer<typeof CaptureClassifiedEventSchema>;

export const DocumentNearDuplicateEventSchema = z.object({
  type: z.literal('document.near_duplicate'),
  workspaceId: z.uuid(),
  documentId: z.uuid(),
  ofDocumentId: z.uuid(),
});
export type DocumentNearDuplicateEvent = z.infer<typeof DocumentNearDuplicateEventSchema>;

/** A voice recording was transcribed (#542). Ids and counts only, never text. */
export const CaptureTranscribedEventSchema = z.object({
  type: z.literal('capture.transcribed'),
  workspaceId: z.uuid(),
  captureId: z.uuid(),
  documentId: z.uuid(),
  language: z.string(),
  segments: z.number().int().min(0),
});
export type CaptureTranscribedEvent = z.infer<typeof CaptureTranscribedEventSchema>;

/** A transcript was structured into proposals (#542). Ids and counts only. */
export const CaptureStructuredEventSchema = z.object({
  type: z.literal('capture.structured'),
  workspaceId: z.uuid(),
  captureId: z.uuid(),
  proposals: z.number().int().min(0),
  rejected: z.number().int().min(0),
  needsYou: z.boolean(),
});
export type CaptureStructuredEvent = z.infer<typeof CaptureStructuredEventSchema>;

export const DocumentPipelineEventSchema = z.discriminatedUnion('type', [
  DocumentProcessedEventSchema,
  CaptureTranscribedEventSchema,
  CaptureStructuredEventSchema,
  CaptureClassifiedEventSchema,
  DocumentNearDuplicateEventSchema,
]);
export type DocumentPipelineEvent = z.infer<typeof DocumentPipelineEventSchema>;
