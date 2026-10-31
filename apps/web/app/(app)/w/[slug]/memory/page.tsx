// `/w/[slug]/memory` (#73): what CauseDeck remembers about the member. Cards, proposals and the
// tenure metrics are read through `@causedeck/core/memory` in the member's workspace scope, so scope
// and role are already applied (a junior sees personal items and the matters they are assigned to).
// A role without `memory.read` (a clerk) gets the permission-denied explanation, never an empty
// list. In development `?__state=loading|error|denied|offline|empty` previews a state.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SurfaceHelp } from '../../../../../components/help/surface-help.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { workspaceFlagCheck } from '../../../../../lib/flags.ts';
import { memoryDeps } from '../../../../../lib/memory/deps.ts';
import {
  parseMemoryTab,
  reviewDue,
  toCardView,
  valueText,
  keyTitle,
} from '../../../../../lib/memory/memory-state.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { MemoryScreen, type ProposalView } from './_components/memory-list.tsx';
import { TenurePanel } from './_components/tenure-panel.tsx';
import MemoryLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface MemoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('memory');
  return { title: t('metaTitle') };
}

export default async function MemoryPage({ params, searchParams }: MemoryPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('memory');
  const preview = isDev() ? [query.__state].flat()[0] : undefined;
  if (preview === 'loading') return <MemoryLoading />;
  if (preview === 'error') throw new Error('Memory preview error');
  if (preview === 'denied' || !can(context.role, 'memory.read')) {
    return <PermissionDenied message={t('denied')} />;
  }

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const runtime = await import('@causedeck/core/runtime');
  const memory = await import('@causedeck/core/memory');
  const { items, proposals, lastReview, tenure, pausedAll } = await runtime.inWorkspace(
    scope,
    async (tx) => {
      const deps = memoryDeps(tx);
      // One after the other: they share the workspace transaction.
      const i = await memory.listMemoryWithUsage(deps, scope);
      const p = await memory.listMemoryProposals(deps, scope);
      const l = await memory.getLastMemoryReview(deps, scope);
      const m = can(context.role, 'memory.write')
        ? await memory.tenureMetrics(deps, scope).catch(() => null)
        : null;
      const a = await memory.isMemoryPaused(deps, scope);
      return { items: i, proposals: p, lastReview: l, tenure: m, pausedAll: a };
    },
  );
  const empty = preview === 'empty';
  const m5 = (await workspaceFlagCheck(context))('m5_playbooks');
  // M5 proposals bypass the passage write on the generic confirm: they live on their own pages.
  const generic = m5 ? proposals.filter((p) => !p.key.startsWith('M5.')) : proposals;
  const proposalViews: ProposalView[] = empty
    ? []
    : generic.map((p) => ({
        id: p.id,
        title: keyTitle(p.key),
        value: valueText(p.proposedValue),
        scope: p.scope,
        seen: typeof p.evidence.count === 'number' ? p.evidence.count : null,
      }));
  return (
    <div className="flex flex-col gap-4">
      <SurfaceHelp slug={slug} surface="memory" />
      <MemoryScreen
        workspaceId={context.workspace.id}
        slug={slug}
        tab={parseMemoryTab(query)}
        cards={empty ? [] : items.map(toCardView)}
        proposals={proposalViews}
        canWrite={can(context.role, 'memory.write')}
        isOwner={context.role === 'owner'}
        pausedAll={pausedAll}
        reviewDue={reviewDue(lastReview, new Date())}
        forceOffline={preview === 'offline'}
        m5Enabled={m5}
      />
      {tenure === null ? null : <TenurePanel metrics={tenure} />}
    </div>
  );
}
