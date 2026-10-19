// `POST /api/push/subscribe` (#197): store the signed-in user's browser push subscription
// (`PushSubscription.toJSON()`). 401 signed out, 403 cross-origin, 503 when push is disabled (no
// VAPID keys), 400 for a malformed subscription. Subscriptions belong to the user, not a workspace.
import { subscribePush } from '@causedeck/core/runtime';
import { NotificationError } from '@causedeck/notifications';
import { pushConfig } from '@causedeck/notifications/push';

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
  if (pushConfig(serverEnv()) === null) return json(503, { error: 'push_disabled' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid_subscription' });
  }
  try {
    await subscribePush(session.user.id, body, request.headers.get('user-agent'));
  } catch (error) {
    if (error instanceof NotificationError && error.code === 'VALIDATION') {
      return json(400, { error: 'invalid_subscription' });
    }
    throw error;
  }
  return json(201, { ok: true });
}
