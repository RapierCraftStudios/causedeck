// `/settings/notifications` (#199): the workspace-less link in every notification email footer
// (`preferencesUrl`, packages/notifications/src/email/render.ts). Sends the member to the
// preferences page of their landing workspace (last opened, else first), or to onboarding when they
// belong to none. A signed-out visitor never gets here: the `(app)` layout sends them to
// `/sign-in?next=/settings/notifications` first.
import { redirect } from 'next/navigation';

import { getHomeSession } from '../../../../lib/home-route.ts';
import { signInPathFor } from '../../../../lib/safe-next.ts';

const PATH = '/settings/notifications';

export default async function NotificationSettingsRedirect(): Promise<never> {
  const session = await getHomeSession();
  if (!session) redirect(signInPathFor(PATH));
  if (!session.lastWorkspaceSlug) redirect('/onboarding');
  redirect(`/w/${encodeURIComponent(session.lastWorkspaceSlug)}${PATH}`);
}
