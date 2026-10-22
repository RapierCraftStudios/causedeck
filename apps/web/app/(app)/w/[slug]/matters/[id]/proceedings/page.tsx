// `/w/[slug]/matters/[id]/proceedings` (#392, #40 part 4): the matter's proceedings tree with the
// state-transition menus, the add/edit proceeding form and the merge and split dialogs. The tab is
// registered in lib/matters/tabs.ts; the matter layout renders the header and the tab bar. The tree
// comes from `listMatterProceedingsTree` in the member's workspace scope, the forum select from the
// courts catalogue with each forum's adapter case types. Write controls (and the actions behind
// them) are passed only to roles with `matter.write`, so viewers and clerks get none in the page at
// all; the server actions and the services check again.
//
// States: loading (skeleton), error (the matter's error boundary: `Couldn't load this matter.` with
// `Retry` and a reference), empty (one primary `Add proceeding` for writers), offline (banner,
// mutations off), permission-denied, and not-found (another workspace, a restricted matter or an
// unknown id). In development `?__state=loading|error|denied|offline|empty` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { MattersPermissionDenied } from '../../../../../../../components/matters/matters-list.tsx';
import { ProceedingTree } from '../../../../../../../components/matters/proceeding-tree.tsx';
import { isDev } from '../../../../../../../lib/env.ts';
import type { SearchParams } from '../../../../../../../lib/matters/list-params.ts';
import {
  loadProceedingsTab,
  toProceedingTreeView,
} from '../../../../../../../lib/matters/proceedings-view.ts';
import { loadMatterOverview } from '../../../../../../../lib/matters/workspace.ts';
import { can } from '../../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../../lib/workspace-loader.ts';
import { searchMattersAction } from '../../actions.ts';

import {
  createProceedingAction,
  findDuplicateProceedingsAction,
  linkProceedingsAction,
  mergeMattersAction,
  previewMergeAction,
  previewSplitAction,
  splitMatterAction,
  transitionProceedingAction,
  undoMergeAction,
  undoSplitAction,
  updateProceedingAction,
} from './actions.ts';
import ProceedingsLoading from './loading.tsx';

interface ProceedingsPageProps {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=…` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: Pick<ProceedingsPageProps, 'params'>): Promise<Metadata> {
  const { slug, id } = await params;
  const t = await getTranslations('matters.workspace');
  const tab = t('tabs.proceedings');
  const context = await getWorkspaceContext(slug);
  if (!context || !can(context.role, 'matter.read')) return { title: tab };
  const loaded = await loadMatterOverview(context, id);
  return {
    title: loaded.kind === 'overview' ? `${tab} · ${loaded.overview.header.title}` : tab,
  };
}

async function pageLocale() {
  const { isLocale, DEFAULT_LOCALE } = await import('@causedeck/i18n');
  const requested = await getLocale();
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}

export default async function MatterProceedingsPage({
  params,
  searchParams,
}: ProceedingsPageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <ProceedingsLoading />;
  if (dev === 'error') throw new Error('Proceedings error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const loaded = await loadProceedingsTab(context, id);
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'error') throw new Error('Proceedings could not be loaded');

  const canWrite = can(context.role, 'matter.write');
  const rows = toProceedingTreeView(loaded.nodes, {
    locale: await pageLocale(),
    now: new Date(),
    canWrite,
    transitions: loaded.transitions,
  });
  return (
    <ProceedingTree
      workspaceId={context.workspace.id}
      slug={slug}
      matterId={id}
      rows={dev === 'empty' ? [] : rows}
      forums={loaded.forums}
      canWrite={canWrite}
      forcedOffline={dev === 'offline'}
      actions={
        canWrite
          ? {
              form: {
                create: createProceedingAction,
                update: updateProceedingAction,
                link: linkProceedingsAction,
                findDuplicates: findDuplicateProceedingsAction,
              },
              transition: transitionProceedingAction,
              merge: {
                search: searchMattersAction,
                preview: previewMergeAction,
                merge: mergeMattersAction,
                undo: undoMergeAction,
              },
              split: {
                preview: previewSplitAction,
                split: splitMatterAction,
                undo: undoSplitAction,
              },
            }
          : undefined
      }
    />
  );
}
