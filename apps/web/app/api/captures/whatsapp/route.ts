// `POST /api/captures/whatsapp` (#526): the WhatsApp chat import. The body is JSON:
// `{ workspaceId, chatTitleHash, chatType, dateOrder, messages: [{ id, ts, sender, text, mediaRef? }],
// openedFor?, confirmedIds?, matterHintId? }`. The browser parsed and filtered the export (#527); the
// server re-applies the exclusion rules and limits, stores the selected messages only and queues the
// chat for structuring → 201 `{ captureId, status, stored, excluded, duplicateOf? }`. Same gates and
// errors as the other capture routes, plus 404 while the `capture.whatsapp-import` flag is off.
import { receiveWhatsAppImport } from '@causedeck/core/whatsapp';
import { z } from 'zod';

import { captureError, captureRequest, crossOrigin, json } from '../../../../lib/capture-http.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The most a chat import body may be; a chat export is capped at 5 MB of text. */
export const WHATSAPP_BODY_MAX_BYTES = 6 * 1024 * 1024;

const Workspace = z.object({ workspaceId: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > WHATSAPP_BODY_MAX_BYTES) {
    return json(413, { error: 'too_large' });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const { workspaceId, ...rest } = (body ?? {}) as Record<string, unknown>;
  const workspace = Workspace.safeParse({ workspaceId });
  if (!workspace.success) return json(400, { error: 'invalid_request' });

  const ctx = await captureRequest(request, workspace.data.workspaceId);
  if (ctx instanceof Response) return ctx;
  const { isEnabled } = await import('@causedeck/flags/server');
  if (
    !(await isEnabled('capture.whatsapp-import', {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    }))
  ) {
    return json(404, { error: 'not_found' });
  }
  try {
    const done = await receiveWhatsAppImport(ctx, rest);
    return json(201, done);
  } catch (error) {
    return captureError(error);
  }
}
