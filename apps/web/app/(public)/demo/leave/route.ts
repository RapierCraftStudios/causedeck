// `POST /demo/leave` (#93): the demo banner's `Leave demo` and `Start your own workspace` buttons.
// Ends the visitor's session (Better Auth `/sign-out`), clears its cookies and sends the browser to
// sign-in, where a new account starts its own workspace. Safe to call without a session.
import { getAuth } from '../../../../lib/auth.ts';
import { serverEnv } from '../../../../lib/env.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(serverEnv().APP_URL).origin;
  const headers = new Headers({ 'content-type': 'application/json', origin });
  const cookie = request.headers.get('cookie');
  if (cookie !== null) headers.set('cookie', cookie);
  const result = await getAuth().handler(
    new Request(`${origin}/api/auth/sign-out`, { method: 'POST', headers, body: '{}' }),
  );
  const response = new Response(null, {
    status: 303,
    headers: { location: new URL('/sign-in', request.url).toString() },
  });
  for (const set of result.headers.getSetCookie()) response.headers.append('set-cookie', set);
  return response;
}
