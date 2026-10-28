// `/w/[slug]/memory/precedents` (#903): the lawyer's saved precedent passages and the pending
// suggestions from their own exported drafts. Gated by the `m5_playbooks` flag (404 when off); a
// role without `memory.read` (a clerk) gets the permission-denied explanation, never an empty list.
// In development `?__state=loading|error|denied|offline|empty` previews a state.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDev } from '../../../../../../lib/env.ts';
import { requireWorkspaceFlag } from '../../../../../../lib/flags.ts';
import { memoryDeps } from '../../../../../../lib/memory/deps.ts';
import {
  lastUsedById,
  splitProposals,
  toPrecedentCard,
} from '../../../../../../lib/memory/m5-state.ts';
import { valueText } from '../../../../../../lib/memory/memory-state.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { PrecedentsScreen } from './_components/precedents-screen.tsx';
import PrecedentsLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface PrecedentsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('memoryM5.precedents');
  return { title: t('metaTitle') };
}

export default async function PrecedentsPage({ params, searchParams }: PrecedentsPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('m5_playbooks', context);
  const t = await getTranslations('memoryM5');
  const preview = isDev() ? [query.__state].flat()[0] : undefined;
  if (preview === 'loading') return <PrecedentsLoading />;
  if (preview === 'error') throw new Error('Precedents preview error');
  if (preview === 'denied' || !can(context.role, 'memory.read')) {
    return <PermissionDenied message={t('denied')} />;
  }

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const runtime = await import('@causedeck/core/runtime');
  const memory = await import('@causedeck/core/memory');
  const { passages, proposals, usage } = await runtime.inWorkspace(scope, async (tx) => {
    const deps = memoryDeps(tx);
    // One after the other: they share the workspace transaction.
    const p = await memory.listPrecedents(deps, scope);
    const q = await memory.listMemoryProposals(deps, scope);
    const u = await memory.listMemoryWithUsage(deps, scope, { layers: ['M5'] });
    return { passages: p, proposals: q, usage: u };
  });
  const empty = preview === 'empty';
  const lastUsed = lastUsedById(usage);
  return (
    <div data-route="memory-precedents" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('precedents.title')}</h1>
        <p className="text-ink-muted text-sm">{t('precedents.hint')}</p>
      </header>
      <PrecedentsScreen
        workspaceId={context.workspace.id}
        canWrite={can(context.role, 'memory.write')}
        forceOffline={preview === 'offline'}
        cards={empty ? [] : passages.map((p) => toPrecedentCard(p, lastUsed))}
        proposals={
          empty
            ? []
            : splitProposals(proposals).precedents.map((p) => ({
                id: p.id,
                text: valueText(p.proposedValue),
              }))
        }
      />
    </div>
  );
}
