// `POST /api/captures/:id/complete` (#43): finish a capture after the PUT. Body `{ workspaceId,
// sha256 }` → 200 `{ status, duplicateOf? }`. The server re-reads the stored bytes, sniffs their
// type, recomputes the sha256 and checks the size before the capture moves to `scanning` or
// `queued`; bytes already captured in the workspace come back as `duplicate` with the original's
// id and no second raw object. A rejected upload is deleted and the capture marked `failed`.
// A capture of another workspace (or another member) reads as 404.
import { completeUpload } from '@causedeck/core/capture';
import { CaptureCompleteRequestSchema } from '@causedeck/validators';
import { z } from 'zod';

import {
  captureError,
  captureRequest,
  crossOrigin,
  json,
} from '../../../../../lib/capture-http.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return json(404, { error: 'not_found' });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const parsed = CaptureCompleteRequestSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid_request' });

  const ctx = await captureRequest(request, parsed.data.workspaceId);
  if (ctx instanceof Response) return ctx;
  try {
    return json(200, await completeUpload(ctx, id.data, parsed.data.sha256));
  } catch (error) {
    return captureError(error);
  }
}
