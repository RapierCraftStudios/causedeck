// Shared HTTP plumbing of the capture routes (#43): `/api/captures/presign`, `/api/captures/[id]/complete`
// and the multipart fallback `/api/captures`. Same gates as `/api/uploads`: 403 cross-origin, 401
// signed out, 404 not a member of the workspace, 429 over the per-user rate limit.
import { isRole } from '@causedeck/auth';
import { ForbiddenError, assertCan } from '@causedeck/auth/policy';
import { CaptureTooLargeError, UnsupportedTypeError } from '@causedeck/capture';
import type { CaptureCtx } from '@causedeck/core/capture';
import { captureContext, consumeRequestLimit, memberRoleFor } from '@causedeck/core/runtime';
import { isUploadError } from '@causedeck/storage';

import { getSession } from './auth.ts';
import { serverEnv } from './env.ts';
import { objectStore } from './storage.ts';

/** Per user, across workspaces: presigns, completes and multipart uploads together. */
export const CAPTURE_RATE_LIMIT = { max: 120, windowSeconds: 10 * 60 } as const;

export const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'x-content-type-options': 'nosniff' } });

/** A browser request from another site carries an `Origin` that is neither ours nor `APP_URL`. */
export function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  return origin !== new URL(request.url).origin && origin !== new URL(serverEnv().APP_URL).origin;
}

/** The gates every capture route shares; a `Response` when one refuses the request. */
export async function captureRequest(
  request: Request,
  workspaceId: string,
): Promise<Response | CaptureCtx> {
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const userId = session.user.id;
  // Not a member reads exactly like another workspace's capture: nothing to see here.
  const role = await memberRoleFor(userId, workspaceId);
  if (role === null || !isRole(role)) return json(404, { error: 'not_found' });
  if (!(await consumeRequestLimit(`captures:${userId}`, CAPTURE_RATE_LIMIT))) {
    return json(429, { error: 'rate_limited' });
  }
  const requestId = request.headers.get('x-request-id');
  const userAgent = request.headers.get('user-agent');
  return captureContext({
    store: objectStore(),
    workspaceId,
    userId,
    authorize: (action) => {
      assertCan({ userId, workspaceId, role }, action);
    },
    ...(requestId === null ? {} : { requestId }),
    ...(userAgent === null ? {} : { userAgent }),
  });
}

const UPLOAD_STATUS = { NOT_FOUND: 404, VALIDATION: 400, FORBIDDEN: 403, TOO_LARGE: 413 } as const;
const WORKSPACE_STATUS = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  VALIDATION: 400,
  RATE_LIMITED: 429,
} as const;

/** Map a capture failure to a client-safe response; unknown errors are rethrown. */
export function captureError(error: unknown): Response {
  if (error instanceof ForbiddenError) return json(403, { error: 'forbidden' });
  if (error instanceof UnsupportedTypeError) {
    return json(415, { error: 'unsupported_type', reason: error.reason, message: error.message });
  }
  if (error instanceof CaptureTooLargeError) {
    return json(413, { error: 'too_large', message: error.message });
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'CHANNEL_DISABLED') return json(403, { error: 'channel_disabled' });
    if (code === 'SENSITIVE_MATTER_EXCLUDED') {
      return json(403, { error: 'sensitive_matter_excluded' });
    }
    if (error.name === 'WorkspaceError' && typeof code === 'string' && code in WORKSPACE_STATUS) {
      return json(WORKSPACE_STATUS[code as keyof typeof WORKSPACE_STATUS], {
        error: code.toLowerCase(),
        message: error.message,
      });
    }
  }
  if (isUploadError(error)) {
    return json(UPLOAD_STATUS[error.code], {
      error: error.code.toLowerCase(),
      message: error.message,
    });
  }
  throw error;
}
