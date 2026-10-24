// `/w/[slug]/inbox` (#48): the capture inbox. Needs you (open proposals, conflicts, unreadable
// captures), Ready to send (outward drafts from the registered providers; the lawyer sends them)
// and Processing (captures in flight). The inbox is read in the member's workspace scope
// (`getInbox`): restricted matters, sensitive content and strategy/memory items are already
// filtered by what their role may read. A non-member gets not-found, a viewer read-only cards.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { InboxShell } from '../../../../../components/inbox/inbox-shell.tsx';
import { listReadyItems } from '../../../../../lib/inbox/ready-providers.ts';
import { graphDeps } from '../../../../../lib/matters/graph-deps.ts';
import { toInboxView, type ChannelView } from '../../../../../lib/inbox/view.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

interface InboxPageProps {
  params: Promise<{ slug: string }>;
}

const CHANNELS = ['share', 'voice', 'upload'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inbox');
  return { title: t('metaTitle') };
}

async function loadChannels(scope: {
  workspaceId: string;
  userId: string;
}): Promise<ChannelView[]> {
  const runtime = await import('@causedeck/core/runtime');
  const { listChannels } = await import('@causedeck/core/capture');
  const states = await runtime.inWorkspace(scope, (tx) => listChannels(tx, scope.workspaceId));
  return CHANNELS.map((channel) => ({
    channel,
    enabled: states.find((state) => state.channel === channel)?.enabled ?? false,
  }));
}

export default async function InboxPage({ params }: InboxPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('inbox');
  if (!can(context.role, 'matter.read')) return <PermissionDenied message={t('denied')} />;

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  // Imported one after the other: concurrent dynamic imports of core race the test mocks.
  const runtime = await import('@causedeck/core/runtime');
  const { getInbox } = await import('@causedeck/core/automation');
  const [inbox, ready, channels] = await Promise.all([
    runtime.inWorkspace(scope, (tx) => getInbox(graphDeps(tx), scope)),
    listReadyItems(scope),
    loadChannels(scope),
  ]);
  return (
    <InboxShell
      view={toInboxView(inbox, ready, channels)}
      workspaceId={context.workspace.id}
      slug={slug}
    />
  );
}
