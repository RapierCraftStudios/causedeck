// `GET /api/ics/[token]` (#53; PRD CA-5): the private calendar feed. The token in the URL is the
// credential (32 random bytes; only its sha256 is stored), so the route has no session and treats
// every miss the same: an unknown, revoked, flag-off or no-longer-permitted feed is a bodyless 404.
// 200 `text/calendar; charset=utf-8` with an ETag (304 on `If-None-Match`), 429 over 60 requests per
// hour per feed. `Cache-Control: private` keeps shared caches from storing it, and the response sets
// no cookie and loads nothing from elsewhere. Read-only by construction: only GET is exported, so
// there is no write-back, invitation or message of any kind.
import { serveFeed } from '@causedeck/core/calendar';
import { consumeRequestLimit, db } from '@causedeck/core/runtime';

import { serverEnv } from '../../../../lib/env.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, max-age=300',
} as const;

const notFound = () =>
  new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

async function flagOn(scope: { workspaceId: string; userId: string }): Promise<boolean> {
  const { isFlagOffError, requireFlag } = await import('@causedeck/flags/server');
  try {
    await requireFlag('capture.ics-feed', scope);
    return true;
  } catch (error) {
    if (isFlagOffError(error)) return false;
    throw error;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const result = await serveFeed(
    { db, limit: consumeRequestLimit, enabled: flagOn, appUrl: serverEnv().APP_URL },
    { token, ifNoneMatch: request.headers.get('if-none-match') },
  );
  switch (result.status) {
    case 404:
      return notFound();
    case 429:
      return new Response(null, {
        status: 429,
        headers: { 'retry-after': String(result.retryAfterSec), 'cache-control': 'no-store' },
      });
    case 304:
      return new Response(null, { status: 304, headers: { ...HEADERS, etag: result.etag } });
    case 200:
      return new Response(result.body, {
        status: 200,
        headers: {
          ...HEADERS,
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'inline; filename="causedeck-hearings.ics"',
          etag: result.etag,
        },
      });
  }
}
