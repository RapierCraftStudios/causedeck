// Better Auth endpoints of the admin instance. proxy.ts opens only the sign-in subset (lib/gate.ts);
// every other `/api/auth/*` path is the generic 404 before it reaches this handler.
import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '../../../../lib/auth.ts';

export const dynamic = 'force-dynamic';

const handler = (request: Request): Promise<Response> => toNextJsHandler(getAuth()).GET(request);

export const GET = handler;
export const POST = handler;
