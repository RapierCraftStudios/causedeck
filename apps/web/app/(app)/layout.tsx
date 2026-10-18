import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession } from '../../lib/auth.ts';
import { signInPathFor } from '../../lib/safe-next.ts';

/**
 * Signed-in routes (`/w/**`, `/account`). The proxy only checks that a session cookie exists; this
 * layout validates the session itself and sends anyone without one to `/sign-in?next=`.
 * TODO(#18): once memberships exist, send users with no workspace to onboarding (Launch) and
 * users on a bare `/w` to their last workspace.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect(signInPathFor((await headers()).get('x-pathname')));
  return children;
}
