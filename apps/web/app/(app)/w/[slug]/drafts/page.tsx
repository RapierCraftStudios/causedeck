// `/w/[slug]/drafts` (#826, #79 part 2): the workspace's drafts. Rows come from `listDrafts`
// (`@causedeck/core/drafting`) in the member's workspace scope, so another workspace's drafts never
// reach the page; a role without `draft.read` (a clerk) gets permission-denied. `?matter=<id>`
// filters to one matter. The five suggested templates feed the New draft picker, whose server
// action is `createDraftAction`. Nothing here sends, shares or files anything.
//
// States: loading (skeleton rows), error (request id and `Try again`), empty and filtered-empty,
// offline (banner, New draft off) and permission-denied. In development
// `?__state=loading|error|denied|offline` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DraftsList } from '../../../../../components/drafting/drafts-list.tsx';
import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { loadDrafts, parseMatterParam, toDraftRowView } from '../../../../../lib/drafting/list.ts';
import { loadMatterList } from '../../../../../lib/matters/graph-deps.ts';
import {
  parseMatterListState,
  toSearchMattersInput,
} from '../../../../../lib/matters/list-params.ts';
import { can } from '../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';

import { createDraftAction } from './actions.ts';
import DraftsLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface DraftsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error|denied|offline` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('drafting.list');
  return { title: t('metaTitle') };
}

export default async function DraftsPage({ params, searchParams }: DraftsPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <DraftsLoading />;
  if (dev === 'error') throw new Error('Drafts error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'draft.read')) return <PermissionDeniedPage />;

  const matterFilter = parseMatterParam(query.matter);
  const [loaded, mattersLoad] = await Promise.all([
    loadDrafts(context, matterFilter),
    // The matter filter and the picker offer the first page of the member's matters.
    loadMatterList(context, toSearchMattersInput(parseMatterListState({}))),
  ]);
  if (loaded.kind === 'denied') return <PermissionDeniedPage />;
  const matters =
    mattersLoad.kind === 'page'
      ? mattersLoad.page.items.map((row) => ({ id: row.id, title: row.title }))
      : [];

  return (
    <DraftsList
      workspaceId={context.workspace.id}
      slug={slug}
      rows={loaded.drafts.map((item) => toDraftRowView(item, slug))}
      matters={matters}
      matterFilter={matterFilter}
      templates={loaded.templates.map((template) => ({ id: template.id, name: template.name }))}
      createAction={createDraftAction}
      canCreate={can(context.role, 'draft.write')}
      forceOffline={dev === 'offline'}
    />
  );
}
