// Better Auth endpoints under `/api/auth/*` (magic link, passkeys, Google, organizations, sessions).
// The handler is resolved per request so building the route never constructs `auth`.
import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '../../../../lib/auth.ts';

export const dynamic = 'force-dynamic';

const handler = (request: Request): Promise<Response> => toNextJsHandler(getAuth()).GET(request);

export const GET = handler;
export const POST = handler;
