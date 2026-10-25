// `/w/[slug]/obligations` (#68): the obligation queue. The queue, the registry defects and the
// certified copies are read through `@causedeck/core/obligations` in the member's workspace scope,
// so restricted matters and what the role may not read are already left out. A member who may not
// read obligations gets the permission-denied state, a viewer a read-only queue. In development
// `?__state=loading|error|denied|offline|empty` previews a state.
import { PermissionDenied } from '@causedeck/ui/patterns';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isDev } from '../../../../../lib/env.ts';
import {
  groupItems,
  parseQueueParams,
  type QueueItem,
} from '../../../../../lib/obligations/queue-state.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { QueueView } from './_components/queue-view.tsx';
import ObligationsLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface ObligationsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('obligations');
  return { title: t('metaTitle') };
}

export default async function ObligationsPage({ params, searchParams }: ObligationsPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  const t = await getTranslations('obligations');
  const preview = isDev() ? [query.__state].flat()[0] : undefined;
  if (preview === 'loading') return <ObligationsLoading />;
  if (preview === 'error') throw new Error('Obligations preview error');
  if (preview === 'denied' || !can(context.role, 'obligation.read')) {
    return <PermissionDenied message={t('denied')} />;
  }

  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const runtime = await import('@causedeck/core/runtime');
  const obligations = await import('@causedeck/core/obligations');
  const empty = preview === 'empty';
  const [queue, defects, copies, options] = await runtime.inWorkspace(scope, async (tx) => {
    const deps = { db: tx };
    // One after the other: they share the workspace transaction.
    const q = await obligations.queryQueueView(deps, scope);
    const d = await obligations.listDefects(deps, scope);
    const c = await obligations.listCertifiedCopies(deps, scope);
    const o = await obligations.obligationOptions(deps, scope);
    return [q, d, c, o] as const;
  });
  const items: QueueItem[] = empty
    ? []
    : (Object.entries(queue) as [QueueItem['group'], (typeof queue)['overdue']][]).flatMap(
        ([group, rows]) =>
          rows.map(
            (row): QueueItem => ({
              id: row.id,
              group,
              matterId: row.matterId,
              matterTitle: row.matterTitle,
              caseNumber: row.caseNumber,
              description: row.description,
              dueDate: row.dueDate,
              source: row.source,
              sourceType: row.sourceType,
              status: row.status,
              ownerMemberId: row.ownerMemberId,
              ownerName: row.ownerName,
              sourceQuote: row.sourceQuote,
              basis: row.basis,
            }),
          ),
      );
  const initial = parseQueueParams(query);
  return (
    <QueueView
      workspaceId={context.workspace.id}
      slug={slug}
      items={items}
      grouped={groupItems(items)}
      defects={empty ? [] : defects}
      copies={empty ? [] : copies}
      options={options}
      initial={initial}
      canWrite={can(context.role, 'obligation.write')}
      canTrack={can(context.role, 'obligation.track')}
      forceOffline={preview === 'offline'}
    />
  );
}
