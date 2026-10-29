// `/w/[slug]/memory/playbooks` (#903): the lawyer's playbooks (preferred format per court, standard
// prayers, annexure order) and the pending ones awaiting confirmation. Gated by the `m5_playbooks`
// flag (404 when off); a role without `memory.read` gets the permission-denied explanation. In
// development `?__state=loading|error|denied|offline|empty` previews a state.
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
  toPlaybookCard,
} from '../../../../../../lib/memory/m5-state.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { PlaybooksScreen } from './_components/playbooks-screen.tsx';
import PlaybooksLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface PlaybooksPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('memoryM5.playbooks');
  return { title: t('metaTitle') };
}

export default async function PlaybooksPage({ params, searchParams }: PlaybooksPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('m5_playbooks', context);
  const t = await getTranslations('memoryM5');
  const preview = isDev() ? [query.__state].flat()[0] : undefined;
  if (preview === 'loading') return <PlaybooksLoading />;
  if (preview === 'error') throw new Error('Playbooks preview error');
  if (preview === 'denied' || !can(context.role, 'memory.read')) {
    return <PermissionDenied message={t('denied')} />;
  }

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const runtime = await import('@causedeck/core/runtime');
  const memory = await import('@causedeck/core/memory');
  const { playbooks, proposals, usage } = await runtime.inWorkspace(scope, async (tx) => {
    const deps = memoryDeps(tx);
    // One after the other: they share the workspace transaction.
    const p = await memory.listPlaybooks(deps, scope);
    const q = await memory.listMemoryProposals(deps, scope);
    const u = await memory.listMemoryWithUsage(deps, scope, { layers: ['M5'] });
    return { playbooks: p, proposals: q, usage: u };
  });
  const empty = preview === 'empty';
  const lastUsed = lastUsedById(usage);
  return (
    <div data-route="memory-playbooks" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('playbooks.title')}</h1>
        <p className="text-ink-muted text-sm">{t('playbooks.hint')}</p>
      </header>
      <PlaybooksScreen
        workspaceId={context.workspace.id}
        canWrite={can(context.role, 'memory.write')}
        forceOffline={preview === 'offline'}
        cards={empty ? [] : playbooks.map((p) => toPlaybookCard(p, lastUsed))}
        proposals={
          empty
            ? []
            : splitProposals(proposals).playbooks.map((p) => ({
                id: p.id,
                playbook: memory.playbookFromValue(p.proposedValue),
              }))
        }
      />
    </div>
  );
}
