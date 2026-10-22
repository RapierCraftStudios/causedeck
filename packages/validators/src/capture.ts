// Capture inbox request and response schemas (#43; docs/product/09 §3): `POST /api/captures/presign`
// and `POST /api/captures/:id/complete`. `@causedeck/db` depends on this package, so the channel
// and status lists are written by hand; packages/capture/src/__tests__/lists.test.ts keeps them in
// step with the `capture` table.
import { z } from 'zod';

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
