// `/w/[slug]/copilot` (#1115): the workspace-level copilot, answering from the anonymised judgment
// corpus only (no matter facts or documents). Gated by `copilot.enabled` (off: plain 404) and
// `matter.read`. #1168: the thread and composer take the main column; from `lg` up the sources of the
// selected answer sit in a rail beside it (inside the panel).
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CopilotPanel } from '../../../../../components/copilot/copilot-panel.tsx';
import { requireWorkspaceFlag } from '../../../../../lib/flags.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { askCopilotAction } from '../matters/[id]/copilot/actions.ts';

interface CopilotPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CopilotPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('research.copilot');
  // Authenticated page: canonical points at itself and the page is kept out of search indexes.
  return {
    title: t('metaTitle'),
    alternates: { canonical: `/w/${slug}/copilot` },
    robots: { index: false, follow: false },
  };
}

export default async function CopilotPage({ params }: CopilotPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('copilot.enabled', context);
  const t = await getTranslations('research.copilot');
  if (!can(context.role, 'matter.read')) return <PermissionDenied message={t('denied')} />;
  return (
    <section
      data-route="copilot"
      className="flex min-w-0 flex-col gap-6"
      aria-labelledby="copilot-title"
    >
      <header className="flex flex-col gap-1">
        <h1 id="copilot-title" className="font-serif text-2xl font-medium">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </header>
      <CopilotPanel
        workspaceId={context.workspace.id}
        workspaceSlug={slug}
        ask={askCopilotAction}
      />
    </section>
  );
}
