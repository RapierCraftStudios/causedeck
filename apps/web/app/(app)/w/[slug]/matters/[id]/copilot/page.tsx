// `/w/[slug]/matters/[id]/copilot` (#1115, ADR 0051): ask a question about this matter and get claims
// each with a verified quote from a fact, a document page or the judgment corpus. The
// `copilot.enabled` flag is checked first: off, the route is a plain 404. Needs `matter.read`; another
// workspace's matter is this segment's not-found screen. A sensitive matter shows that AI is off.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CopilotPanel } from '../../../../../../../components/copilot/copilot-panel.tsx';
import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { requireWorkspaceFlag } from '../../../../../../../lib/flags.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';

import { askCopilotAction } from './actions.ts';

interface CopilotPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('research.copilot');
  return { title: t('metaTitle') };
}

export default async function MatterCopilotPage({ params }: CopilotPageProps) {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('copilot.enabled', context);
  if (!can(context.role, 'matter.read')) return <MattersPermissionDenied />;
  const t = await getTranslations('research.copilot');
  return (
    <section
      data-route="matter-copilot"
      className="flex flex-col gap-6"
      aria-labelledby="copilot-title"
    >
      <header className="flex flex-col gap-1">
        <h1 id="copilot-title" className="font-serif text-2xl font-medium">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('matterIntro')}</p>
      </header>
      <CopilotPanel workspaceId={context.workspace.id} matterId={id} ask={askCopilotAction} />
    </section>
  );
}
