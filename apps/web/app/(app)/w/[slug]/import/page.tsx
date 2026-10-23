// `/w/[slug]/import` (#552, #57 part 6): the bootstrap import. Drop cause lists, orders and diary
// photos; the stepper uploads them as `bulk_import` captures and shows the batch being read. It
// needs `matter.write` (every import action does); clerks and viewers get permission-denied. The
// `bulk_import` channel is opt-in (#43): the page reads its state and a workspace manager can
// turn it on from here. Applying the plan is the confirm grid (#551).
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BootstrapImport } from '../../../../../components/import/bootstrap-import.tsx';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

interface ImportPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bootstrapImport');
  return { title: t('metaTitle') };
}

export default async function ImportPage({ params }: ImportPageProps) {
  const { slug } = await params;
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('bootstrapImport');
  if (!can(context.role, 'matter.write')) return <PermissionDenied message={t('denied')} />;

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  // Imported one after the other: concurrent dynamic imports of core race the test mocks.
  const runtime = await import('@causedeck/core/runtime');
  const { CAPTURE_DISCLOSURE_VERSION, listChannels } = await import('@causedeck/core/capture');
  const states = await runtime.inWorkspace(scope, (tx) => listChannels(tx, scope.workspaceId));
  const enabled = states.find((state) => state.channel === 'bulk_import')?.enabled ?? false;

  return (
    <div data-route="import" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <BootstrapImport
        workspaceId={context.workspace.id}
        channelEnabled={enabled}
        canEnableChannel={can(context.role, 'workspace.manage')}
        disclosureVersion={CAPTURE_DISCLOSURE_VERSION}
      />
    </div>
  );
}
