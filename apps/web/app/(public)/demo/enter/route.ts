// `POST /demo/enter` (#93): start a demo session. The entry cards on `/demo` post here with the
// chosen workspace; this opens the 4-hour visitor session through Better Auth's demo sign-in
// (`/api/auth/demo/sign-in`, rate limited per IP), copies its cookies onto a redirect to the demo
// workspace, and sends any failure back to `/demo` with a reason. A POST, so a crawler following
// links never creates a visitor.
import { DEMO_SIGN_IN_PATH } from '@causedeck/auth/demo-provider';

import { getAuth } from '../../../../lib/auth.ts';
import { serverEnv } from '../../../../lib/env.ts';

export const dynamic = 'force-dynamic';

function back(request: Request, reason: 'error' | 'busy' | 'unavailable'): Response {
  return Response.redirect(new URL(`/demo?error=${reason}`, request.url), 303);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const workspace = form?.get('workspace');
  if (typeof workspace !== 'string' || workspace === '') return back(request, 'error');

  const origin = new URL(serverEnv().APP_URL).origin;
  const headers = new Headers({ 'content-type': 'application/json', origin });
  // The visitor's own address, for the per-IP limit and the session record.
  for (const name of ['x-forwarded-for', 'x-real-ip', 'user-agent']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const result = await getAuth().handler(
    new Request(`${origin}/api/auth${DEMO_SIGN_IN_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspace }),
    }),
  );
  if (result.status === 429) return back(request, 'busy');
  if (result.status === 404) return back(request, 'unavailable');
  if (!result.ok) return back(request, 'error');

  const { slug } = (await result.json()) as { slug?: unknown };
  if (typeof slug !== 'string') return back(request, 'error');
  const response = new Response(null, {
    status: 303,
    headers: { location: new URL(`/w/${slug}`, request.url).toString() },
  });
  for (const cookie of result.headers.getSetCookie()) response.headers.append('set-cookie', cookie);
  return response;
}
