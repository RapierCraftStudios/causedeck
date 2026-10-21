// `/w/[slug]/settings` (#284): no page of its own. It redirects to the first section the role may
// open: the workspace profile for clerks and up (`settings.read`), members for viewers. The
// sidebar's Settings item, the `g s` chord and the palette all land here.
import { notFound, redirect } from 'next/navigation';

import { settingsHref, settingsLanding } from '../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

interface SettingsIndexProps {
  params: Promise<{ slug: string }>;
}

export default async function SettingsIndex({ params }: SettingsIndexProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  redirect(settingsHref(context.workspace.slug, settingsLanding(context.role)));
}
