// `POST /api/push/unsubscribe` (#197): revoke the signed-in user's subscription for `{ endpoint }`.
// Only the caller's own subscription is touched; an unknown endpoint is not an error (idempotent).
import { unsubscribePush } from '@causedeck/core/runtime';
import { pushUnsubscribeInput } from '@causedeck/notifications/push';

import { getSession } from '../../../../lib/auth.ts';
import { serverEnv } from '../../../../lib/env.ts';

export const dynamic = 'force-dynamic';

const json = (status: number, body: object) => Response.json(body, { status });

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

  const parsed = pushUnsubscribeInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: 'invalid_request' });
  const revoked = await unsubscribePush(session.user.id, parsed.data.endpoint);
  return json(200, { ok: true, revoked });
}
