// `/w/[slug]/matters/[id]/memory` (#73): the memory tab. The same cards as the memory screen,
// filtered to this matter; `listMemoryWithUsage` pins the matter, and the filter below keeps only
// items of it, so another matter's items cannot appear. Needs `memory.read`.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MemoryCards } from '../../../memory/_components/memory-cards.tsx';
import { toCardView } from '../../../../../../../lib/memory/memory-state.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';
import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';

interface MatterMemoryPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('memory');
  return { title: t('metaTitle') };
}

export default async function MatterMemoryPage({ params }: MatterMemoryPageProps) {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'memory.read')) return <MattersPermissionDenied />;

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const { inWorkspace } = await import('@causedeck/core/runtime');
  const { listMemoryWithUsage } = await import('@causedeck/core/memory');
  let items;
  try {
    items = await inWorkspace(scope, (tx) =>
      listMemoryWithUsage({ db: tx }, scope, { matterId: id }),
    );
  } catch {
    notFound();
  }
  const cards = items.filter((item) => item.matterId === id).map(toCardView);
  const t = await getTranslations('memory.matter');
  return (
    <section className="flex flex-col gap-4" aria-labelledby="matter-memory-title">
      <header className="flex flex-col gap-1">
        <h2 id="matter-memory-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </header>
      {cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <MemoryCards
          workspaceId={context.workspace.id}
          slug={slug}
          cards={cards}
          canWrite={can(context.role, 'memory.write')}
          isOwner={context.role === 'owner'}
          offline={false}
        />
      )}
    </section>
  );
}
