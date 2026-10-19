// `/api/audit/export` (#229): download a date range of the workspace audit log as CSV or JSON
// Lines. `POST` checks session, membership and `audit.read` (owners; advocates unless the
// workspace turned it off) and returns a signed link valid for 60 s; `GET ?token=` re-checks the
// permission, records `audit.exported` and streams the file page by page (never buffered).
// 401 signed out or bad token, 403 cross-origin or forbidden, 404 not a member, 400 bad input.
import { authorizeAuditReadFor, exportAuditFor } from '@causedeck/core/runtime';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { z } from 'zod';

import {
  EXPORT_TOKEN_TTL_MS,
  signExportToken,
  verifyExportToken,
} from '../../../../lib/audit-export-token.ts';
import { getSession } from '../../../../lib/auth.ts';
import { serverEnv } from '../../../../lib/env.ts';
import { guard, guardResponse } from '../../../../lib/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

/** A browser request from another site carries an `Origin` that is neither ours nor `APP_URL`. */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  return origin !== new URL(request.url).origin && origin !== new URL(serverEnv().APP_URL).origin;
}

const bodySchema = z
  .object({
    workspaceId: z.uuid(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    format: z.enum(['csv', 'jsonl']),
    bom: z.boolean().optional(),
  })
  .refine((b) => Date.parse(b.from) < Date.parse(b.to), { path: ['to'] });

/** The core read gate's errors as responses; `null` for anything else (rethrow it). */
function coreResponse(error: unknown): Response | null {
  if (!(error instanceof WorkspaceError)) return null;
  if (error.code === 'NOT_FOUND') return json(404, { error: 'not_found' });
  if (error.code === 'FORBIDDEN') return json(403, { error: 'forbidden' });
  if (error.code === 'VALIDATION') return json(400, { error: 'invalid' });
  return null;
}

const secret = () => serverEnv().BETTER_AUTH_SECRET.reveal();

export async function POST(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid' });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid' });
  const body = parsed.data;

  let userId: string;
  try {
    ({ userId } = await guard({ workspaceId: body.workspaceId, session }));
  } catch (error) {
    const response = guardResponse(error);
    if (response) return response;
    throw error;
  }
  try {
    // The advocate setting lives in core; `guard` alone only checks the role matrix.
    await authorizeAuditReadFor({ workspaceId: body.workspaceId, userId });
  } catch (error) {
    const response = coreResponse(error);
    if (response) return response;
    throw error;
  }

  const now = Date.now();
  const exp = now + EXPORT_TOKEN_TTL_MS;
  const token = signExportToken(
    {
      w: body.workspaceId,
      u: userId,
      from: new Date(body.from).toISOString(),
      to: new Date(body.to).toISOString(),
      format: body.format,
      bom: body.bom ?? false,
      exp,
    },
    secret(),
    now,
  );
  return json(
    200,
    {
      url: `/api/audit/export?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(exp).toISOString(),
    },
    { 'Cache-Control': 'no-store' },
  );
}

/** The client IP as the edge proxy reports it (first `X-Forwarded-For` hop). */
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || undefined;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const token = new URL(request.url).searchParams.get('token');
  const payload = token === null ? null : verifyExportToken(token, secret(), Date.now());
  if (!payload || payload.u !== session.user.id) return json(401, { error: 'invalid_token' });

  const requestId = request.headers.get('x-request-id') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const ip = clientIp(request);
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await exportAuditFor(
      {
        workspaceId: payload.w,
        userId: payload.u,
        ...(requestId === undefined ? {} : { requestId }),
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(ip === undefined ? {} : { ip }),
      },
      {
        from: new Date(payload.from),
        to: new Date(payload.to),
        format: payload.format,
        bom: payload.bom,
      },
    );
  } catch (error) {
    const response = coreResponse(error);
    if (response) return response;
    throw error;
  }

  const csv = payload.format === 'csv';
  const filename = `audit-${payload.from.slice(0, 10)}-${payload.to.slice(0, 10)}.${payload.format}`;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
