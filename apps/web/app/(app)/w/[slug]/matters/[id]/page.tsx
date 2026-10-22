// `/w/[slug]/matters/[id]` Overview (#390, #40 part 3): the next date with its provenance and
// `Confirm` when proposed, a Conflict card per unresolved date conflict (Choose A / Choose B /
// Enter manually, never auto-resolved), the proceedings summary, open obligations, recent
// documents, people and the lawyer's synopsis. The read model (`getMatterOverview`) is shared with
// the layout; it leaves the synopsis out for roles without `strategy.read` (`synopsisDenied`).
// Write controls are passed only to roles with `matter.write`, so viewers and clerks get none in
// the page at all; the server actions check again.
//
// States: loading (skeleton), error (`Couldn't load this matter.` with `Retry` and a reference),
// empty cards, offline (banner, mutations off), permission-denied, and not-found (another
// workspace, a restricted matter or an unknown id). In development
// `?__state=loading|error|denied|offline|empty` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { MatterOverview } from '../../../../../../components/matters/matter-overview.tsx';
import { MattersPermissionDenied } from '../../../../../../components/matters/matters-list.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import type { SearchParams } from '../../../../../../lib/matters/list-params.ts';
import {
  loadMatterOverview,
  toOverviewView,
  type MatterOverviewView,
} from '../../../../../../lib/matters/workspace.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import {
  chooseNextDateSourceAction,
  confirmNextDateAction,
  updateMatterAction,
} from './actions.ts';
import MatterLoading from './loading.tsx';

interface MatterPageProps {
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
}: Pick<MatterPageProps, 'params'>): Promise<Metadata> {
  const { slug, id } = await params;
  const t = await getTranslations('matters.workspace');
  const context = await getWorkspaceContext(slug);
  if (!context || !can(context.role, 'matter.read')) return { title: t('metaTitle') };
  const loaded = await loadMatterOverview(context, id);
  return { title: loaded.kind === 'overview' ? loaded.overview.header.title : t('metaTitle') };
}

async function pageLocale() {
  const { isLocale, DEFAULT_LOCALE } = await import('@causedeck/i18n');
  const requested = await getLocale();
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}

/** The `empty` dev preview: the same matter with nothing recorded yet. */
function emptied(view: MatterOverviewView): MatterOverviewView {
  return {
    ...view,
    nextDate: null,
    conflicts: [],
    proceedings: { count: 0, byState: [], lead: null },
    openObligations: 0,
    recentDocuments: [],
    people: [],
    synopsis: null,
  };
}

export default async function MatterOverviewPage({ params, searchParams }: MatterPageProps) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const dev = devState(query);
  if (dev === 'loading') return <MatterLoading />;
  if (dev === 'error') throw new Error('Matter error state (dev toggle)');
  if (dev === 'denied' || !can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const loaded = await loadMatterOverview(context, id);
  if (loaded.kind === 'not-found') notFound();
  if (loaded.kind === 'denied') return <MattersPermissionDenied />;
  if (loaded.kind === 'error') throw new Error('Matter could not be loaded');

  const view = toOverviewView(loaded.overview, { locale: await pageLocale(), now: new Date() });
  return (
    <MatterOverview
      matter={dev === 'empty' ? emptied(view) : view}
      workspaceId={context.workspace.id}
      slug={slug}
      canWrite={can(context.role, 'matter.write')}
      forcedOffline={dev === 'offline'}
      actions={{
        confirmNextDate: confirmNextDateAction,
        chooseNextDateSource: chooseNextDateSourceAction,
        updateMatter: updateMatterAction,
      }}
    />
  );
}
