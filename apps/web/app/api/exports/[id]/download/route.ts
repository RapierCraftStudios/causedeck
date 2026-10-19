// `/api/exports/[id]/download` (#301): download a workspace data export.
// - `POST` (same-origin, `{ workspaceId }`): session, then workspace membership (`guard`), then
//   core `issueExportDownload` through `issueExportDownloadFor` (owner, requester of this export, ready, not expired) records
//   `export.download_link_issued` and returns a signed link valid until the export expires (24 h
//   after it was ready). A new link revokes the previous one.
// - `GET ?token=`: the token is HMAC-signed over the export, workspace, requester, expiry and a
//   256-bit nonce whose hash is stored on the export. Core `openExportDownload` checks it against
//   the session user, records `export.downloaded` before the first byte, and the decrypted ZIP
//   streams as an attachment, never buffered, cached or sniffed.
// 401 signed out, 403 cross-origin, not a member or not an owner, 404 not the requester, wrong,
// revoked or expired token, 400 bad input. Export contents never reach a log.
import { readExportToken } from '@causedeck/core/lifecycle';
import { issueExportDownloadFor, openExportDownloadFor } from '@causedeck/core/runtime';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { attachmentDisposition, EnvKeyProvider, type KeyProvider } from '@causedeck/storage';
import { z } from 'zod';

import { getSession, type AppSession } from '../../../../../lib/auth.ts';
import { serverEnv } from '../../../../../lib/env.ts';
import { guard, guardResponse } from '../../../../../lib/guard.ts';
import { objectStore } from '../../../../../lib/storage.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const secret = () => serverEnv().BETTER_AUTH_SECRET.reveal();

let keys: KeyProvider | undefined;
const keyProvider = (): KeyProvider => (keys ??= EnvKeyProvider.fromEnv(serverEnv()));

/** A browser request from another site carries an `Origin` that is neither ours nor `APP_URL`. */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  return origin !== new URL(request.url).origin && origin !== new URL(serverEnv().APP_URL).origin;
}

/** The client IP as the edge proxy reports it (first `X-Forwarded-For` hop). */
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || undefined;
}

function requestFields(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const ip = clientIp(request);
  return {
    ...(requestId === undefined ? {} : { requestId }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(ip === undefined ? {} : { ip }),
  };
}

/** Core errors as responses; `null` for anything else (rethrow it). */
function coreResponse(error: unknown): Response | null {
  if (!(error instanceof WorkspaceError)) return null;
  if (error.code === 'NOT_FOUND') return json(404, { error: 'not_found' });
  if (error.code === 'FORBIDDEN') return json(403, { error: 'forbidden' });
  if (error.code === 'VALIDATION') return json(400, { error: 'invalid' });
  return null;
}

const idSchema = z.uuid();
const bodySchema = z.object({ workspaceId: z.uuid() }).strict();

/** Membership through the server guard; core checks owner and requester. */
async function member(workspaceId: string, session: AppSession) {
  try {
    return { userId: (await guard({ workspaceId, session })).userId };
  } catch (error) {
    const response = guardResponse(error);
    if (response) return { response };
    throw error;
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return json(404, { error: 'not_found' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid' });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid' });
  const { workspaceId } = parsed.data;

  const access = await member(workspaceId, session);
  if ('response' in access) return access.response;

  try {
    const link = await issueExportDownloadFor(
      { workspaceId, userId: access.userId, ...requestFields(request) },
      id,
      { secret: secret() },
    );
    return json(
      200,
      {
        url: `/api/exports/${id}/download?token=${encodeURIComponent(link.token)}`,
        expiresAt: link.expiresAt.toISOString(),
      },
      { 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    const response = coreResponse(error);
    if (response) return response;
    throw error;
  }
}

/** A web stream over an async iterable, pulled one chunk at a time (no buffering). */
function toStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const { id } = await params;
  const token = new URL(request.url).searchParams.get('token');
  const payload = token === null ? null : readExportToken(token, secret());
  if (token === null || payload === null || payload.j !== id || payload.u !== session.user.id) {
    return json(404, { error: 'not_found' });
  }

  const access = await member(payload.w, session);
  if ('response' in access) return access.response;

  let download: Awaited<ReturnType<typeof openExportDownloadFor>>;
  try {
    download = await openExportDownloadFor(
      { workspaceId: payload.w, userId: access.userId, ...requestFields(request) },
      id,
      token,
      { store: objectStore(), keys: keyProvider(), secret: secret() },
    );
  } catch (error) {
    const response = coreResponse(error);
    if (response) return response;
    throw error;
  }

  return new Response(toStream(download.body), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentDisposition(download.filename),
      'Content-Length': String(download.sizeBytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
