// `POST /api/uploads` (#217): workspace-scoped uploads and download URLs. One JSON body, by action:
//   intent    { workspaceId, kind, filename, size, mime } → presigned PUT (5 min)    document.write
//   finalize  { workspaceId, blobId }                       → sniffed, hashed, pending  document.write
//   download  { workspaceId, blobId }                       → presigned GET (60 s)      document.read
// 403 cross-origin, 401 signed out, 404 not a member of the workspace (or not its blob), 429 over
// the per-user rate limit, 400 invalid input or file, 413 over the size cap, 403 not permitted.
import { isRole } from '@causedeck/auth';
import { ForbiddenError, assertCan } from '@causedeck/auth/policy';
import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { memberRole } from '@causedeck/core/workspaces';
import { db } from '@causedeck/db';
import {
  createDownloadUrl,
  createUploadIntent,
  finalizeUpload,
  isUploadError,
  OBJECT_KINDS,
  type StorageCtx,
} from '@causedeck/storage';
import { z } from 'zod';

import { getSession } from '../../../lib/auth.ts';
import { serverEnv } from '../../../lib/env.ts';
import { objectStore } from '../../../lib/storage.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Per user, across workspaces: intents, finalizes and download URLs together. */
export const UPLOAD_RATE_LIMIT = { max: 120, windowSeconds: 10 * 60 } as const;

const scoped = { workspaceId: z.uuid() };
const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('intent'),
    ...scoped,
    kind: z.enum(OBJECT_KINDS),
    filename: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
    mime: z.string().min(1).max(255),
  }),
  z.object({ action: z.literal('finalize'), ...scoped, blobId: z.uuid() }),
  z.object({ action: z.literal('download'), ...scoped, blobId: z.uuid() }),
]);

const STATUS = { NOT_FOUND: 404, VALIDATION: 400, FORBIDDEN: 403, TOO_LARGE: 413 } as const;

const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'x-content-type-options': 'nosniff' } });

/** A browser request from another site carries an `Origin` that is neither ours nor `APP_URL`. */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  return origin !== new URL(request.url).origin && origin !== new URL(serverEnv().APP_URL).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const userId = session.user.id;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid_request' });
  const input = parsed.data;
  const { workspaceId } = input;

  // Not a member reads exactly like another workspace's blob: nothing to see here.
  const role = await memberRole(db, userId, workspaceId);
  if (role === null || !isRole(role)) return json(404, { error: 'not_found' });
  if (!(await consumeRateLimit(db, `uploads:${userId}`, UPLOAD_RATE_LIMIT))) {
    return json(429, { error: 'rate_limited' });
  }

  const ctx: StorageCtx = {
    db,
    store: objectStore(),
    workspaceId,
    userId,
    authorize: (action) => {
      assertCan({ userId, workspaceId, role }, action);
    },
  };
  try {
    switch (input.action) {
      case 'intent': {
        const { blobId, upload } = await createUploadIntent(ctx, input);
        return json(201, { blobId, upload });
      }
      case 'finalize':
        return json(200, await finalizeUpload(ctx, input.blobId));
      case 'download': {
        const { url, expiresAt } = await createDownloadUrl(ctx, input.blobId);
        return json(200, { url, expiresAt });
      }
    }
  } catch (error) {
    if (error instanceof ForbiddenError) return json(403, { error: 'forbidden' });
    if (isUploadError(error)) {
      return json(STATUS[error.code], { error: error.code.toLowerCase(), message: error.message });
    }
    throw error;
  }
}
