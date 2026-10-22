// `POST /api/captures/presign` (#43): start a capture. Body `{ workspaceId, channel, filename, mime,
// sizeBytes, sha256, matterHintId? }` → 201 `{ captureId, uploadUrl, headers, expiresAt }`, a
// one-time presigned PUT bound to the server-built key, type and length that expires in 10
// minutes. The type is decided from the extension, the declared type and (at complete) the magic
// bytes; the size cap is checked against the declared size here and again after the upload.
// 403 cross-origin or channel disabled, 401 signed out, 404 not a member, 429 over the rate
// limit, 400 invalid input, 413 over the cap, 415 type not allowed.
import { createCapture } from '@causedeck/core/capture';
import { CapturePresignRequestSchema } from '@causedeck/validators';

import { captureError, captureRequest, crossOrigin, json } from '../../../../lib/capture-http.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const parsed = CapturePresignRequestSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid_request' });
  const { workspaceId, channel, filename, mime, sizeBytes, sha256, matterHintId } = parsed.data;

  const ctx = await captureRequest(request, workspaceId);
  if (ctx instanceof Response) return ctx;
  try {
    const created = await createCapture(ctx, {
      channel,
      filename,
      mime,
      sizeBytes,
      sha256,
      matterHintId,
    });
    return json(201, { ...created, expiresAt: created.expiresAt.toISOString() });
  } catch (error) {
    return captureError(error);
  }
}
