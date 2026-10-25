import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession } from '../../lib/auth.ts';
import { signInPathFor } from '../../lib/safe-next.ts';

/**
 * Signed-in routes (`/w/**`, `/account`). The proxy only checks that a session cookie exists; this
 * layout validates the session itself and sends anyone without one to `/sign-in?next=`.
 * Workspace landing (#179) happens closer to the data: `/` (lib/home-route.ts) sends a user to their
 * last workspace (`cd_last_ws`) or to `/onboarding` when they have none, `proxy.ts` sends a bare
 * `/w` to `/`, and the workspace layout sends a user with no workspace to `/onboarding`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect(signInPathFor((await headers()).get('x-pathname')));
  return children;
}
