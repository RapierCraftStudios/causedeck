// `POST /api/captures` (#43): the small multipart fallback for a share-target POST (#50). Fields:
// `workspaceId`, `file`, optional `channel` (`share` by default) and `matterHintId`. The file goes
// through the same pipeline as the presigned flow: the server hashes the bytes (it does not open
// or parse them), creates the capture, PUTs to the presigned URL and completes it → 201
// `{ captureId, status, duplicateOf? }`. Files over 10 MB must use presign. Same errors as
// `/api/captures/presign`.
import { createHash } from 'node:crypto';

import { completeUpload, createCapture } from '@causedeck/core/capture';
import { CaptureChannelSchema } from '@causedeck/validators';
import { z } from 'zod';

import { captureError, captureRequest, crossOrigin, json } from '../../../lib/capture-http.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The most the fallback accepts; bigger files use the presigned flow. */
export const MULTIPART_MAX_BYTES = 10 * 1024 * 1024;

const Fields = z.object({
  workspaceId: z.uuid(),
  channel: CaptureChannelSchema.default('share'),
  matterHintId: z.uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MULTIPART_MAX_BYTES + 64 * 1024) {
    return json(413, { error: 'too_large' });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const file = form.get('file');
  const fields = Fields.safeParse({
    workspaceId: form.get('workspaceId'),
    channel: form.get('channel') ?? undefined,
    matterHintId: form.get('matterHintId') ?? undefined,
  });
  if (!(file instanceof File) || !fields.success) return json(400, { error: 'invalid_request' });
  if (file.size === 0) return json(400, { error: 'invalid_request' });
  if (file.size > MULTIPART_MAX_BYTES) return json(413, { error: 'too_large' });

  const ctx = await captureRequest(request, fields.data.workspaceId);
  if (ctx instanceof Response) return ctx;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const created = await createCapture(ctx, {
      channel: fields.data.channel,
      filename: file.name,
      mime: file.type,
      sizeBytes: bytes.byteLength,
      sha256,
      matterHintId: fields.data.matterHintId,
    });
    const put = await fetch(created.uploadUrl, {
      method: 'PUT',
      headers: created.headers,
      body: bytes,
    });
    if (!put.ok) return json(502, { error: 'storage_unavailable' });
    const done = await completeUpload(ctx, created.captureId, sha256);
    return json(201, { captureId: created.captureId, ...done });
  } catch (error) {
    return captureError(error);
  }
}
